// Research engine — uses Google Gemini with grounding (web search)

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

const VERIFIED_SOURCES_INSTRUCTION = `
VERIFIED SOURCES ONLY. Only cite information from:
- Official company websites, newsrooms, and press releases
- LinkedIn (company pages and public profiles)
- Crunchbase, PitchBook, CB Insights
- TechCrunch, Reuters, Bloomberg, Forbes, Wall Street Journal
- SEC / regulatory filings
- G2, Glassdoor, Capterra
- Official job boards: Greenhouse, Lever, Workday, Ashby
- GitHub (for tech signals)
- Product Hunt (for product launches)
DO NOT cite Reddit, anonymous blogs, forums, or unverified sources.
`

async function callGemini(prompt: string, maxTokens = 4000): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.3,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p: { text?: string }) => p.text)
    .map((p: { text: string }) => p.text)
    .join('') || ''

  return text
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    // Remove markdown code blocks if present
    const clean = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()
    // Find JSON object or array
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
  const prompt = `
You are a senior GTM strategist and sales intelligence analyst.

A sales rep is selling: "${salesDescription}"
Their target industries: ${targetIndustries.join(', ')}

Research the target company: "${companyName}"

${VERIFIED_SOURCES_INSTRUCTION}

Produce a comprehensive GTM intelligence brief. Return ONLY valid JSON — no markdown, no explanation, just raw JSON.

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
    "founded": "string",
    "revenue_estimate": "string",
    "priority_score": 8
  },
  "executive_summary": "3-4 sentences: why this company, why now, what hurts",
  "business_model": "string",
  "gtm_motion": "string",
  "why_relevant": "specifically why the sales rep product fits",
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
    { "title": "string", "summary": "string", "source": "string", "source_url": "string", "date": "string", "signal_type": "funding" }
  ],
  "discovery_questions": ["string"],
  "outreach_angles": [
    { "title": "string", "description": "string" }
  ],
  "cold_email": "string",
  "linkedin_message": "string",
  "call_script": "string",
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
      "outreach_message": "personalized 4-5 line message"
    }
  ]
}

For contacts: find 5-7 real stakeholders — VP Sales, Head RevOps, VP CS, CRO, CFO, CISO, Head Product.
Tailor everything to how the sales rep product ("${salesDescription}") helps this specific company.
signal_type must be one of: funding, hiring, product_launch, leadership_change, expansion, partnership, press, financial, competitive, other
role_in_deal must be one of: champion, blocker, influencer, evaluator
email_confidence must be one of: high, medium, low
`

  const raw = await callGemini(prompt, 6000)
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

  const prompt = `
You are a sales signal analyst.
Sales rep sells: "${salesDescription}"
Monitor company: "${companyName}" (${domain})
Find NEW signals ${since}.

${VERIFIED_SOURCES_INSTRUCTION}

Return ONLY a valid JSON array — no markdown, no explanation:
[
  {
    "signal_type": "funding",
    "title": "short specific title",
    "summary": "2-3 sentences — what happened and why it matters for sales",
    "source_name": "string",
    "source_url": "string",
    "source_verified": true,
    "signal_date": "YYYY-MM-DD"
  }
]

signal_type must be one of: funding, hiring, product_launch, leadership_change, expansion, partnership, press, financial, competitive, other
If no new signals, return [].
Maximum 10 signals.
`

  const raw = await callGemini(prompt, 2000)
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
You are a sales coach preparing a daily briefing for a rep selling: "${salesDescription}"

Today's new signals:
${signalText}

Write a short 3-4 sentence executive briefing:
1. The 1-2 most important signals to act on today
2. Which prospect to prioritize calling first and why
3. Any patterns across accounts

Be direct and actionable. No fluff. Plain text only, no JSON, no markdown.
`

  return callGemini(prompt, 500)
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
