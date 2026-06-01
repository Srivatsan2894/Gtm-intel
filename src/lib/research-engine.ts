// Research engine — Groq (Llama 3.3 70B) + Serper web search + LinkedIn validation

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const SERPER_API = 'https://google.serper.dev/search'

// ── Serper search ────────────────────────────────────────────────────────────
async function webSearch(query: string, num = 5): Promise<string> {
  const key = process.env.SERPER_API_KEY
  if (!key) return `No Serper key — training data only for: ${query}`
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num }),
    })
    const data = await res.json()
    return (data.organic || []).slice(0, num)
      .map((r: { title: string; snippet: string; link: string }) =>
        `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`)
      .join('\n\n')
  } catch { return `Search failed: ${query}` }
}

// ── LinkedIn URL finder ──────────────────────────────────────────────────────
async function findLinkedInProfile(name: string, company: string): Promise<{ url: string; verified: boolean }> {
  const key = process.env.SERPER_API_KEY
  if (!key) return { url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`, verified: false }
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `site:linkedin.com/in "${name}" "${company}"`, num: 3 }),
    })
    const data = await res.json()
    const hit = (data.organic || []).find((r: { link: string }) =>
      r.link.includes('linkedin.com/in/') && !r.link.includes('/in/search')
    )
    if (hit) return { url: hit.link.split('?')[0], verified: true }
    return { url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`, verified: false }
  } catch { return { url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`, verified: false } }
}

async function findCompanyLinkedIn(companyName: string): Promise<string> {
  const key = process.env.SERPER_API_KEY
  if (!key) return `https://www.linkedin.com/company/${companyName.toLowerCase().replace(/\s+/g, '-')}`
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `site:linkedin.com/company "${companyName}"`, num: 3 }),
    })
    const data = await res.json()
    const hit = (data.organic || []).find((r: { link: string }) =>
      r.link.includes('linkedin.com/company/')
    )
    return hit ? hit.link.split('?')[0] : `https://www.linkedin.com/company/${companyName.toLowerCase().replace(/\s+/g, '-')}`
  } catch { return `https://www.linkedin.com/company/${companyName.toLowerCase().replace(/\s+/g, '-')}` }
}

// ── Groq LLM ────────────────────────────────────────────────────────────────
async function callGroq(prompt: string, maxTokens = 4000): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not configured')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  })
  if (!res.ok) { const e = await res.text(); throw new Error(`Groq error ${res.status}: ${e}`) }
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

// ── DISCOVER companies matching ICP ─────────────────────────────────────────
export async function discoverCompanies(
  salesDescription: string,
  targetIndustries: string[],
  targetSizes: string[],
  icpNotes: string,
  count = 5
): Promise<string[]> {
  const searchData = await webSearch(
    `top ${targetIndustries[0] || 'B2B SaaS'} companies hiring sales revops 2025 2026 series B C growth`, 8
  )

  const prompt = `You are a GTM analyst helping a sales rep find ideal target accounts.

Sales rep sells: "${salesDescription}"
Target industries: ${targetIndustries.join(', ')}
Target company sizes: ${targetSizes.join(', ')}
ICP notes: ${icpNotes || 'none'}

Recent market data:
${searchData}

Identify exactly ${count} real companies that are the BEST fit for this sales rep to prospect RIGHT NOW.

CRITICAL — Only return companies that are:
- AI-first or AI-native (built around AI as core product, not just using AI as a feature)
- Startups or scale-ups (founded in last 10 years, not legacy enterprises)
- Actively growing with recent funding, hiring, or product signals
- Match the target industries and sizes
- Likely experiencing the pain points this product solves

Good examples: AI copilot tools, LLM platforms, vertical AI SaaS, AI automation startups, AI data tools
Bad examples: Microsoft, Salesforce, Oracle, SAP, legacy SaaS incumbents

Return ONLY a JSON array of company names and their websites, nothing else:
[{"name":"Company Name","domain":"company.com"},{"name":"Company 2","domain":"company2.io"}]`

  const raw = await callGroq(prompt, 500)
  // Handle both formats: [{name, domain}] or ["name"]
  const parsed = parseJSON<Array<{name: string; domain: string} | string>>(raw, [])
  return parsed.map(item => typeof item === 'string' ? item : item.name)
}

// ── FULL GTM RESEARCH ────────────────────────────────────────────────────────
export async function runFullResearch(
  companyName: string,
  salesDescription: string,
  targetIndustries: string[]
) {
  // Parallel web searches + LinkedIn validation
  const [overview, news, jobs, funding, companyLinkedIn] = await Promise.all([
    webSearch(`${companyName} company overview product 2025`),
    webSearch(`${companyName} news announcement product launch 2025 2026`),
    webSearch(`${companyName} hiring jobs VP Director Head 2025 2026`),
    webSearch(`${companyName} funding revenue valuation investors`),
    findCompanyLinkedIn(companyName),
  ])

  const prompt = `You are a senior GTM strategist. Sales rep sells: "${salesDescription}". Research: "${companyName}".

Web data:
OVERVIEW: ${overview}
NEWS: ${news}
HIRING: ${jobs}
FUNDING: ${funding}

Company LinkedIn (verified): ${companyLinkedIn}

Return ONLY raw valid JSON — no markdown, no explanation:
{
  "company": {
    "name": "${companyName}",
    "domain": "domain.com",
    "industry": "string",
    "size": "string",
    "stage": "string",
    "hq": "string",
    "linkedin_url": "${companyLinkedIn}",
    "description": "string",
    "priority_score": 8
  },
  "executive_summary": "3-4 sentences: why this company, why now, what hurts",
  "business_model": "string",
  "gtm_motion": "string",
  "why_relevant": "why this sales rep product fits specifically",
  "pain_points": [{"title":"string","description":"string","severity":"high"}],
  "tech_stack": [{"category":"string","tool":"string","confidence":"high"}],
  "buying_signals": [{"signal":"string","source":"string","source_url":"string","date":"string"}],
  "recent_news": [{"title":"string","summary":"string","source":"string","source_url":"string","date":"string","signal_type":"press"}],
  "discovery_questions": ["string"],
  "outreach_angles": [{"title":"string","description":"string"}],
  "cold_email": "full personalized cold email",
  "linkedin_message": "full linkedin message",
  "call_script": "full call opening script",
  "objections": [{"objection":"string","counter":"string"}],
  "contacts": [
    {
      "name": "real person name",
      "title": "their title",
      "department": "string",
      "email_guess": "firstname@domain.com",
      "email_pattern": "first@domain.com",
      "email_confidence": "medium",
      "role_in_deal": "champion",
      "outreach_message": "personalized 4-5 line message for this specific person"
    }
  ]
}

Rules:
- signal_type: funding|hiring|product_launch|leadership_change|expansion|partnership|press|financial|competitive|other
- role_in_deal: champion|blocker|influencer|evaluator  
- email_confidence: high|medium|low
- Find 5-6 REAL people at ${companyName} — VP Sales, Head RevOps, VP CS, CRO, CFO, Head Product
- Tailor everything to how "${salesDescription}" helps ${companyName}
- Use the web data to make signals and news specific and accurate`

  const raw = await callGroq(prompt, 4000)
  const research = parseJSON<Record<string, unknown> | null>(raw, null)
  if (!research) return null

  // Validate LinkedIn URLs for contacts
  const contacts = research.contacts as Array<Record<string, unknown>>
  if (Array.isArray(contacts)) {
    const validated = await Promise.all(
      contacts.map(async (c) => {
        const { url, verified } = await findLinkedInProfile(
          c.name as string,
          companyName
        )
        return { ...c, linkedin_url: url, linkedin_verified: verified }
      })
    )
    research.contacts = validated
  }

  // Ensure company LinkedIn is set
  if (research.company) {
    (research.company as Record<string, unknown>).linkedin_url = companyLinkedIn
  }

  return research
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

  const [news, hiring, funding] = await Promise.all([
    webSearch(`${companyName} news ${since}`),
    webSearch(`${companyName} new hire appointment executive ${since}`),
    webSearch(`${companyName} funding investment ${since}`),
  ])

  const prompt = `Sales rep sells: "${salesDescription}". Monitor: "${companyName}" (${domain}).

Recent web data:
NEWS: ${news}
HIRING: ${hiring}
FUNDING: ${funding}

Find new signals ${since}. Return ONLY JSON array:
[{"signal_type":"press","title":"string","summary":"2-3 sentences what happened and why it matters for sales","source_name":"string","source_url":"string","source_verified":true,"signal_date":"YYYY-MM-DD"}]

signal_type: funding|hiring|product_launch|leadership_change|expansion|partnership|press|financial|competitive|other
Return [] if nothing genuinely new. Max 8.`

  const raw = await callGroq(prompt, 2000)
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

  const prompt = `Sales coach briefing for rep selling: "${salesDescription}".
Signals today: ${text}
Write 3-4 sentence briefing: top signals to act on, which prospect to call first, why. Plain text only.`

  return callGroq(prompt, 400)
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
