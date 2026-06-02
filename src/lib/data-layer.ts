/**
 * Data Layer — fetches structured facts from external sources
 * Zero AI in this file. Pure data fetching.
 *
 * Sources:
 * - Serper (web + news search)
 * - BuiltWith (verified tech stack)
 * - Job posting parser (intent signals from careers pages)
 */

const SERPER_API = 'https://google.serper.dev/search'
const BUILTWITH_API = 'https://api.builtwith.com/v21/api.json'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TechTool {
  name: string
  category: string
  tag: string
  firstDetected: string
  lastDetected: string
  verified: true
}

export interface JobSignal {
  title: string
  tools_mentioned: string[]
  signals: string[]
  url: string
  date: string
}

export interface NewsItem {
  title: string
  snippet: string
  url: string
  source: string
  date: string
  type: 'funding' | 'leadership' | 'product' | 'expansion' | 'press' | 'other'
}

export interface RawCompanyData {
  companyName: string
  domain: string
  // Layer 1 — BuiltWith tech stack (verified)
  techStack: TechTool[]
  techStackRaw: string
  // Layer 2 — Website + LinkedIn facts
  websiteSnippets: string
  linkedinSnippets: string
  linkedinCompanyUrl: string | null
  // Layer 3 — Funding + financial
  fundingSnippets: string
  crunchbaseSnippets: string
  // Layer 4 — News signals
  recentNews: NewsItem[]
  // Layer 5 — Hiring signals (job posting intelligence)
  jobSignals: JobSignal[]
  hiringSnippets: string
  // Layer 6 — Reviews (intent signals)
  reviewSnippets: string
}

// ── Serper helpers ────────────────────────────────────────────────────────────

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

async function serperNews(query: string, num = 6): Promise<Array<{ title: string; snippet: string; link: string; date?: string; source?: string }>> {
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

function toSnippets(results: Array<{ title: string; snippet: string; link: string }>): string {
  return results.map(r => `[${r.title}] ${r.snippet} — ${r.link}`).join('\n') || 'No results'
}

// ── BuiltWith tech stack (verified) ──────────────────────────────────────────

async function fetchBuiltWith(domain: string): Promise<TechTool[]> {
  const key = process.env.BUILTWITH_API_KEY
  if (!key) {
    // Fallback: parse tech mentions from job postings
    return []
  }

  try {
    const url = `${BUILTWITH_API}?KEY=${key}&LOOKUP=${domain}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()

    const tools: TechTool[] = []
    const results = data.Results?.[0]?.Result?.Paths?.[0]?.Technologies || []

    const CATEGORY_MAP: Record<string, string> = {
      'CRM': 'CRM', 'Customer Relationship Management': 'CRM',
      'Marketing Automation': 'Marketing', 'Email Marketing': 'Marketing',
      'Analytics': 'Analytics', 'Web Analytics': 'Analytics',
      'Advertising': 'Advertising', 'Retargeting': 'Advertising',
      'CDN': 'Infrastructure', 'Hosting': 'Infrastructure', 'SSL': 'Infrastructure',
      'JavaScript': 'Frontend', 'CSS': 'Frontend', 'UI Frameworks': 'Frontend',
      'Support': 'Support', 'Helpdesk': 'Support',
      'Chat': 'Sales', 'Live Chat': 'Sales', 'Lead Generation': 'Sales',
      'Tag Management': 'Data', 'Data Management': 'Data',
      'Payment': 'Finance', 'E-commerce': 'E-commerce',
      'Productivity': 'Productivity', 'Collaboration': 'Productivity',
    }

    for (const tech of results) {
      const category = CATEGORY_MAP[tech.Tag] || CATEGORY_MAP[tech.Categories?.[0]] || tech.Tag || 'Other'
      tools.push({
        name: tech.Name,
        category,
        tag: tech.Tag || '',
        firstDetected: tech.FirstDetected ? new Date(tech.FirstDetected * 1000).toISOString().split('T')[0] : '',
        lastDetected: tech.LastDetected ? new Date(tech.LastDetected * 1000).toISOString().split('T')[0] : '',
        verified: true,
      })
    }

    // Sort by category then name
    return tools
      .filter(t => t.name && t.name.length > 0)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
      .slice(0, 80) // top 80 tools
  } catch (e) {
    console.error('BuiltWith error:', e)
    return []
  }
}

// ── Job posting parser ────────────────────────────────────────────────────────

const TOOL_PATTERNS = [
  'Salesforce', 'HubSpot', 'Zendesk', 'Intercom', 'Gainsight', 'Totango',
  'Marketo', 'Pardot', 'Outreach', 'Salesloft', 'Gong', 'Chorus',
  'Slack', 'Notion', 'Jira', 'Confluence', 'Asana', 'Monday', 'Linear',
  'Okta', 'OneLogin', 'Workday', 'BambooHR', 'Rippling',
  'Snowflake', 'Databricks', 'Looker', 'Tableau', 'PowerBI', 'Mixpanel', 'Amplitude',
  'AWS', 'GCP', 'Azure', 'Vercel', 'Heroku',
  'Stripe', 'Braintree', 'Zuora', 'Chargebee',
  'Figma', 'Miro', 'Loom', 'Zoom', 'Google Workspace',
  'Segment', 'RudderStack', 'mParticle', 'Iterable', 'Braze', 'Customer.io',
  'ZoomInfo', 'Apollo', 'Lusha', 'Clearbit', 'Clay',
]

function extractToolsFromText(text: string): string[] {
  const found: string[] = []
  const lower = text.toLowerCase()
  for (const tool of TOOL_PATTERNS) {
    if (lower.includes(tool.toLowerCase())) found.push(tool)
  }
  return [...new Set(found)]
}

function classifyNewsType(title: string, snippet: string): NewsItem['type'] {
  const text = (title + ' ' + snippet).toLowerCase()
  if (text.match(/raise|raised|funding|series [a-e]|million|billion|investment|round|investors/)) return 'funding'
  if (text.match(/appoint|hired|join|ceo|cto|cro|vp|chief|president|leader|founder/)) return 'leadership'
  if (text.match(/launch|releases|new product|new feature|introduces|announce|partnership|integrat/)) return 'product'
  if (text.match(/expand|expansion|market|international|global|open|office/)) return 'expansion'
  return 'press'
}

// ── MAIN: fetch all company data ──────────────────────────────────────────────

export async function fetchCompanyData(companyName: string, domain?: string): Promise<RawCompanyData> {
  const resolvedDomain = domain || `${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`

  // Run all searches in parallel — zero sequential waiting
  const [
    websiteResults,
    linkedinCompanyResults,
    fundingResults,
    crunchbaseResults,
    newsResults,
    fundingNewsResults,
    leadershipNewsResults,
    productNewsResults,
    hiringResults,
    reviewResults,
    builtWithData,
  ] = await Promise.all([
    serperSearch(`"${companyName}" official site about product overview what we do`, 4),
    serperSearch(`site:linkedin.com/company "${companyName}"`, 3),
    serperSearch(`"${companyName}" funding raised investors valuation series`, 5),
    serperSearch(`site:crunchbase.com "${companyName}" funding`, 4),
    serperNews(`"${companyName}" news 2025 2026`, 6),
    serperNews(`"${companyName}" funding raised million 2024 2025 2026`, 4),
    serperNews(`"${companyName}" new hire appointed executive leadership 2025`, 4),
    serperNews(`"${companyName}" product launch partnership integration 2025 2026`, 4),
    serperSearch(`"${companyName}" careers jobs hiring 2025 site:${resolvedDomain} OR site:greenhouse.io OR site:lever.co OR site:ashbyhq.com`, 6),
    serperSearch(`"${companyName}" review g2 glassdoor alternative 2025`, 4),
    fetchBuiltWith(resolvedDomain),
  ])

  // Find LinkedIn company URL
  const linkedinCompanyUrl = linkedinCompanyResults
    .find(r => r.link.includes('linkedin.com/company/') && !r.link.includes('/search'))
    ?.link?.split('?')[0] || null

  // Classify news items
  const allNewsRaw = [...newsResults, ...fundingNewsResults, ...leadershipNewsResults, ...productNewsResults]
  const seen = new Set<string>()
  const recentNews: NewsItem[] = []

  for (const n of allNewsRaw) {
    const key = n.title.slice(0, 60)
    if (seen.has(key)) continue
    seen.add(key)
    recentNews.push({
      title: n.title,
      snippet: n.snippet,
      url: n.link,
      source: n.source || new URL(n.link).hostname.replace('www.', ''),
      date: n.date || 'recent',
      type: classifyNewsType(n.title, n.snippet),
    })
  }

  // Parse job signals
  const jobSignals: JobSignal[] = []
  for (const j of hiringResults.slice(0, 4)) {
    const tools = extractToolsFromText(j.title + ' ' + j.snippet)
    const signals: string[] = []
    const text = (j.title + ' ' + j.snippet).toLowerCase()
    if (text.includes('head of') || text.includes('vp of') || text.includes('director')) signals.push('Senior hire — budget authority signal')
    if (text.includes('revenue ops') || text.includes('revops')) signals.push('RevOps investment — systems build-out underway')
    if (text.includes('enterprise')) signals.push('Enterprise motion — upmarket push')
    if (text.includes('scale') || text.includes('growth')) signals.push('Scaling phase — new tools likely being evaluated')
    if (tools.length > 0) signals.push(`Uses: ${tools.join(', ')}`)

    if (tools.length > 0 || signals.length > 0) {
      jobSignals.push({
        title: j.title.replace(/\s*[-|]\s*.*/g, '').trim(),
        tools_mentioned: tools,
        signals,
        url: j.link,
        date: 'recent',
      })
    }
  }

  // Build tech stack raw summary for AI context
  const techByCategory: Record<string, string[]> = {}
  for (const t of builtWithData) {
    if (!techByCategory[t.category]) techByCategory[t.category] = []
    techByCategory[t.category].push(t.name)
  }
  const techStackRaw = Object.entries(techByCategory)
    .map(([cat, tools]) => `${cat}: ${tools.join(', ')}`)
    .join('\n') || 'BuiltWith data not available'

  return {
    companyName,
    domain: resolvedDomain,
    techStack: builtWithData,
    techStackRaw,
    websiteSnippets: toSnippets(websiteResults),
    linkedinSnippets: toSnippets(linkedinCompanyResults),
    linkedinCompanyUrl,
    fundingSnippets: toSnippets(fundingResults),
    crunchbaseSnippets: toSnippets(crunchbaseResults),
    recentNews: recentNews.slice(0, 10),
    jobSignals,
    hiringSnippets: toSnippets(hiringResults),
    reviewSnippets: toSnippets(reviewResults),
  }
}
