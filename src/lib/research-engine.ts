// GTM Intel Research Engine v3
// Groq (Llama 3.3 70B) + Serper web search + strict LinkedIn validation

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const SERPER_API = 'https://google.serper.dev/search'
const SERPER_KEY = () => process.env.SERPER_API_KEY || ''

// ── Serper search ────────────────────────────────────────────────────────────
async function search(query: string, num = 5): Promise<Array<{title: string; snippet: string; link: string}>> {
  if (!SERPER_KEY()) return []
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY() },
      body: JSON.stringify({ q: query, num }),
    })
    const data = await res.json()
    return (data.organic || []).slice(0, num)
  } catch { return [] }
}

async function searchText(query: string, num = 5): Promise<string> {
  const results = await search(query, num)
  return results.map(r => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`).join('\n\n') || 'No results found'
}

// ── Serper news search ────────────────────────────────────────────────────────
async function searchNews(query: string, num = 5): Promise<string> {
  if (!SERPER_KEY()) return 'No results'
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY() },
      body: JSON.stringify({ q: query, num, type: 'news' }),
    })
    const data = await res.json()
    return (data.news || []).slice(0, num)
      .map((r: {title: string; snippet: string; link: string; date?: string}) =>
        `Title: ${r.title}\nDate: ${r.date || 'recent'}\nSnippet: ${r.snippet}\nURL: ${r.link}`)
      .join('\n\n') || 'No news found'
  } catch { return 'No results' }
}

// ── Strict LinkedIn profile validation ───────────────────────────────────────
interface LinkedInResult {
  url: string | null
  verified: boolean
  confidence: 'high' | 'medium' | 'low' | 'none'
}

async function validateLinkedIn(name: string, company: string, title: string): Promise<LinkedInResult> {
  if (!SERPER_KEY()) return { url: null, verified: false, confidence: 'none' }

  const nameParts = name.toLowerCase().split(' ').filter(p => p.length > 1)
  const firstName = nameParts[0] || ''
  const lastName = nameParts[nameParts.length - 1] || ''

  // Multiple search strategies
  const queries = [
    `site:linkedin.com/in "${name}" "${company}"`,
    `site:linkedin.com/in "${firstName} ${lastName}" "${company}" "${title}"`,
    `site:linkedin.com/in "${name}" "${company}" ${title.split(' ').slice(0,3).join(' ')}`,
  ]

  for (const query of queries) {
    const results = await search(query, 3)
    for (const r of results) {
      if (!r.link.includes('linkedin.com/in/')) continue
      if (r.link.includes('/in/search')) continue
      if (r.link.includes('/in/in/')) continue

      const slug = r.link.split('linkedin.com/in/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase() || ''
      if (!slug || slug.length < 3) continue

      // Verify slug contains parts of the name
      const slugMatchesFirst = slug.includes(firstName.slice(0, 4))
      const slugMatchesLast = slug.includes(lastName.slice(0, 4))
      const snippetMatchesName = r.snippet?.toLowerCase().includes(firstName) ||
        r.snippet?.toLowerCase().includes(lastName)
      const snippetMatchesCompany = r.snippet?.toLowerCase().includes(company.toLowerCase().split(' ')[0])
      const titleMatchesSnippet = title.split(' ').slice(0, 2).some(word =>
        r.snippet?.toLowerCase().includes(word.toLowerCase())
      )

      // Score confidence
      let score = 0
      if (slugMatchesFirst) score += 30
      if (slugMatchesLast) score += 30
      if (snippetMatchesName) score += 20
      if (snippetMatchesCompany) score += 15
      if (titleMatchesSnippet) score += 5

      if (score >= 75) {
        return { url: r.link.split('?')[0], verified: true, confidence: 'high' }
      } else if (score >= 50) {
        return { url: r.link.split('?')[0], verified: false, confidence: 'medium' }
      }
      // score < 50 → skip this result, try next
    }
  }

  // Nothing verified — return null, don't show bad data
  return { url: null, verified: false, confidence: 'none' }
}

async function findCompanyLinkedIn(companyName: string): Promise<string | null> {
  const results = await search(`site:linkedin.com/company "${companyName}" official page`, 3)
  const hit = results.find(r =>
    r.link.includes('linkedin.com/company/') &&
    !r.link.includes('/company/search')
  )
  return hit ? hit.link.split('?')[0] : null
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
      temperature: 0.2,
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

// ── DISCOVER companies ───────────────────────────────────────────────────────
export async function discoverCompanies(
  salesDescription: string,
  targetIndustries: string[],
  targetSizes: string[],
  icpNotes: string,
  count = 5
): Promise<string[]> {
  const searchData = await searchText(
    `AI-first SaaS startups ${targetIndustries[0] || 'B2B'} Series A B funding 2024 2025 2026`, 8
  )

  const prompt = `You are a GTM analyst finding ideal target accounts.

Sales rep sells: "${salesDescription}"
Target industries: ${targetIndustries.join(', ')}
Target sizes: ${targetSizes.join(', ')}
ICP notes: ${icpNotes || 'none'}

Market data:
${searchData}

Return exactly ${count} AI-first or AI-native SaaS companies. Rules:
- Must be AI-first or AI-native (AI is core to their product, not a bolt-on)
- Must be startups or scale-ups (not legacy enterprises like Microsoft, Salesforce, SAP)
- Must match the sales rep ICP
- Must be real, named companies with public presence

Return ONLY this JSON array, nothing else:
[{"name":"Company Name","domain":"company.com"}]`

  const raw = await callGroq(prompt, 600)
  const parsed = parseJSON<Array<{name: string; domain: string} | string>>(raw, [])
  return parsed.map(item => typeof item === 'string' ? item : item.name)
}

// ── FULL GTM RESEARCH ────────────────────────────────────────────────────────
export async function runFullResearch(
  companyName: string,
  salesDescription: string,
  targetIndustries: string[]
) {
  // 6 parallel searches for maximum freshness
  const [
    websiteData,
    crunchbaseData,
    newsData,
    hiringData,
    productData,
    companyLinkedIn,
  ] = await Promise.all([
    searchText(`${companyName} official website about product overview 2025`),
    searchText(`${companyName} crunchbase funding investors valuation 2024 2025`),
    searchNews(`${companyName} announcement news 2025 2026`),
    searchText(`${companyName} hiring careers jobs VP Director Head 2025 2026`),
    searchText(`${companyName} product launch new feature partnership 2025`),
    findCompanyLinkedIn(companyName),
  ])

  // GTM scoops — dedicated news search
  const [fundingNews, leadershipNews, expansionNews] = await Promise.all([
    searchNews(`${companyName} funding raised investment round 2025 2026`),
    searchNews(`${companyName} new CEO CTO VP appointed hired leadership 2025`),
    searchNews(`${companyName} expansion new market international launch 2025`),
  ])

  const prompt = `You are a senior GTM strategist and sales intelligence analyst.
Sales rep sells: "${salesDescription}" to ${targetIndustries.join(', ')} companies.
Research target: "${companyName}"

LIVE WEB DATA (use this as primary source — it is current):

WEBSITE/PRODUCT:
${websiteData}

FUNDING/INVESTORS (Crunchbase):
${crunchbaseData}

RECENT NEWS:
${newsData}

HIRING SIGNALS:
${hiringData}

PRODUCT/PARTNERSHIPS:
${productData}

FUNDING NEWS:
${fundingNews}

LEADERSHIP CHANGES:
${leadershipNews}

EXPANSION NEWS:
${expansionNews}

Company LinkedIn: ${companyLinkedIn || 'not found'}

IMPORTANT: Base all facts on the web data above. Do not invent funding amounts, dates, or people.
If a fact is not in the web data, omit it rather than guess.

Return ONLY raw valid JSON, no markdown:
{
  "company": {
    "name": "string",
    "domain": "string (from website data)",
    "industry": "string",
    "size": "string",
    "stage": "string (e.g. Series B, Growth)",
    "hq": "string",
    "linkedin_url": "${companyLinkedIn || ''}",
    "description": "string (2-3 sentences from website data)",
    "founded": "string",
    "total_funding": "string (from Crunchbase data, or omit if not found)",
    "latest_round": "string (most recent funding round, or omit)",
    "key_investors": "string (from Crunchbase, or omit)",
    "priority_score": 8
  },
  "executive_summary": "3-4 sentences: what the company does, current growth stage, why they need this product NOW",
  "business_model": "string",
  "gtm_motion": "string",
  "why_relevant": "specific reason why '${salesDescription}' fits this company right now",
  "gtm_scoops": [
    {
      "type": "funding|leadership_change|hiring_spike|expansion|product_launch|partnership|tech_change|strategic",
      "headline": "short punchy headline",
      "detail": "2-3 sentences with specifics from the web data",
      "why_it_matters": "one sentence on why this is a buying signal for the sales rep",
      "source": "source name",
      "source_url": "url",
      "date": "date or approximate"
    }
  ],
  "pain_points": [{"title":"string","description":"string","severity":"high|medium|low"}],
  "tech_stack": [{"category":"string","tool":"string","confidence":"high|medium|low"}],
  "discovery_questions": ["string"],
  "outreach_angles": [{"title":"string","description":"string"}],
  "cold_email": "full personalized cold email based on scoops above",
  "linkedin_message": "full linkedin message referencing a specific recent scoop",
  "call_script": "full call opening script referencing what is happening at the company right now",
  "objections": [{"objection":"string","counter":"string"}],
  "contacts": [
    {
      "name": "real person name from web data",
      "title": "their exact title",
      "department": "string",
      "email_guess": "firstname@domain.com",
      "email_pattern": "first@domain.com",
      "email_confidence": "high|medium|low",
      "role_in_deal": "champion|blocker|influencer|evaluator",
      "outreach_message": "personalized 4-5 line message referencing a specific scoop"
    }
  ]
}

For contacts: find 5-6 REAL people at ${companyName} from the hiring/leadership/news data above.
Only include people you actually found in the web data — do not invent names.
For cold_email, linkedin_message, call_script: reference specific scoops (funding, hiring, product launch) from above.`

  const raw = await callGroq(prompt, 5000)
  const research = parseJSON<Record<string, unknown> | null>(raw, null)
  if (!research) return null

  // Strict LinkedIn validation for each contact
  const contacts = research.contacts as Array<Record<string, unknown>>
  if (Array.isArray(contacts)) {
    const validated = await Promise.all(
      contacts.map(async (c) => {
        const result = await validateLinkedIn(
          c.name as string,
          companyName,
          c.title as string || ''
        )
        // Only attach URL if confidence is high or medium — hide low/none
        if (result.confidence === 'none' || result.confidence === 'low') {
          return { ...c, linkedin_url: null, linkedin_verified: false, linkedin_confidence: 'not_found' }
        }
        return {
          ...c,
          linkedin_url: result.url,
          linkedin_verified: result.verified,
          linkedin_confidence: result.confidence,
        }
      })
    )
    research.contacts = validated
  }

  // Set verified company LinkedIn
  if (research.company) {
    (research.company as Record<string, unknown>).linkedin_url = companyLinkedIn || null
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

  const [news, hiring, funding, product] = await Promise.all([
    searchNews(`${companyName} news ${since}`),
    searchText(`${companyName} new hire appointed executive ${since}`),
    searchNews(`${companyName} funding investment raised ${since}`),
    searchNews(`${companyName} product launch partnership announcement ${since}`),
  ])

  const prompt = `Sales rep sells: "${salesDescription}". Monitor: "${companyName}" (${domain}).

Fresh data ${since}:
NEWS: ${news}
HIRING: ${hiring}
FUNDING: ${funding}
PRODUCT: ${product}

Extract only GENUINELY NEW signals. Return ONLY JSON array:
[{
  "signal_type": "funding|hiring|product_launch|leadership_change|expansion|partnership|press|financial|competitive|other",
  "title": "specific headline",
  "summary": "2-3 sentences: what happened, specifics, why it matters for sales outreach",
  "source_name": "publication name",
  "source_url": "url",
  "source_verified": true,
  "signal_date": "YYYY-MM-DD"
}]

Only include signals with real specifics from the data. Return [] if nothing genuinely new. Max 8.`

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

  const prompt = `Sales coach for rep selling: "${salesDescription}".
Today's signals: ${text}
Write 3-4 sentence briefing: top 1-2 signals to act on today, which company to prioritize, why. Plain text only.`

  return callGroq(prompt, 400)
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
