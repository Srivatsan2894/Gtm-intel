// Core research engine — calls Claude with web search
// All prompts enforce verified sources only

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

const VERIFIED_SOURCES_INSTRUCTION = `
VERIFIED SOURCES ONLY. Only cite information from:
- Official company websites, newsrooms, and press releases
- LinkedIn (company pages and public profiles)
- Crunchbase, PitchBook, CB Insights
- TechCrunch, Reuters, Bloomberg, Forbes, Wall Street Journal, Financial Times
- SEC / regulatory filings (EDGAR)
- G2, Glassdoor, Capterra (for product/culture signals)
- Official job boards: Greenhouse, Lever, Workday, Ashby, company career pages
- GitHub (for open source/tech signals)
- Product Hunt (for product launches)

DO NOT cite: Reddit, anonymous blogs, forums, unverified social posts, or any source you cannot name.
For every signal, include the source name and URL where possible.
If you cannot verify a claim from a named source, do not include it.
`

async function callAnthropic(prompt: string, maxTokens = 4000) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const text = data.content
    ?.filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')

  return text || ''
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/```json\n?([\s\S]*?)\n?```/) ||
                  raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    const clean = match ? match[1] || match[0] : raw.trim()
    return JSON.parse(clean)
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

Produce a comprehensive GTM intelligence brief. Return ONLY valid JSON with this exact structure:

{
  "company": {
    "name": string,
    "domain": string,
    "industry": string,
    "size": string,
    "stage": string (e.g. "Series B", "Public", "Pre-IPO"),
    "hq": string,
    "linkedin_url": string (https://www.linkedin.com/company/slug),
    "description": string,
    "founded": string,
    "revenue_estimate": string,
    "priority_score": number (1-10)
  },
  "executive_summary": string (3-4 sentences: why this company, why now, what hurts),
  "business_model": string,
  "gtm_motion": string,
  "why_relevant": string (specifically why the sales rep's product fits this company),
  "pain_points": [
    { "title": string, "description": string, "severity": "high"|"medium"|"low" }
  ],
  "tech_stack": [
    { "category": string, "tool": string, "confidence": "high"|"medium"|"low" }
  ],
  "buying_signals": [
    { "signal": string, "source": string, "source_url": string, "date": string }
  ],
  "recent_news": [
    { "title": string, "summary": string, "source": string, "source_url": string, "date": string, "signal_type": "funding"|"hiring"|"product_launch"|"leadership_change"|"expansion"|"partnership"|"press"|"financial"|"competitive"|"other" }
  ],
  "discovery_questions": string[],
  "outreach_angles": [
    { "title": string, "description": string }
  ],
  "cold_email": string,
  "linkedin_message": string,
  "call_script": string,
  "objections": [
    { "objection": string, "counter": string }
  ],
  "contacts": [
    {
      "name": string,
      "title": string,
      "department": string,
      "linkedin_url": string (https://www.linkedin.com/in/slug — use real public profile if findable, otherwise construct best guess),
      "linkedin_verified": boolean (true only if you found a real profile URL),
      "email_guess": string (firstname@domain.com pattern),
      "email_pattern": string (the pattern used e.g. first@domain.com),
      "email_confidence": "high"|"medium"|"low",
      "role_in_deal": "champion"|"blocker"|"influencer"|"evaluator",
      "outreach_message": string (personalized 4-5 line message for this specific person)
    }
  ]
}

For contacts: find 5-7 relevant stakeholders. Focus on: VP/Head of Sales, VP/Head of RevOps, VP/Head of Customer Success, CRO, CFO, CISO, Head of Product. These should be real people findable on LinkedIn for this company.

For linkedin_url on contacts: search LinkedIn for "[name] [company]" and use the real URL if found. Mark linkedin_verified: true only if confident. Otherwise construct a best-guess slug and mark false.

Tailor everything to how the sales rep's product ("${salesDescription}") would help this specific company.
`

  const raw = await callAnthropic(prompt, 6000)
  return parseJSON(raw, null)
}

// ── SIGNAL REFRESH — for daily cron ─────────────────────────────────────────
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
You are a sales signal analyst monitoring accounts for a sales rep.

Sales rep sells: "${salesDescription}"
Monitor company: "${companyName}" (${domain})
Find signals: ${since}

${VERIFIED_SOURCES_INSTRUCTION}

Search for NEW signals only — news, announcements, job postings, or changes that happened ${since}.

Return ONLY valid JSON array:
[
  {
    "signal_type": "funding"|"hiring"|"product_launch"|"leadership_change"|"expansion"|"partnership"|"press"|"financial"|"competitive"|"other",
    "title": string (short, specific),
    "summary": string (2-3 sentences — what happened and why it matters for a sales rep),
    "source_name": string,
    "source_url": string,
    "source_verified": boolean,
    "signal_date": string (YYYY-MM-DD or approximate)
  }
]

If no new signals found, return empty array [].
Maximum 10 signals. Only include genuinely new, verified information.
`

  const raw = await callAnthropic(prompt, 2000)
  return parseJSON<SignalResult[]>(raw, [])
}

// ── DAILY DIGEST SUMMARY ─────────────────────────────────────────────────────
export async function generateDigestSummary(
  salesDescription: string,
  signalsByProspect: Array<{
    company: string
    signals: SignalResult[]
  }>
) {
  const signalText = signalsByProspect
    .map(p => `${p.company}:\n${p.signals.map(s => `- [${s.signal_type}] ${s.title}: ${s.summary}`).join('\n')}`)
    .join('\n\n')

  const prompt = `
You are a sales coach preparing a daily briefing for a rep selling: "${salesDescription}"

Today's new signals across their prospect accounts:
${signalText}

Write a short (3-4 sentence) executive briefing that:
1. Highlights the 1-2 most important signals to act on today
2. Suggests which prospect to prioritize calling first and why
3. Notes any patterns across accounts

Be direct and actionable. No fluff. Speak like a sharp sales manager.
Return plain text only, no JSON.
`

  return callAnthropic(prompt, 500)
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
