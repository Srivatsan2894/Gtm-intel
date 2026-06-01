// Research engine — Groq (Llama 3.3 70B) + Serper web search

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const SERPER_API = 'https://google.serper.dev/search'

const VERIFIED_SOURCES = `
Only use information from: official company websites, LinkedIn, Crunchbase,
TechCrunch, Reuters, Bloomberg, Forbes, SEC filings, G2, Glassdoor,
official job boards (Greenhouse, Lever, Workday). No Reddit or anonymous sources.
`

// ── Web search via Serper ────────────────────────────────────────────────────
async function webSearch(query: string, num = 5): Promise<string> {
  const serperKey = process.env.SERPER_API_KEY
  if (!serperKey) return `No web search available — using training data only for: ${query}`

  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': serperKey,
      },
      body: JSON.stringify({ q: query, num }),
    })
    const data = await res.json()
    const results = data.organic?.slice(0, num) || []
    return results
      .map((r: { title: string; snippet: string; link: string }) =>
        `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`)
      .join('\n\n')
  } catch {
    return `Search failed for: ${query}`
  }
}

// ── Groq LLM call ────────────────────────────────────────────────────────────
async function callGroq(prompt: string, maxTokens = 4000): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY not configured')

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Groq API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match) return fallback
    return JSON.parse(match[0])
  } catch {
    return fallback
  }
}

// ── FULL GTM RESEARCH ────────────────────────────────────────────────────────
export async function runFullResearch(
  companyName: string,
  salesDescription: string,
  targetIndustries: string[]
) {
  // Step 1: gather web data in parallel
  const [overview, news, jobs, linkedin] = await Promise.all([
    webSearch(`${companyName} company overview funding revenue 2025 2026`),
    webSearch(`${companyName} news announcements 2025 2026`),
    webSearch(`${companyName} hiring jobs careers VP Director 2025 2026`),
    webSearch(`${companyName} leadership team executives LinkedIn`),
  ])

  const webContext = `
=== COMPANY OVERVIEW ===
${overview}

=== RECENT NEWS ===
${news}

=== HIRING SIGNALS ===
${jobs}

=== LEADERSHIP & CONTACTS ===
${linkedin}
`

  const prompt = `
You are a senior GTM strategist and sales intelligence analyst.

A sales rep sells: "${salesDescription}"
Target industries: ${targetIndustries.join(', ')}
Research target company: "${companyName}"

${VERIFIED_SOURCES}

Here is fresh web research data:
${webContext}

Using the web data above, produce a comprehensive GTM brief.
Return ONLY raw valid JSON — no markdown, no explanation, no code blocks.

{
  "company": {
    "name": "string",
    "domain": "string",
    "industry": "string",
    "size": "string",
    "stage": "string",
    "hq": "string",
    "linkedin_url": "https://www.linkedin.com/company/slug",
    "description": "string",
    "priority_score": 8
  },
  "executive_summary": "3-4 sentences why this company, why now, what hurts",
  "business_model": "string",
  "gtm_motion": "string",
  "why_relevant": "why the sales rep product fits this company specifically",
  "pain_points": [
    { "title": "string", "description": "string", "severity": "high" }
  ],
  "tech_stack": [
    { "category": "string", "tool": "string", "confidence": "high" }
  ],
  "buying_signals": [
    { "signal": "string", "source": "string", "source_url": "string", "date": "string" }
  ],
  "recent_news": [
    { "title": "string", "summary": "string", "source": "string", "source_url": "string", "date": "string", "signal_type": "press" }
  ],
  "discovery_questions": ["string"],
  "outreach_angles": [
    { "title": "string", "description": "string" }
  ],
  "cold_email": "full cold email text",
  "linkedin_message": "full linkedin message text",
  "call_script": "full call opening script",
  "objections": [
    { "objection": "string", "counter": "string" }
  ],
  "contacts": [
    {
      "name": "string",
      "title": "string",
      "department": "string",
      "linkedin_url": "https://www.linkedin.com/in/slug",
      "linkedin_verified": false,
      "email_guess": "firstname@domain.com",
      "email_pattern": "first@domain.com",
      "email_confidence": "medium",
      "role_in_deal": "champion",
      "outreach_message": "personalized 4-5 line message for this person"
    }
  ]
}

Rules:
- signal_type: funding|hiring|product_launch|leadership_change|expansion|partnership|press|financial|competitive|other
- role_in_deal: champion|blocker|influencer|evaluator
- email_confidence: high|medium|low
- Find 5-7 real contacts based on the leadership data above
- Tailor cold_email, linkedin_message, call_script to how "${salesDescription}" helps ${companyName} specifically
`

  const raw = await callGroq(prompt, 4000)
  return parseJSON(raw, null)
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

  const searchData = await webSearch(
    `${companyName} ${domain} news announcement funding hiring ${since}`, 8
  )

  const prompt = `
Sales rep sells: "${salesDescription}"
Company: "${companyName}"
Find NEW signals ${since}.

Web data:
${searchData}

${VERIFIED_SOURCES}

Return ONLY a valid JSON array — no markdown:
[
  {
    "signal_type": "press",
    "title": "short specific title",
    "summary": "2-3 sentences what happened and why it matters for a sales rep",
    "source_name": "string",
    "source_url": "string",
    "source_verified": true,
    "signal_date": "YYYY-MM-DD"
  }
]

signal_type: funding|hiring|product_launch|leadership_change|expansion|partnership|press|financial|competitive|other
Return [] if no new signals. Max 10.
`

  const raw = await callGroq(prompt, 2000)
  return parseJSON<SignalResult[]>(raw, [])
}

// ── DIGEST SUMMARY ───────────────────────────────────────────────────────────
export async function generateDigestSummary(
  salesDescription: string,
  signalsByProspect: Array<{ company: string; signals: SignalResult[] }>
) {
  const signalText = signalsByProspect
    .map(p => `${p.company}:\n${p.signals.map(s => `- [${s.signal_type}] ${s.title}: ${s.summary}`).join('\n')}`)
    .join('\n\n')

  const prompt = `
You are a sales coach briefing a rep who sells: "${salesDescription}"

Today's new signals:
${signalText}

Write a 3-4 sentence executive briefing:
1. The 1-2 most important signals to act on today
2. Which prospect to prioritize and why
3. Any patterns worth noting

Be direct and actionable. Plain text only.
`

  return callGroq(prompt, 500)
}

export interface SignalResult {
  signal_type: string
  title: string
  summary: string
  source_name: string
  source_url: string
  source_verified: boolean
  signal_date: string
}
