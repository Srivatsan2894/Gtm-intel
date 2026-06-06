/**
 * GTM Intel Research Engine — Claude API with native web_search
 *
 * Architecture:
 * Step 1: Claude searches the web natively (no Serper needed for research)
 * Step 2: Claude extracts structured company snapshot
 * Step 3: Claude generates sales insights from snapshot
 * Step 4: Claude writes personalized outreach
 * Step 5: Serper validates LinkedIn contacts
 *
 * Model: claude-haiku-4-5-20251001 (~$0.01 per full research run)
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const SERPER_API = 'https://google.serper.dev/search'

// ── Claude API call with web_search tool ─────────────────────────────────────
async function callClaude(
  prompt: string,
  maxTokens = 2000,
  useWebSearch = false
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key === 'placeholder_add_later') {
    // Fall back to Groq if no Claude key
    return callGroq(prompt, maxTokens)
  }

  const body: Record<string, unknown> = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  }

  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  }

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error ${res.status}: ${err}`)
  }

  const data = await res.json()

  // Extract text from content blocks (may include tool_use and tool_result blocks)
  const text = (data.content || [])
    .filter((b: { type: string; text?: string }) => b.type === 'text')
    .map((b: { type: string; text: string }) => b.text)
    .join('')

  return text
}

// ── Groq fallback ─────────────────────────────────────────────────────────────
async function callGroq(prompt: string, maxTokens = 2000): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('No AI backend configured')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  })
  if (!res.ok) { const e = await res.text(); throw new Error(`Groq error: ${e}`) }
  const d = await res.json()
  return d.choices?.[0]?.message?.content || ''
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match) return fallback
    return JSON.parse(match[0])
  } catch { return fallback }
}

// ── Serper search (still used for discovery + LinkedIn) ───────────────────────
async function serper(
  query: string,
  num = 6,
  type: 'search' | 'news' = 'search'
): Promise<Array<{ title: string; snippet: string; link: string; date?: string; source?: string }>> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const body: Record<string, unknown> = { q: query, num }
    if (type === 'news') body.type = 'news'
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return (type === 'news' ? data.news : data.organic) || []
  } catch { return [] }
}

// ── LinkedIn validator ────────────────────────────────────────────────────────
async function validateLinkedIn(
  name: string,
  company: string,
  title: string
): Promise<{ url: string | null; verified: boolean }> {
  const key = process.env.SERPER_API_KEY
  if (!key) return { url: null, verified: false }
  const parts = name.toLowerCase().split(' ').filter(p => p.length > 1)
  const first = parts[0] || ''
  const last = parts[parts.length - 1] || ''
  for (const q of [
    `site:linkedin.com/in "${name}" "${company}"`,
    `site:linkedin.com/in "${first} ${last}" "${company}" "${title.split(' ').slice(0, 3).join(' ')}"`,
  ]) {
    try {
      const res = await fetch(SERPER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q, num: 3 }),
      })
      const data = await res.json()
      for (const r of (data.organic || [])) {
        if (!r.link?.includes('linkedin.com/in/')) continue
        if (r.link.includes('/in/search')) continue
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
    } catch { continue }
  }
  return { url: null, verified: false }
}

// ── STEP 1+2: Claude researches company with web search + extracts snapshot ───
interface Snapshot {
  name: string; domain: string; industry: string; category: string
  hq: string; founded: string; employee_count: string; stage: string
  total_funding: string; latest_round: string; investors: string
  description: string; linkedin_url: string; icp: string
  business_model: string; priority_score: number
}

async function researchAndExtract(companyName: string): Promise<Snapshot> {
  const prompt = `Research the company "${companyName}" thoroughly.

Search for:
1. Company overview, product, what they do
2. Funding history, investors, latest round amount and date
3. Employee count and HQ location
4. Recent news (last 12 months)
5. Their LinkedIn company page URL

After researching, extract ONLY confirmed facts into this exact JSON structure.
Use "Unknown" for any field you cannot confirm.

Return ONLY this JSON, no explanation:
{
  "name": "exact company name",
  "domain": "domain.com",
  "industry": "industry",
  "category": "specific category e.g. AI CRM, Sales Intelligence",
  "hq": "city, country",
  "founded": "year or Unknown",
  "employee_count": "number or range",
  "stage": "Seed|Series A|Series B|Series C|Growth|Public|Unknown",
  "total_funding": "total raised e.g. $45M or Unknown",
  "latest_round": "e.g. Series B $30M January 2025 or Unknown",
  "investors": "key investors or Unknown",
  "description": "2 sentences: what they do and who they serve",
  "linkedin_url": "https://www.linkedin.com/company/slug or Unknown",
  "icp": "who they sell to",
  "business_model": "SaaS|Usage-based|Enterprise|Freemium|Unknown",
  "priority_score": 7
}`

  const raw = await callClaude(prompt, 1500, true)
  return parseJSON<Snapshot>(raw, {
    name: companyName, domain: '', industry: 'Unknown', category: 'Unknown',
    hq: 'Unknown', founded: 'Unknown', employee_count: 'Unknown', stage: 'Unknown',
    total_funding: 'Unknown', latest_round: 'Unknown', investors: 'Unknown',
    description: '', linkedin_url: '', icp: 'Unknown',
    business_model: 'Unknown', priority_score: 5,
  })
}

// ── STEP 3: Claude finds real scoops with web search ─────────────────────────
interface GTMScoop {
  type: string; headline: string; detail: string
  why_it_matters: string; source: string; source_url: string; date: string
}

async function findScoops(
  snapshot: Snapshot,
  salesDescription: string
): Promise<GTMScoop[]> {
  const prompt = `Search for the latest news and buying signals for "${snapshot.name}".

Look for:
- Funding rounds, acquisitions, mergers
- Layoffs or headcount reductions  
- Leadership changes (new CEO, CTO, VP hires)
- Product launches or major feature releases
- Partnerships or integrations
- Expansion to new markets
- Any strategic announcements in 2024-2025

For each signal found, explain why it's relevant to a sales rep selling: "${salesDescription}"

Return ONLY a JSON array of scoops with real source URLs you found:
[{
  "type": "funding|acquisition|layoff|leadership_change|product_launch|partnership|expansion|press",
  "headline": "specific headline with real details (amounts, names, dates)",
  "detail": "2-3 sentences with exact specifics from the source",
  "why_it_matters": "one sentence: specific buying opportunity for the sales rep",
  "source": "publication name",
  "source_url": "actual URL of the article",
  "date": "date of the news"
}]

Only include scoops with real source URLs. Return [] if nothing significant found.`

  const raw = await callClaude(prompt, 2000, true)
  return parseJSON<GTMScoop[]>(raw, [])
}

// ── STEP 4: Claude generates sales insights ───────────────────────────────────
interface SalesInsights {
  why_relevant: string
  executive_summary: string
  pain_points: Array<{ title: string; description: string; severity: 'high' | 'medium' | 'low' }>
  discovery_questions: string[]
  outreach_angles: Array<{ title: string; description: string }>
  tech_stack_hints: Array<{ category: string; tool: string; confidence: string; verified: boolean }>
}

async function generateInsights(
  snapshot: Snapshot,
  scoops: GTMScoop[],
  salesDescription: string
): Promise<SalesInsights> {
  const scoop_summary = scoops.slice(0, 4)
    .map(s => `[${s.type}] ${s.headline} — ${s.why_it_matters}`)
    .join('\n')

  const prompt = `You are a senior sales strategist. Generate insights based on this structured data.

SELLING: "${salesDescription}"

COMPANY:
- Name: ${snapshot.name}
- Category: ${snapshot.category}
- Stage: ${snapshot.stage} | Funding: ${snapshot.total_funding}
- Employees: ${snapshot.employee_count} | HQ: ${snapshot.hq}
- ICP: ${snapshot.icp}
- Description: ${snapshot.description}

TOP SIGNALS:
${scoop_summary || 'No recent signals found'}

Search for ${snapshot.name}'s tech stack — what tools do they use (CRM, analytics, support, marketing)?

Generate insights specific to this company. Return ONLY JSON:
{
  "why_relevant": "2 specific sentences on why this company needs what the rep sells RIGHT NOW based on their stage/signals",
  "executive_summary": "3 sentences: what they do + their current moment + the buying opportunity",
  "pain_points": [
    {"title": "specific pain tied to their stage/signals", "description": "evidence-based", "severity": "high|medium|low"}
  ],
  "discovery_questions": [
    "question referencing something specific about their company or signals"
  ],
  "outreach_angles": [
    {"title": "angle title", "description": "specific angle referencing their actual data"}
  ],
  "tech_stack_hints": [
    {"category": "CRM|Analytics|Marketing|Support|Data|Payments", "tool": "tool name", "confidence": "high|medium|low", "verified": false}
  ]
}`

  const raw = await callClaude(prompt, 1500, true)
  return parseJSON<SalesInsights>(raw, {
    why_relevant: '', executive_summary: '', pain_points: [],
    discovery_questions: [], outreach_angles: [], tech_stack_hints: [],
  })
}

// ── STEP 5: Claude writes outreach ───────────────────────────────────────────
interface OutreachKit {
  cold_email: string; linkedin_message: string; call_script: string
  objections: Array<{ objection: string; counter: string }>
}

async function writeOutreach(
  snapshot: Snapshot,
  scoops: GTMScoop[],
  insights: SalesInsights,
  salesDescription: string
): Promise<OutreachKit> {
  const topScoop = scoops[0]
    ? `${scoops[0].headline} (${scoops[0].date})`
    : insights.why_relevant

  const angle = insights.outreach_angles[0]
    ? `${insights.outreach_angles[0].title}: ${insights.outreach_angles[0].description}`
    : insights.why_relevant

  const prompt = `Write highly personalized sales outreach. Be specific — reference real signals.

SELLING: "${salesDescription}"
TARGET COMPANY: ${snapshot.name}
DESCRIPTION: ${snapshot.description}
STAGE: ${snapshot.stage} | EMPLOYEES: ${snapshot.employee_count}

TOP SIGNAL TO REFERENCE:
${topScoop}

KEY ANGLE:
${angle}

Rules:
- Reference the specific signal above — not generic praise
- Cold email subject line under 8 words
- LinkedIn message under 60 words
- Call script: one specific observation, one question, then pause
- Objections should be specific to their stage and situation

Return ONLY JSON:
{
  "cold_email": "Subject: [under 8 words]\\n\\nHi [First Name],\\n\\n[2-3 sentences: specific signal + connection to product + soft CTA]\\n\\n[Name]",
  "linkedin_message": "Hi [Name] — [50 words max, reference one real signal, clear ask]",
  "call_script": "Hi [Name], [Rep] from [Company]. [One specific observation from signals]. Quick question — [discovery question]? [Pause]",
  "objections": [
    {"objection": "likely objection from this company's perspective", "counter": "specific counter using their situation"}
  ]
}`

  const raw = await callClaude(prompt, 1000, false)
  return parseJSON<OutreachKit>(raw, {
    cold_email: '', linkedin_message: '', call_script: '', objections: [],
  })
}

// ── STEP 6: Find contacts ─────────────────────────────────────────────────────
interface Contact {
  name: string; title: string; department: string
  linkedin_url: string | null; linkedin_verified: boolean
  email_guess: string; email_pattern: string
  email_confidence: 'high' | 'medium' | 'low'
  role_in_deal: 'champion' | 'blocker' | 'influencer' | 'evaluator'
  outreach_message: string
}

async function findContacts(
  snapshot: Snapshot,
  insights: SalesInsights,
  salesDescription: string
): Promise<Contact[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const [r1, r2] = await Promise.all([
    fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({
        q: `site:linkedin.com/in "${snapshot.name}" VP OR Head OR Director OR CRO OR CMO OR Chief`,
        num: 5,
      }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
    fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({
        q: `"${snapshot.name}" leadership executives team site:linkedin.com`,
        num: 5,
      }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  const found = [...r1, ...r2]
    .filter((r: { link: string }) => r.link?.includes('linkedin.com/in/') && !r.link.includes('/in/search'))
    .map((r: { title: string; snippet: string; link: string }) => ({
      name: r.title?.split(' - ')[0]?.replace(' | LinkedIn', '')?.trim() || '',
      title: r.title?.split(' - ')[1]?.trim() || '',
      url: r.link,
    }))
    .filter(p => p.name.length > 2 && p.name.length < 50)
    .slice(0, 6)

  if (!found.length) return []

  const domain = snapshot.domain
  const contactList = found.map((p, i) => `${i + 1}. ${p.name} — ${p.title}`).join('\n')

  const prompt = `Company: ${snapshot.name} (${snapshot.category}, ${snapshot.stage})
Domain: ${domain}
Rep sells: "${salesDescription}"
Key insight: ${insights.why_relevant}

Contacts found at ${snapshot.name}:
${contactList}

For each contact: assign their role in the buying decision and write a personalized 3-line outreach message.
Return ONLY JSON array:
[{
  "name": "exact name",
  "title": "exact title",
  "department": "Sales|RevOps|CS|Product|Engineering|Finance|IT|Marketing|Executive",
  "email_guess": "firstname@${domain}",
  "email_pattern": "first@${domain}",
  "email_confidence": "high|medium|low",
  "role_in_deal": "champion|blocker|influencer|evaluator",
  "outreach_message": "Hi [name], [3 lines specific to ${snapshot.name} and what the rep sells]"
}]`

  const raw = await callClaude(prompt, 800, false)
  const enriched = parseJSON<Array<Omit<Contact, 'linkedin_url' | 'linkedin_verified'>>>(raw, [])

  const validated = await Promise.all(
    enriched.slice(0, 6).map(async (c, i) => {
      const foundPerson = found[i]
      if (foundPerson?.url?.includes('linkedin.com/in/')) {
        const slug = foundPerson.url.split('linkedin.com/in/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase() || ''
        const parts = c.name.toLowerCase().split(' ')
        const score =
          (slug.includes(parts[0]?.slice(0, 4) || '') ? 35 : 0) +
          (slug.includes(parts[parts.length - 1]?.slice(0, 4) || '') ? 35 : 0)
        if (score >= 70) return { ...c, linkedin_url: foundPerson.url.split('?')[0], linkedin_verified: true }
        if (score >= 35) return { ...c, linkedin_url: foundPerson.url.split('?')[0], linkedin_verified: false }
      }
      const { url, verified } = await validateLinkedIn(c.name, snapshot.name, c.title)
      return { ...c, linkedin_url: url, linkedin_verified: verified }
    })
  )

  return validated
}

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────────
export async function runFullResearch(
  companyName: string,
  salesDescription: string,
  targetIndustries: string[]
) {
  try {
    const hasClaude = process.env.ANTHROPIC_API_KEY &&
      process.env.ANTHROPIC_API_KEY !== 'placeholder_add_later'

    console.log(`Research engine: ${hasClaude ? 'Claude' : 'Groq'} for ${companyName}`)

    // Steps 1+2: Research and extract snapshot
    const snapshot = await researchAndExtract(companyName)

    // Step 3: find scoops with web search
    const scoops: GTMScoop[] = await findScoops(snapshot, salesDescription)
    // Step 4: generate insights from scoops
    const insights: SalesInsights = await generateInsights(snapshot, scoops, salesDescription)

    // Step 5: Outreach (needs insights)
    const outreach = await writeOutreach(snapshot, scoops, insights, salesDescription)

    // Step 6: Contacts
    const contacts = await findContacts(snapshot, insights, salesDescription)

    // Build tech stack from insights
    const techStack = insights.tech_stack_hints.length > 0
      ? insights.tech_stack_hints.map(t => ({
          category: t.category,
          tool: t.tool,
          confidence: t.confidence as 'high' | 'medium' | 'low',
          verified: t.verified,
          source: t.verified ? 'Verified' : 'AI research',
        }))
      : []

    // All signals
    const allScoops = scoops.filter(s => s.source_url)

    return {
      company: {
        name: snapshot.name || companyName,
        domain: snapshot.domain,
        industry: snapshot.industry,
        size: snapshot.employee_count,
        stage: snapshot.stage,
        hq: snapshot.hq,
        linkedin_url: snapshot.linkedin_url !== 'Unknown' ? snapshot.linkedin_url : null,
        description: snapshot.description,
        founded: snapshot.founded,
        total_funding: snapshot.total_funding,
        latest_round: snapshot.latest_round,
        investors: snapshot.investors,
        priority_score: snapshot.priority_score,
      },
      executive_summary: insights.executive_summary || snapshot.description,
      business_model: snapshot.business_model,
      gtm_motion: `${snapshot.icp} — ${snapshot.business_model}`,
      why_relevant: insights.why_relevant,
      gtm_scoops: allScoops,
      pain_points: insights.pain_points,
      tech_stack: techStack,
      buying_signals: allScoops.map(s => ({
        signal: s.headline,
        why_it_matters: s.why_it_matters,
        source: s.source,
        source_url: s.source_url,
        date: s.date,
      })),
      discovery_questions: insights.discovery_questions,
      outreach_angles: insights.outreach_angles,
      cold_email: outreach.cold_email,
      linkedin_message: outreach.linkedin_message,
      call_script: outreach.call_script,
      objections: outreach.objections,
      contacts,
      recent_news: allScoops.map(s => ({
        title: s.headline,
        summary: s.detail,
        source_name: s.source,
        source_url: s.source_url,
        date: s.date,
        signal_type: s.type,
      })),
      job_signals: [],
    }
  } catch (err) {
    console.error('Research pipeline error:', err)
    return null
  }
}

// ── DISCOVER ──────────────────────────────────────────────────────────────────
export async function discoverCompanies(
  salesDescription: string,
  targetIndustries: string[],
  targetSizes: string[],
  icpNotes: string,
  count = 5
): Promise<string[]> {
  const ind = targetIndustries.slice(0, 2).join(' ')
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const [s1, s2, s3] = await Promise.all([
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `AI SaaS startup ${ind} funding raised 2025 2026`, num: 10, type: 'news' }) }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `AI-first ${ind} company product launch 2025`, num: 8, type: 'news' }) }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `top AI ${ind} startups raised funding 2025`, num: 8 }) }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  const skip = new Set(['techcrunch', 'crunchbase', 'linkedin', 'forbes', 'bloomberg', 'medium', 'github', 'reddit', 'g2', 'glassdoor'])
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const r of [...s1, ...s2, ...s3]) {
    try {
      const domain = new URL(r.link).hostname.replace('www.', '')
      const base = domain.split('.')[0]
      if (skip.has(base) || seen.has(domain)) continue
      seen.add(domain)
      const name = r.title?.replace(/\s*[-|–:]\s*.*/g, '')?.replace(/\s*(Inc|LLC|Ltd|Corp)\.?$/gi, '')?.trim()
      if (name && name.length > 2 && name.length < 50) {
        candidates.push(name)
        if (candidates.length >= 15) break
      }
    } catch { continue }
  }

  if (!candidates.length) return []

  const prompt = `Rep sells: "${salesDescription.slice(0, 150)}" to ${ind}. ICP: ${icpNotes || 'AI-first SaaS'}
Pick ${count} best AI-first companies (not media/aggregators):
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}
Return ONLY: ["Company A","Company B"]`

  const raw = await callClaude(prompt, 200, false)
  return parseJSON<string[]>(raw, candidates.slice(0, count))
}

// ── SIGNAL REFRESH ────────────────────────────────────────────────────────────
export async function refreshSignals(
  companyName: string,
  domain: string,
  salesDescription: string,
  lastCheckedAt: string | null
) {
  const since = lastCheckedAt
    ? `since ${new Date(lastCheckedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'in the last 7 days'

  const prompt = `Search for new signals for "${companyName}" (${domain}) ${since}.

Look for: funding, acquisitions, layoffs, leadership changes, product launches, partnerships.

Rep sells: "${salesDescription}"

Return ONLY JSON array ([] if nothing new):
[{
  "signal_type": "funding|acquisition|layoff|leadership_change|product_launch|partnership|expansion|press|other",
  "title": "specific headline",
  "summary": "2 sentences: what happened + why it matters for sales",
  "source_name": "publication",
  "source_url": "actual URL",
  "source_verified": true,
  "signal_date": "YYYY-MM-DD"
}]`

  const raw = await callClaude(prompt, 1000, true)
  return parseJSON<SignalResult[]>(raw, [])
}

export async function generateDigestSummary(
  salesDescription: string,
  signalsByProspect: Array<{ company: string; signals: SignalResult[] }>
) {
  const text = signalsByProspect
    .map(p => `${p.company}: ${p.signals.map(s => `[${s.signal_type}] ${s.title}`).join(', ')}`)
    .join('\n')

  const prompt = `Sales coach for rep selling "${salesDescription}".
Signals today: ${text}
Write 3-4 sentence briefing: top signal to act on, which company to call first, why. Plain text only.`

  return callClaude(prompt, 300, false)
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
