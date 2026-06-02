/**
 * GTM Intel Research Engine — Structured Pipeline v6
 *
 * 4-step pipeline pattern:
 * Step 1 — Search Layer:    Serper fetches raw web data (no AI)
 * Step 2 — Extract Layer:   Groq extracts structured facts only (small prompt)
 * Step 3 — Insight Layer:   Groq generates sales insights from structured data
 * Step 4 — Outreach Layer:  Groq writes personalized outreach from insights
 *
 * Each step is isolated, constrained, and feeds the next.
 * Groq never sees raw web data — it only sees clean structured JSON.
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const SERPER_API = 'https://google.serper.dev/search'

// ── Serper helpers ───────────────────────────────────────────────────────────
async function serperSearch(query: string, num = 5): Promise<Array<{ title: string; snippet: string; link: string }>> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num }),
    })
    const data = await res.json()
    return data.organic || []
  } catch { return [] }
}

async function serperNews(query: string, num = 5): Promise<Array<{ title: string; snippet: string; link: string; date?: string }>> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num, type: 'news' }),
    })
    const data = await res.json()
    return data.news || []
  } catch { return [] }
}

function snippets(results: Array<{ title: string; snippet: string; link: string; date?: string }>): string {
  return results.map(r => `[${r.title}] ${r.snippet} (${r.link})`).join('\n') || 'No results'
}

// ── Groq helper ──────────────────────────────────────────────────────────────
async function groq(prompt: string, maxTokens = 800, temperature = 0.1): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not configured')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
    }),
  })
  if (!res.ok) { const e = await res.text(); throw new Error(`Groq ${res.status}: ${e}`) }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match) return fallback
    return JSON.parse(match[0])
  } catch { return fallback }
}

// ── LinkedIn validator ───────────────────────────────────────────────────────
async function validateLinkedIn(name: string, company: string, title: string): Promise<{ url: string | null; verified: boolean }> {
  const key = process.env.SERPER_API_KEY
  if (!key) return { url: null, verified: false }

  const parts = name.toLowerCase().split(' ').filter(p => p.length > 1)
  const first = parts[0] || ''
  const last = parts[parts.length - 1] || ''

  const queries = [
    `site:linkedin.com/in "${name}" "${company}"`,
    `site:linkedin.com/in "${first} ${last}" "${company}" "${title.split(' ').slice(0, 3).join(' ')}"`,
  ]

  for (const q of queries) {
    const results = await serperSearch(q, 3)
    for (const r of results) {
      if (!r.link.includes('linkedin.com/in/')) continue
      if (r.link.includes('/in/search') || r.link.includes('/in/in/')) continue

      const slug = r.link.split('linkedin.com/in/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase() || ''
      if (!slug || slug.length < 3) continue

      let score = 0
      if (slug.includes(first.slice(0, 4))) score += 35
      if (slug.includes(last.slice(0, 4))) score += 35
      if (r.snippet?.toLowerCase().includes(first)) score += 15
      if (r.snippet?.toLowerCase().includes(company.toLowerCase().split(' ')[0])) score += 15

      if (score >= 70) return { url: r.link.split('?')[0], verified: true }
      if (score >= 45) return { url: r.link.split('?')[0], verified: false }
    }
  }
  return { url: null, verified: false }
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 1 — SEARCH LAYER (no AI, pure Serper)
// Returns raw structured search data
// ────────────────────────────────────────────────────────────────────────────
interface RawSearchData {
  companyName: string
  websiteResults: string
  linkedinResults: string
  fundingResults: string
  newsResults: string
  hiringResults: string
  productResults: string
  companyLinkedInUrl: string | null
}

async function step1_search(companyName: string): Promise<RawSearchData> {
  const [website, linkedin, funding, news, hiring, product, liUrl] = await Promise.all([
    serperSearch(`"${companyName}" official site about product overview`, 4),
    serperSearch(`site:linkedin.com/company "${companyName}"`, 3),
    serperNews(`"${companyName}" funding raised investors 2024 2025`, 5),
    serperNews(`"${companyName}" news announcement 2025 2026`, 5),
    serperSearch(`"${companyName}" hiring jobs careers 2025`, 4),
    serperNews(`"${companyName}" product launch partnership integration 2025`, 4),
    // Company LinkedIn URL
    serperSearch(`site:linkedin.com/company "${companyName}" official`, 2),
  ])

  const companyLinkedInUrl = liUrl.find(r =>
    r.link.includes('linkedin.com/company/') && !r.link.includes('/search')
  )?.link?.split('?')[0] || null

  return {
    companyName,
    websiteResults: snippets(website),
    linkedinResults: snippets(linkedin),
    fundingResults: snippets(funding),
    newsResults: snippets(news),
    hiringResults: snippets(hiring),
    productResults: snippets(product),
    companyLinkedInUrl,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 2 — EXTRACTION LAYER
// Groq extracts structured facts ONLY from raw search data
// Small, constrained prompt — no analysis, just extraction
// ────────────────────────────────────────────────────────────────────────────
interface CompanySnapshot {
  name: string
  domain: string
  industry: string
  category: string           // e.g. "AI Sales Intelligence", "RevOps Automation"
  hq: string
  founded: string
  employee_count: string
  stage: string              // Seed / Series A / Series B / Growth / Public
  total_funding: string      // e.g. "$45M" or "Unknown"
  latest_round: string       // e.g. "Series B — $30M — Jan 2025"
  investors: string          // comma-separated top investors
  description: string        // 2 sentences max
  linkedin_url: string
  website: string
  icp: string                // who they sell to
  business_model: string     // SaaS / Usage-based / etc
  tech_stack_hints: string[] // tools mentioned in job listings or website
  priority_score: number
}

interface RecentSignals {
  funding: Array<{ headline: string; detail: string; source: string; source_url: string; date: string }>
  leadership: Array<{ headline: string; detail: string; source: string; source_url: string; date: string }>
  hiring: Array<{ role: string; signal: string; source_url: string }>
  product: Array<{ headline: string; detail: string; source: string; source_url: string; date: string }>
  expansion: Array<{ headline: string; detail: string; source: string; source_url: string; date: string }>
  other: Array<{ headline: string; detail: string; source: string; source_url: string; date: string }>
}

interface ExtractedData {
  snapshot: CompanySnapshot
  signals: RecentSignals
  contacts_found: Array<{
    name: string
    title: string
    source_url: string
  }>
}

async function step2_extract(raw: RawSearchData): Promise<ExtractedData> {
  const prompt = `You are a data extraction engine. Extract ONLY facts from the search results below.
Do NOT analyze, infer, or generate. Only extract what is explicitly stated.
If a field is not found, use "Unknown" or empty array.

Company: "${raw.companyName}"

SEARCH RESULTS:
WEBSITE: ${raw.websiteResults}
LINKEDIN: ${raw.linkedinResults}
FUNDING: ${raw.fundingResults}
NEWS: ${raw.newsResults}
HIRING: ${raw.hiringResults}
PRODUCT: ${raw.productResults}

Extract into this exact JSON structure. Return ONLY JSON, no explanation:
{
  "snapshot": {
    "name": "exact company name",
    "domain": "domain.com",
    "industry": "industry from results",
    "category": "specific product category e.g. AI Sales Intelligence",
    "hq": "city, country",
    "founded": "year or Unknown",
    "employee_count": "number or range e.g. 200-500",
    "stage": "Seed|Series A|Series B|Series C|Growth|Public|Unknown",
    "total_funding": "amount or Unknown",
    "latest_round": "round type + amount + date or Unknown",
    "investors": "investor names or Unknown",
    "description": "max 2 sentences from website results",
    "linkedin_url": "${raw.companyLinkedInUrl || 'Unknown'}",
    "website": "domain from results",
    "icp": "who they sell to, from website/linkedin",
    "business_model": "SaaS|Usage-based|Freemium|Enterprise|Unknown",
    "tech_stack_hints": ["tools mentioned in job listings"],
    "priority_score": 7
  },
  "signals": {
    "funding": [{"headline":"string","detail":"exact text from results","source":"publication","source_url":"url","date":"date or recent"}],
    "leadership": [{"headline":"string","detail":"exact text","source":"pub","source_url":"url","date":"date"}],
    "hiring": [{"role":"job title found","signal":"what it implies","source_url":"url"}],
    "product": [{"headline":"string","detail":"exact text","source":"pub","source_url":"url","date":"date"}],
    "expansion": [{"headline":"string","detail":"exact text","source":"pub","source_url":"url","date":"date"}],
    "other": [{"headline":"string","detail":"exact text","source":"pub","source_url":"url","date":"date"}]
  },
  "contacts_found": [
    {"name":"exact name found in results","title":"exact title","source_url":"url where found"}
  ]
}`

  const raw_response = await groq(prompt, 2000, 0.0)
  return parseJSON<ExtractedData>(raw_response, {
    snapshot: {
      name: raw.companyName, domain: '', industry: 'Unknown', category: 'Unknown',
      hq: 'Unknown', founded: 'Unknown', employee_count: 'Unknown', stage: 'Unknown',
      total_funding: 'Unknown', latest_round: 'Unknown', investors: 'Unknown',
      description: '', linkedin_url: raw.companyLinkedInUrl || '', website: '',
      icp: 'Unknown', business_model: 'Unknown', tech_stack_hints: [], priority_score: 5,
    },
    signals: { funding: [], leadership: [], hiring: [], product: [], expansion: [], other: [] },
    contacts_found: [],
  })
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3 — INSIGHT LAYER
// Groq generates sales insights from clean structured data
// Context is structured, task is isolated
// ────────────────────────────────────────────────────────────────────────────
interface SalesInsights {
  why_relevant: string
  pain_points: Array<{ title: string; description: string; severity: 'high' | 'medium' | 'low' }>
  buying_signals: Array<{ signal: string; why_it_matters: string }>
  gtm_scoops: Array<{
    type: string; headline: string; detail: string
    why_it_matters: string; source: string; source_url: string; date: string
  }>
  discovery_questions: string[]
  outreach_angles: Array<{ title: string; description: string }>
  tech_stack: Array<{ category: string; tool: string; confidence: 'high' | 'medium' | 'low' }>
}

async function step3_insights(snapshot: CompanySnapshot, signals: RecentSignals, salesDescription: string): Promise<SalesInsights> {
  const signalSummary = JSON.stringify({
    funding: signals.funding.slice(0, 2),
    leadership: signals.leadership.slice(0, 2),
    hiring: signals.hiring.slice(0, 3),
    product: signals.product.slice(0, 2),
    expansion: signals.expansion.slice(0, 2),
  })

  const prompt = `You are a senior sales strategist. Based on the structured company data below, generate sales insights.

COMPANY DATA:
${JSON.stringify(snapshot, null, 2)}

RECENT SIGNALS:
${signalSummary}

WHAT THE SALES REP SELLS:
${salesDescription}

Generate insights. Return ONLY JSON:
{
  "why_relevant": "2 sentences: specific reason this company needs what the rep sells RIGHT NOW",
  "pain_points": [
    {"title":"specific pain","description":"why this company has this pain based on their data","severity":"high|medium|low"}
  ],
  "buying_signals": [
    {"signal":"specific signal from the data","why_it_matters":"one sentence on why this creates urgency"}
  ],
  "gtm_scoops": [
    {"type":"funding|leadership_change|hiring_spike|expansion|product_launch|partnership|other",
     "headline":"punchy headline","detail":"2-3 sentences with specifics",
     "why_it_matters":"one sentence sales angle","source":"pub name","source_url":"url","date":"date"}
  ],
  "discovery_questions": ["question tailored to this company's specific situation"],
  "outreach_angles": [
    {"title":"angle title","description":"specific angle based on their data and signals"}
  ],
  "tech_stack": [
    {"category":"CRM|Support|Analytics|Marketing|Data","tool":"tool name","confidence":"high|medium|low"}
  ]
}`

  const raw = await groq(prompt, 1500, 0.2)
  return parseJSON<SalesInsights>(raw, {
    why_relevant: '', pain_points: [], buying_signals: [], gtm_scoops: [],
    discovery_questions: [], outreach_angles: [], tech_stack: [],
  })
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 4 — OUTREACH LAYER
// Groq writes outreach from structured snapshot + scoops only
// Separate prompt, constrained output
// ────────────────────────────────────────────────────────────────────────────
interface OutreachKit {
  cold_email: string
  linkedin_message: string
  call_script: string
  objections: Array<{ objection: string; counter: string }>
}

async function step4_outreach(
  snapshot: CompanySnapshot,
  scoops: SalesInsights['gtm_scoops'],
  angles: SalesInsights['outreach_angles'],
  salesDescription: string
): Promise<OutreachKit> {
  const topScoops = scoops.slice(0, 3).map(s => `[${s.type}] ${s.headline} — ${s.why_it_matters}`).join('\n')
  const topAngles = angles.slice(0, 2).map(a => `${a.title}: ${a.description}`).join('\n')

  const prompt = `You are an expert SDR writing outreach for a B2B sales rep.

SELLING: ${salesDescription}
TARGET: ${snapshot.name} (${snapshot.category}, ${snapshot.employee_count} employees, ${snapshot.stage})
DESCRIPTION: ${snapshot.description}
ICP: ${snapshot.icp}

TOP SCOOPS TO REFERENCE:
${topScoops || 'Recent growth and hiring activity'}

ANGLES:
${topAngles}

Write outreach that references SPECIFIC scoops above. Do not write generic templates.
Return ONLY JSON:
{
  "cold_email": "Subject: [subject line]\\n\\nHi [First Name],\\n\\n[3-4 sentences referencing a specific scoop and how rep's product helps]\\n\\n[CTA]\\n\\n[Name]",
  "linkedin_message": "Hi [First Name] — [2-3 sentences max, reference one specific scoop, clear ask]",
  "call_script": "Hi [Name], this is [Rep] from [Company]. [One sentence on why calling now — reference scoop]. Quick question: [discovery question]. [Wait for response]",
  "objections": [
    {"objection":"likely objection","counter":"specific counter referencing their data"}
  ]
}`

  const raw = await groq(prompt, 1200, 0.3)
  return parseJSON<OutreachKit>(raw, {
    cold_email: '', linkedin_message: '', call_script: '', objections: [],
  })
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 5 — CONTACTS LAYER
// Find and validate contacts separately
// ────────────────────────────────────────────────────────────────────────────
interface ValidatedContact {
  name: string
  title: string
  department: string
  linkedin_url: string | null
  linkedin_verified: boolean
  email_guess: string
  email_pattern: string
  email_confidence: 'high' | 'medium' | 'low'
  role_in_deal: 'champion' | 'blocker' | 'influencer' | 'evaluator'
  outreach_message: string
}

async function step5_contacts(
  snapshot: CompanySnapshot,
  contactsFound: ExtractedData['contacts_found'],
  insights: SalesInsights,
  salesDescription: string
): Promise<ValidatedContact[]> {

  // Search for contacts if not found in extraction
  let allFound = [...contactsFound]
  if (allFound.length < 3) {
    const searches = await Promise.all([
      serperSearch(`site:linkedin.com/in "${snapshot.name}" VP OR Head OR Director OR CRO OR "Chief Revenue" 2025`, 4),
      serperSearch(`"${snapshot.name}" CEO CTO VP leadership team site:linkedin.com`, 4),
    ])
    const extra = [...searches[0], ...searches[1]]
      .filter(r => r.link.includes('linkedin.com/in/'))
      .map(r => ({ name: r.title.split(' - ')[0]?.trim() || '', title: r.title.split(' - ')[1]?.trim() || '', source_url: r.link }))
      .filter(c => c.name.length > 2)
    allFound = [...allFound, ...extra].slice(0, 8)
  }

  if (!allFound.length) return []

  // Ask Groq to enrich the found contacts — structured input, constrained output
  const contactList = allFound.map((c, i) => `${i + 1}. ${c.name} — ${c.title}`).join('\n')
  const domain = snapshot.domain || snapshot.website || snapshot.name.toLowerCase().replace(/\s+/g, '') + '.com'

  const prompt = `Company: ${snapshot.name} (domain: ${domain})
Rep sells: ${salesDescription}
Top insight: ${insights.why_relevant}

Contacts found at this company:
${contactList}

For each contact, assign role_in_deal and write a 3-line personalized outreach message.
Return ONLY JSON array:
[{
  "name": "exact name",
  "title": "exact title",
  "department": "Sales|RevOps|CS|Product|Engineering|Finance|IT|Marketing",
  "email_guess": "firstname@${domain}",
  "email_pattern": "first@${domain}",
  "email_confidence": "high|medium|low",
  "role_in_deal": "champion|blocker|influencer|evaluator",
  "outreach_message": "Hi [name], [specific 3-line message referencing company insight and what rep sells]"
}]`

  const raw = await groq(prompt, 1000, 0.2)
  const enriched = parseJSON<Array<Omit<ValidatedContact, 'linkedin_url' | 'linkedin_verified'>>>(raw, [])

  // Validate LinkedIn for each — parallel
  const validated = await Promise.all(
    enriched.slice(0, 6).map(async c => {
      const { url, verified } = await validateLinkedIn(c.name, snapshot.name, c.title)
      return { ...c, linkedin_url: url, linkedin_verified: verified }
    })
  )

  return validated
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE — orchestrates all 5 steps
// ────────────────────────────────────────────────────────────────────────────
export async function runFullResearch(
  companyName: string,
  salesDescription: string,
  targetIndustries: string[]
) {
  try {
    // Step 1 — Search (no AI)
    const rawData = await step1_search(companyName)

    // Steps 2, 3, 4, 5 — AI pipeline on clean data
    const extracted = await step2_extract(rawData)
    const [insights, outreach] = await Promise.all([
      step3_insights(extracted.snapshot, extracted.signals, salesDescription),
      // Step 4 needs insights first — run after step 3
      step3_insights(extracted.snapshot, extracted.signals, salesDescription)
        .then(ins => step4_outreach(extracted.snapshot, ins.gtm_scoops, ins.outreach_angles, salesDescription)),
    ])
    const contacts = await step5_contacts(extracted.snapshot, extracted.contacts_found, insights, salesDescription)

    // Merge all signals into GTM scoops format
    const allScoops = [
      ...insights.gtm_scoops,
      ...extracted.signals.funding.map(s => ({ type: 'funding', headline: s.headline, detail: s.detail, why_it_matters: 'Funding means budget and growth initiatives', source: s.source, source_url: s.source_url, date: s.date })),
      ...extracted.signals.leadership.map(s => ({ type: 'leadership_change', headline: s.headline, detail: s.detail, why_it_matters: 'New leadership means new priorities and buying decisions', source: s.source, source_url: s.source_url, date: s.date })),
      ...extracted.signals.product.map(s => ({ type: 'product_launch', headline: s.headline, detail: s.detail, why_it_matters: 'Product launches signal growth and new workflow needs', source: s.source, source_url: s.source_url, date: s.date })),
      ...extracted.signals.expansion.map(s => ({ type: 'expansion', headline: s.headline, detail: s.detail, why_it_matters: 'Expansion means new markets, teams, and tool needs', source: s.source, source_url: s.source_url, date: s.date })),
    ].filter((s, i, arr) => arr.findIndex(x => x.headline === s.headline) === i) // dedupe

    // Return unified research object
    return {
      company: {
        name: extracted.snapshot.name || companyName,
        domain: extracted.snapshot.domain || extracted.snapshot.website,
        industry: extracted.snapshot.industry,
        size: extracted.snapshot.employee_count,
        stage: extracted.snapshot.stage,
        hq: extracted.snapshot.hq,
        linkedin_url: extracted.snapshot.linkedin_url,
        description: extracted.snapshot.description,
        founded: extracted.snapshot.founded,
        total_funding: extracted.snapshot.total_funding,
        latest_round: extracted.snapshot.latest_round,
        investors: extracted.snapshot.investors,
        priority_score: extracted.snapshot.priority_score,
      },
      executive_summary: `${extracted.snapshot.description} ${insights.why_relevant}`.trim(),
      business_model: extracted.snapshot.business_model,
      gtm_motion: `${extracted.snapshot.icp} — ${extracted.snapshot.business_model}`,
      why_relevant: insights.why_relevant,
      gtm_scoops: allScoops.slice(0, 8),
      pain_points: insights.pain_points,
      tech_stack: insights.tech_stack,
      buying_signals: insights.buying_signals.map(b => ({
        signal: b.signal, source: '', source_url: '', date: ''
      })),
      discovery_questions: insights.discovery_questions,
      outreach_angles: insights.outreach_angles,
      cold_email: outreach.cold_email,
      linkedin_message: outreach.linkedin_message,
      call_script: outreach.call_script,
      objections: outreach.objections,
      contacts,
      recent_news: [
        ...extracted.signals.funding,
        ...extracted.signals.product,
        ...extracted.signals.other,
      ].map(s => ({
        title: s.headline, summary: s.detail,
        source_name: s.source, source_url: s.source_url,
        date: s.date, signal_type: 'press',
      })),
    }
  } catch (err) {
    console.error('Research pipeline error:', err)
    return null
  }
}

// ── SIGNAL REFRESH ───────────────────────────────────────────────────────────
export async function refreshSignals(
  companyName: string,
  domain: string,
  salesDescription: string,
  lastCheckedAt: string | null
) {
  const since = lastCheckedAt
    ? `since ${new Date(lastCheckedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'in the last 7 days'

  // Step 1: search
  const [news, hiring, funding] = await Promise.all([
    serperNews(`"${companyName}" ${since} announcement`, 5),
    serperSearch(`"${companyName}" new hire director VP ${since}`, 4),
    serperNews(`"${companyName}" funding raised ${since}`, 4),
  ])

  const rawText = [
    'NEWS: ' + snippets(news),
    'HIRING: ' + snippets(hiring),
    'FUNDING: ' + snippets(funding),
  ].join('\n\n')

  // Step 2: extract signals only
  const prompt = `Extract new signals ${since} for "${companyName}".
Sales rep sells: "${salesDescription}"

RAW DATA:
${rawText}

Extract ONLY what is explicitly in the data. Return ONLY JSON array:
[{
  "signal_type": "funding|hiring|product_launch|leadership_change|expansion|partnership|press|other",
  "title": "specific headline",
  "summary": "2 sentences: what happened + why it matters for sales",
  "source_name": "publication",
  "source_url": "url",
  "source_verified": true,
  "signal_date": "YYYY-MM-DD or approximate"
}]
Return [] if nothing new. Max 6.`

  const raw = await groq(prompt, 800, 0.0)
  return parseJSON<SignalResult[]>(raw, [])
}

// ── DIGEST SUMMARY ───────────────────────────────────────────────────────────
export async function generateDigestSummary(
  salesDescription: string,
  signalsByProspect: Array<{ company: string; signals: SignalResult[] }>
) {
  const text = signalsByProspect
    .map(p => `${p.company}: ${p.signals.map(s => `[${s.signal_type}] ${s.title}`).join(', ')}`)
    .join('\n')

  const prompt = `Sales coach for rep selling: "${salesDescription}".
New signals today: ${text}
Write 3-4 sentence briefing. State: 1) top signal to act on 2) which company to call first 3) why. Plain text only.`

  return groq(prompt, 300, 0.2)
}

// ── DISCOVER ─────────────────────────────────────────────────────────────────
export async function discoverCompanies(
  salesDescription: string,
  targetIndustries: string[],
  targetSizes: string[],
  icpNotes: string,
  count = 5
): Promise<string[]> {
  const ind = targetIndustries.slice(0, 2).join(' ')
  const stage = targetSizes.some(s => s.includes('1000')) ? 'Series C' :
    targetSizes.some(s => s.includes('501')) ? 'Series B C' : 'Series A B'

  const [s1, s2, s3] = await Promise.all([
    serperNews(`AI SaaS startup ${ind} "${stage}" funding raised 2025 2026`, 8),
    serperNews(`AI-first ${ind} company product launch 2025 2026`, 8),
    serperSearch(`top AI ${ind} startups 2025 raised funding`, 8),
  ])

  const seen = new Set<string>()
  const candidates: string[] = []
  const excluded = ['techcrunch','crunchbase','linkedin','forbes','bloomberg','medium','github','reddit']

  for (const r of [...s1, ...s2, ...s3]) {
    const domain = (() => { try { return new URL(r.link).hostname.replace('www.','') } catch { return '' } })()
    if (!domain || excluded.some(e => domain.includes(e))) continue
    if (seen.has(domain)) continue
    seen.add(domain)
    let name = r.title.replace(/\s*[-|–:]\s*.*/g,'').replace(/\s*(Inc|LLC|Ltd|Corp)\.?$/gi,'').trim()
    if (name.length > 2 && name.length < 50) candidates.push(name)
    if (candidates.length >= 15) break
  }

  if (!candidates.length) return []

  const prompt = `Sales rep sells: "${salesDescription.slice(0, 150)}"
Industries: ${ind}, ICP: ${icpNotes || 'AI-first SaaS'}

Pick ${count} BEST companies from this list:
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Rules: AI-first only, real products, not media/aggregator sites.
Return ONLY JSON array: ["Company A","Company B"]`

  const raw = await groq(prompt, 200, 0.0)
  return parseJSON<string[]>(raw, candidates.slice(0, count))
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
