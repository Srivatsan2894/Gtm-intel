/**
 * GTM Intel Research Engine v7 — Structured AI Pipeline
 *
 * Architecture:
 * - Data layer (data-layer.ts) fetches all facts — no AI
 * - Each AI prompt receives clean structured JSON — not raw web text
 * - Each prompt does exactly one job
 * - Temperature 0 for extraction, 0.2 for analysis, 0.3 for creative
 */

import { fetchCompanyData, type RawCompanyData, type TechTool, type JobSignal } from './data-layer'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

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

// ── LinkedIn validator ────────────────────────────────────────────────────────
async function validateLinkedIn(
  name: string, company: string, title: string
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
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q, num: 3 }),
      })
      const data = await res.json()
      const results = data.organic || []

      for (const r of results) {
        if (!r.link?.includes('linkedin.com/in/')) continue
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
    } catch { continue }
  }
  return { url: null, verified: false }
}

// ── PROMPT A: Extract company snapshot ───────────────────────────────────────
// Input: raw search data (structured text)
// Output: clean JSON facts
// Temperature: 0 — pure extraction, no creativity

interface CompanySnapshot {
  name: string
  domain: string
  industry: string
  category: string
  hq: string
  founded: string
  employee_count: string
  stage: string
  total_funding: string
  latest_round: string
  investors: string
  description: string
  linkedin_url: string
  website: string
  icp: string
  business_model: string
  priority_score: number
}

async function promptA_extractSnapshot(data: RawCompanyData): Promise<CompanySnapshot> {
  const prompt = `You are a data extraction engine. Extract ONLY facts explicitly stated in the sources below.
Do NOT infer, guess, or generate. If a field is not found, use "Unknown".

Company: "${data.companyName}"

WEBSITE DATA:
${data.websiteSnippets}

LINKEDIN DATA:
${data.linkedinSnippets}
LinkedIn URL: ${data.linkedinCompanyUrl || 'not found'}

FUNDING/CRUNCHBASE:
${data.fundingSnippets}
${data.crunchbaseSnippets}

Return ONLY this JSON, no explanation:
{
  "name": "exact company name",
  "domain": "${data.domain}",
  "industry": "industry from sources",
  "category": "specific product category e.g. AI Sales Intelligence",
  "hq": "city, country from sources",
  "founded": "year or Unknown",
  "employee_count": "count or range or Unknown",
  "stage": "Seed|Series A|Series B|Series C|Growth|Public|Unknown",
  "total_funding": "total amount or Unknown",
  "latest_round": "round + amount + date or Unknown",
  "investors": "investor names from sources or Unknown",
  "description": "2 sentences max from website",
  "linkedin_url": "${data.linkedinCompanyUrl || 'Unknown'}",
  "website": "domain from sources",
  "icp": "who they sell to from sources or Unknown",
  "business_model": "SaaS|Usage-based|Freemium|Enterprise|Marketplace|Unknown",
  "priority_score": 7
}`

  const raw = await groq(prompt, 800, 0.0)
  return parseJSON<CompanySnapshot>(raw, {
    name: data.companyName, domain: data.domain, industry: 'Unknown', category: 'Unknown',
    hq: 'Unknown', founded: 'Unknown', employee_count: 'Unknown', stage: 'Unknown',
    total_funding: 'Unknown', latest_round: 'Unknown', investors: 'Unknown',
    description: '', linkedin_url: data.linkedinCompanyUrl || '', website: data.domain,
    icp: 'Unknown', business_model: 'Unknown', priority_score: 5,
  })
}

// ── PROMPT B: Classify and enrich news signals ────────────────────────────────
// Input: news items + job signals (structured)
// Output: classified GTM scoops with sales angles
// Temperature: 0.1

interface GTMScoop {
  type: string
  headline: string
  detail: string
  why_it_matters: string
  source: string
  source_url: string
  date: string
}

async function promptB_classifySignals(
  snapshot: CompanySnapshot,
  data: RawCompanyData,
  salesDescription: string
): Promise<GTMScoop[]> {

  const newsText = data.recentNews.slice(0, 8).map(n =>
    `[${n.type.toUpperCase()}] ${n.title} — ${n.snippet} (Source: ${n.source}, ${n.date}, URL: ${n.url})`
  ).join('\n')

  const jobText = data.jobSignals.slice(0, 4).map(j =>
    `JOB: ${j.title} | Tools: ${j.tools_mentioned.join(', ')} | Signals: ${j.signals.join(', ')}`
  ).join('\n')

  const prompt = `You are a sales signal analyst.

Sales rep sells: "${salesDescription}"
Company: ${snapshot.name} (${snapshot.category}, ${snapshot.stage}, ${snapshot.employee_count} employees)

NEWS SIGNALS:
${newsText || 'No recent news found'}

HIRING SIGNALS:
${jobText || 'No job signals found'}

For each signal, explain why it creates a buying opportunity for this sales rep.
Return ONLY JSON array:
[{
  "type": "funding|leadership_change|hiring_spike|expansion|product_launch|partnership|tech_change|press",
  "headline": "punchy 8-word headline",
  "detail": "2-3 sentences with specifics from the data above",
  "why_it_matters": "one sentence: why this is a buying signal for the rep",
  "source": "publication name",
  "source_url": "url from data",
  "date": "date from data"
}]

Only include signals with real specifics. Max 8 scoops.`

  const raw = await groq(prompt, 1200, 0.1)
  return parseJSON<GTMScoop[]>(raw, [])
}

// ── PROMPT C: Generate sales insights ────────────────────────────────────────
// Input: clean snapshot + verified tech stack + scoops
// Output: pain points, discovery questions, outreach angles
// Temperature: 0.2

interface SalesInsights {
  why_relevant: string
  executive_summary: string
  pain_points: Array<{ title: string; description: string; severity: 'high' | 'medium' | 'low' }>
  discovery_questions: string[]
  outreach_angles: Array<{ title: string; description: string }>
  icp_fit_score: number
  icp_fit_reasoning: string
}

async function promptC_generateInsights(
  snapshot: CompanySnapshot,
  techStack: TechTool[],
  scoops: GTMScoop[],
  jobSignals: JobSignal[],
  salesDescription: string
): Promise<SalesInsights> {

  // Group tech stack by category for clean context
  const techByCategory: Record<string, string[]> = {}
  for (const t of techStack.slice(0, 40)) {
    if (!techByCategory[t.category]) techByCategory[t.category] = []
    techByCategory[t.category].push(t.name)
  }
  const techContext = Object.entries(techByCategory)
    .map(([cat, tools]) => `${cat}: ${tools.join(', ')}`)
    .join('\n')

  const scoopeContext = scoops.slice(0, 4)
    .map(s => `[${s.type}] ${s.headline}: ${s.why_it_matters}`)
    .join('\n')

  const toolsMentionedInJobs = Array.from(new Set(jobSignals.flatMap(j => j.tools_mentioned)))

  const prompt = `You are a senior sales strategist. Generate insights based ONLY on the structured data below.

WHAT REP SELLS: "${salesDescription}"

COMPANY:
Name: ${snapshot.name}
Category: ${snapshot.category}
Stage: ${snapshot.stage}
Employees: ${snapshot.employee_count}
ICP they serve: ${snapshot.icp}
Business model: ${snapshot.business_model}
Description: ${snapshot.description}

VERIFIED TECH STACK (from BuiltWith):
${techContext || 'No BuiltWith data available'}

TOOLS MENTIONED IN JOB POSTINGS:
${toolsMentionedInJobs.join(', ') || 'None found'}

TOP BUYING SIGNALS:
${scoopeContext || 'No signals found'}

Based on this specific data, generate insights. Return ONLY JSON:
{
  "why_relevant": "2 specific sentences on why rep's product fits this company RIGHT NOW based on their actual data",
  "executive_summary": "3 sentences: what they do + their current moment + the opportunity for the rep",
  "pain_points": [
    {"title":"specific pain tied to their tech/stage/signals","description":"why they have this pain based on their actual data","severity":"high|medium|low"}
  ],
  "discovery_questions": [
    "question referencing something specific from their stack or signals"
  ],
  "outreach_angles": [
    {"title":"angle title","description":"specific angle based on their tech stack or hiring or funding signal"}
  ],
  "icp_fit_score": 8,
  "icp_fit_reasoning": "2 sentences on why this is or isn't a strong ICP fit"
}`

  const raw = await groq(prompt, 1200, 0.2)
  return parseJSON<SalesInsights>(raw, {
    why_relevant: '', executive_summary: '', pain_points: [],
    discovery_questions: [], outreach_angles: [], icp_fit_score: 5, icp_fit_reasoning: '',
  })
}

// ── PROMPT D: Write outreach ──────────────────────────────────────────────────
// Input: snapshot + top 2 scoops + top angle
// Output: cold email, LinkedIn message, call script
// Temperature: 0.3 (needs creativity but stays on target)

interface OutreachKit {
  cold_email: string
  linkedin_message: string
  call_script: string
  objections: Array<{ objection: string; counter: string }>
}

async function promptD_writeOutreach(
  snapshot: CompanySnapshot,
  scoops: GTMScoop[],
  insights: SalesInsights,
  salesDescription: string
): Promise<OutreachKit> {

  const topScoops = scoops.slice(0, 2)
    .map(s => `${s.headline} (${s.date}) — ${s.why_it_matters}`)
    .join('\n')

  const topAngle = insights.outreach_angles[0]
    ? `${insights.outreach_angles[0].title}: ${insights.outreach_angles[0].description}`
    : insights.why_relevant

  const prompt = `You are an expert SDR writing personalized outreach. Be specific. Reference the actual signals below.

REP SELLS: "${salesDescription}"
TARGET: ${snapshot.name} — ${snapshot.description}
STAGE: ${snapshot.stage} | EMPLOYEES: ${snapshot.employee_count}

TOP SIGNALS TO REFERENCE:
${topScoops || insights.why_relevant}

MAIN ANGLE:
${topAngle}

Rules:
- Reference ONE specific signal in each piece of outreach
- No generic phrases like "I noticed you're growing" — be specific
- Cold email subject line must be under 8 words
- LinkedIn message must be under 60 words
- Call script opens with a specific observation, not a pitch

Return ONLY JSON:
{
  "cold_email": "Subject: [under 8 words]\\n\\nHi [First Name],\\n\\n[2-3 sentences: specific observation + connection to rep's product + soft CTA]\\n\\n[Name]",
  "linkedin_message": "Hi [Name] — [1-2 sentences, 60 words max, reference one specific thing]",
  "call_script": "Hi [Name], [Rep] from [Company]. Quick question — [specific observation from signals]. [One discovery question]. [Pause]",
  "objections": [
    {"objection":"specific objection for this company","counter":"specific counter referencing their data"}
  ]
}`

  const raw = await groq(prompt, 1000, 0.3)
  return parseJSON<OutreachKit>(raw, {
    cold_email: '', linkedin_message: '', call_script: '', objections: [],
  })
}

// ── PROMPT E: Find and enrich contacts ───────────────────────────────────────
// Input: snapshot + insights
// Output: contacts with validated LinkedIn + guessed email

interface Contact {
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

async function promptE_contacts(
  snapshot: CompanySnapshot,
  insights: SalesInsights,
  salesDescription: string
): Promise<Contact[]> {

  const key = process.env.SERPER_API_KEY
  if (!key) return []

  // Search for real people at this company
  const [people1, people2] = await Promise.all([
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({
        q: `site:linkedin.com/in "${snapshot.name}" VP OR Head OR Director OR CRO OR "Chief Revenue" OR "Chief Marketing"`,
        num: 5,
      }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({
        q: `"${snapshot.name}" "VP of Sales" OR "Head of RevOps" OR "VP Customer Success" OR "CRO" site:linkedin.com`,
        num: 5,
      }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  const foundPeople = [...people1, ...people2]
    .filter((r: { link: string }) => r.link?.includes('linkedin.com/in/'))
    .map((r: { title: string; snippet: string; link: string }) => ({
      name: r.title?.split(' - ')[0]?.replace(' | LinkedIn', '')?.trim() || '',
      title: r.title?.split(' - ')[1]?.trim() || r.snippet?.split(' at ')[0]?.trim() || '',
      snippet: r.snippet || '',
      url: r.link,
    }))
    .filter(p => p.name.length > 2 && p.name.length < 50)
    .slice(0, 6)

  if (!foundPeople.length) return []

  const domain = snapshot.domain || snapshot.website
  const contactList = foundPeople.map((p, i) => `${i + 1}. ${p.name} — ${p.title}`).join('\n')

  const prompt = `Company: ${snapshot.name} (${snapshot.category}, ${snapshot.stage})
Domain: ${domain}
Rep sells: "${salesDescription}"
Key insight: ${insights.why_relevant}

Contacts found:
${contactList}

For each contact, assign their role in a buying decision and write a 3-line personalized message.
Return ONLY JSON array:
[{
  "name": "exact name",
  "title": "exact title",
  "department": "Sales|RevOps|CS|Product|Engineering|Finance|IT|Marketing|Executive",
  "email_guess": "firstname@${domain}",
  "email_pattern": "first@${domain}",
  "email_confidence": "high|medium|low",
  "role_in_deal": "champion|blocker|influencer|evaluator",
  "outreach_message": "Hi [name], [3 lines referencing the rep's product and something specific about ${snapshot.name}]"
}]`

  const raw = await groq(prompt, 800, 0.2)
  const enriched = parseJSON<Array<Omit<Contact, 'linkedin_url' | 'linkedin_verified'>>>(raw, [])

  // Validate LinkedIn in parallel
  const validated = await Promise.all(
    enriched.slice(0, 6).map(async (c, i) => {
      const found = foundPeople[i]
      if (found?.url && found.url.includes('linkedin.com/in/')) {
        const slug = found.url.split('linkedin.com/in/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase() || ''
        const nameParts = c.name.toLowerCase().split(' ')
        const score = (slug.includes(nameParts[0]?.slice(0, 4)) ? 35 : 0) +
                      (slug.includes(nameParts[nameParts.length - 1]?.slice(0, 4)) ? 35 : 0)
        if (score >= 70) return { ...c, linkedin_url: found.url.split('?')[0], linkedin_verified: true }
        if (score >= 35) return { ...c, linkedin_url: found.url.split('?')[0], linkedin_verified: false }
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
    // LAYER 1: Fetch all data (no AI)
    const rawData = await fetchCompanyData(companyName)

    // LAYER 2: AI pipeline on clean structured data
    // Run snapshot extraction first (everything else depends on it)
    const snapshot = await promptA_extractSnapshot(rawData)

    // Run signals + insights in parallel (both need snapshot, not each other)
    const [scoops, insights] = await Promise.all([
      promptB_classifySignals(snapshot, rawData, salesDescription),
      promptC_generateInsights(snapshot, rawData.techStack, [], rawData.jobSignals, salesDescription),
    ])

    // Run outreach + contacts in parallel (both need insights)
    const [outreach, contacts] = await Promise.all([
      promptD_writeOutreach(snapshot, scoops, insights, salesDescription),
      promptE_contacts(snapshot, insights, salesDescription),
    ])

    // Group tech stack by category for display
    const techByCategory: Record<string, string[]> = {}
    for (const t of rawData.techStack) {
      if (!techByCategory[t.category]) techByCategory[t.category] = []
      techByCategory[t.category].push(t.name)
    }

    return {
      company: {
        name: snapshot.name || companyName,
        domain: snapshot.domain,
        industry: snapshot.industry,
        size: snapshot.employee_count,
        stage: snapshot.stage,
        hq: snapshot.hq,
        linkedin_url: snapshot.linkedin_url,
        description: snapshot.description,
        founded: snapshot.founded,
        total_funding: snapshot.total_funding,
        latest_round: snapshot.latest_round,
        investors: snapshot.investors,
        priority_score: insights.icp_fit_score || snapshot.priority_score,
        icp_fit_reasoning: insights.icp_fit_reasoning,
      },
      executive_summary: insights.executive_summary || snapshot.description,
      business_model: snapshot.business_model,
      gtm_motion: `${snapshot.icp} — ${snapshot.business_model}`,
      why_relevant: insights.why_relevant,
      gtm_scoops: scoops,
      pain_points: insights.pain_points,
      // Tech stack: BuiltWith verified first, then job-parsed hints
      tech_stack: rawData.techStack.length > 0
        ? Object.entries(techByCategory).map(([cat, tools]) => ({
            category: cat,
            tool: tools.join(', '),
            confidence: 'high' as const,
            verified: true,
            source: 'BuiltWith',
          }))
        : rawData.jobSignals.flatMap(j => j.tools_mentioned).map(t => ({
            category: 'Detected in job postings',
            tool: t,
            confidence: 'medium' as const,
            verified: false,
            source: 'Job postings',
          })),
      buying_signals: scoops.map(s => ({
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
      recent_news: rawData.recentNews.map(n => ({
        title: n.title,
        summary: n.snippet,
        source_name: n.source,
        source_url: n.url,
        date: n.date,
        signal_type: n.type,
      })),
      job_signals: rawData.jobSignals,
    }
  } catch (err) {
    console.error('Research pipeline error:', err)
    return null
  }
}

// ── DISCOVER ─────────────────────────────────────────────────────────────────

export async function discoverCompanies(
  salesDescription: string,
  targetIndustries: string[],
  targetSizes: string[],
  icpNotes: string,
  count = 5
): Promise<string[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const ind = targetIndustries.slice(0, 2).join(' ')
  const stage = targetSizes.some(s => s.includes('1000')) ? 'Series C D' :
    targetSizes.some(s => s.includes('501')) ? 'Series B C' : 'Series A B'

  const [s1, s2, s3] = await Promise.all([
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `AI SaaS startup ${ind} "${stage}" funding raised 2025 2026`, num: 10, type: 'news' }),
    }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `AI-first ${ind} startup product launch 2025 2026`, num: 8, type: 'news' }),
    }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `top AI ${ind} companies raised funding 2025`, num: 8 }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  const excluded = new Set(['techcrunch','crunchbase','linkedin','forbes','bloomberg','medium','github','reddit','g2','glassdoor'])
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const r of [...s1, ...s2, ...s3]) {
    try {
      const domain = new URL(r.link).hostname.replace('www.', '')
      if (excluded.has(domain.split('.')[0])) continue
      if (seen.has(domain)) continue
      seen.add(domain)
      const name = r.title?.replace(/\s*[-|–:]\s*.*/g, '')?.replace(/\s*(Inc|LLC|Ltd|Corp)\.?$/gi, '')?.trim()
      if (name && name.length > 2 && name.length < 50) {
        candidates.push(name)
        if (candidates.length >= 15) break
      }
    } catch { continue }
  }

  if (!candidates.length) return []

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) return candidates.slice(0, count)

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Rep sells: "${salesDescription.slice(0, 150)}" to ${ind} companies. ICP: ${icpNotes || 'AI-first SaaS'}
Pick ${count} best AI-first companies (not media/news sites):
${candidates.map((c, i) => `${i+1}. ${c}`).join('\n')}
Return ONLY: ["Company A","Company B"]`
      }],
      max_tokens: 150, temperature: 0.0,
    }),
  })
  const d = await res.json()
  const raw = d.choices?.[0]?.message?.content || ''
  return parseJSON<string[]>(raw, candidates.slice(0, count))
}

// ── Signal refresh ────────────────────────────────────────────────────────────

export async function refreshSignals(
  companyName: string,
  domain: string,
  salesDescription: string,
  lastCheckedAt: string | null
) {
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const since = lastCheckedAt
    ? `since ${new Date(lastCheckedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'in the last 7 days'

  const [news, funding, hiring] = await Promise.all([
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `"${companyName}" news announcement ${since}`, num: 5, type: 'news' }),
    }).then(r => r.json()).then(d => (d.news || []).map((n: { title: string; snippet: string; link: string; date?: string; source?: string }) =>
      `[NEWS] ${n.title} — ${n.snippet} (${n.source || ''}, ${n.date || ''}, ${n.link})`
    ).join('\n')).catch(() => ''),
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `"${companyName}" funding raised ${since}`, num: 4, type: 'news' }),
    }).then(r => r.json()).then(d => (d.news || []).map((n: { title: string; snippet: string; link: string; date?: string; source?: string }) =>
      `[FUNDING] ${n.title} — ${n.snippet} (${n.source || ''}, ${n.date || ''}, ${n.link})`
    ).join('\n')).catch(() => ''),
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `"${companyName}" new hire executive appointed ${since}`, num: 3 }),
    }).then(r => r.json()).then(d => (d.organic || []).map((n: { title: string; snippet: string; link: string }) =>
      `[HIRE] ${n.title} — ${n.snippet} (${n.link})`
    ).join('\n')).catch(() => ''),
  ])

  const combined = [news, funding, hiring].filter(Boolean).join('\n\n')
  if (!combined.trim()) return []

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) return []

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Rep sells: "${salesDescription}". Extract new signals ${since} for "${companyName}".
Data: ${combined}
Return ONLY JSON array ([] if nothing new):
[{"signal_type":"funding|hiring|product_launch|leadership_change|expansion|press|other","title":"headline","summary":"2 sentences + why it matters for sales","source_name":"pub","source_url":"url","source_verified":true,"signal_date":"YYYY-MM-DD"}]`
      }],
      max_tokens: 800, temperature: 0.0,
    }),
  })
  const d = await res.json()
  return parseJSON<SignalResult[]>(d.choices?.[0]?.message?.content || '', [])
}

export async function generateDigestSummary(
  salesDescription: string,
  signalsByProspect: Array<{ company: string; signals: SignalResult[] }>
) {
  const key = process.env.GROQ_API_KEY
  if (!key) return ''
  const text = signalsByProspect.map(p =>
    `${p.company}: ${p.signals.map(s => `[${s.signal_type}] ${s.title}`).join(', ')}`
  ).join('\n')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `Coach for rep selling "${salesDescription}". Signals: ${text}. 3-4 sentence briefing: top signal, who to call first, why. Plain text.` }],
      max_tokens: 200, temperature: 0.2,
    }),
  })
  const d = await res.json()
  return d.choices?.[0]?.message?.content || ''
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
