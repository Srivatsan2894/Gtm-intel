/**
 * Data Layer v2 — Direct source fetching
 * Sources: Crunchbase, TechCrunch, BuiltWith, company website, LinkedIn
 * Zero AI — pure structured data fetching
 */

const SERPER_API = 'https://google.serper.dev/search'
const BUILTWITH_API = 'https://api.builtwith.com/v21/api.json'

export interface TechTool {
  name: string
  category: string
  firstDetected: string
  lastDetected: string
  verified: true
}

export interface NewsItem {
  title: string
  snippet: string
  url: string
  source: string
  date: string
  type: 'funding' | 'acquisition' | 'layoff' | 'leadership' | 'product' | 'expansion' | 'partnership' | 'press' | 'other'
}

export interface JobSignal {
  title: string
  tools_mentioned: string[]
  signals: string[]
  url: string
}

export interface RawCompanyData {
  companyName: string
  domain: string
  // Crunchbase data
  crunchbaseUrl: string | null
  crunchbaseSnippet: string
  // Funding data
  fundingData: string
  // Tech stack (BuiltWith)
  techStack: TechTool[]
  techByCategory: Record<string, string[]>
  // Website data
  websiteData: string
  // LinkedIn
  linkedinCompanyUrl: string | null
  linkedinData: string
  // News signals (categorised)
  news: NewsItem[]
  // Hiring signals
  jobSignals: JobSignal[]
  // Reviews (G2/Glassdoor intent signals)
  reviewData: string
}

// ── Serper ────────────────────────────────────────────────────────────────────
async function serper(query: string, num = 6, type: 'search' | 'news' = 'search'): Promise<Array<{title: string; snippet: string; link: string; date?: string; source?: string}>> {
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

function fmt(results: Array<{title: string; snippet: string; link: string; date?: string}>): string {
  if (!results.length) return 'No results found'
  return results.map(r => `• ${r.title}\n  ${r.snippet}\n  Source: ${r.link}${r.date ? ` (${r.date})` : ''}`).join('\n\n')
}

// ── BuiltWith tech stack ──────────────────────────────────────────────────────
async function getBuiltWith(domain: string): Promise<{ tools: TechTool[]; byCategory: Record<string, string[]> }> {
  const key = process.env.BUILTWITH_API_KEY
  if (!key) return { tools: [], byCategory: {} }

  try {
    const res = await fetch(`${BUILTWITH_API}?KEY=${key}&LOOKUP=${domain}&HIDETEXT=yes`)
    if (!res.ok) return { tools: [], byCategory: {} }
    const data = await res.json()

    const technologies = data.Results?.[0]?.Result?.Paths?.[0]?.Technologies || []

    // Map BuiltWith tags to clean categories
    const CAT_MAP: Record<string, string> = {
      'CRM': 'CRM', 'Customer Relationship Management': 'CRM',
      'Marketing Automation': 'Marketing', 'Email Marketing': 'Marketing',
      'Email ESP': 'Marketing', 'Marketing': 'Marketing',
      'Analytics': 'Analytics', 'Web Analytics': 'Analytics',
      'Real Time Analytics': 'Analytics', 'Audience Measurement': 'Analytics',
      'Advertising Networks': 'Advertising', 'Retargeting': 'Advertising',
      'Live Chat': 'Sales & Support', 'Chat': 'Sales & Support',
      'Help Desk': 'Sales & Support', 'Customer Support': 'Sales & Support',
      'Payment': 'Payments', 'Payment Processors': 'Payments',
      'Ecommerce': 'E-commerce',
      'CDN': 'Infrastructure', 'Hosting': 'Infrastructure',
      'SSL': 'Infrastructure', 'Web Server': 'Infrastructure',
      'Tag Management': 'Data & Tracking', 'Data Management': 'Data & Tracking',
      'Productivity': 'Productivity', 'Collaboration': 'Productivity',
      'JavaScript Frameworks': 'Frontend', 'UI Frameworks': 'Frontend',
      'CSS': 'Frontend',
      'A/B Testing': 'Optimization', 'Conversion': 'Optimization',
      'Survey': 'Research', 'Feedback': 'Research',
    }

    const tools: TechTool[] = []
    const byCategory: Record<string, string[]> = {}

    // Key business tools to highlight (not infrastructure noise)
    const HIGHLIGHT_TAGS = new Set([
      'CRM', 'Marketing Automation', 'Email Marketing', 'Email ESP',
      'Analytics', 'Web Analytics', 'Live Chat', 'Chat', 'Help Desk',
      'Customer Support', 'Payment', 'Payment Processors', 'A/B Testing',
      'Tag Management', 'Retargeting', 'Advertising Networks',
    ])

    for (const tech of technologies) {
      const rawTag = tech.Tag || tech.Categories?.[0] || 'Other'
      const category = CAT_MAP[rawTag] || 'Other'
      if (category === 'Other' && !HIGHLIGHT_TAGS.has(rawTag)) continue // skip noise

      const tool: TechTool = {
        name: tech.Name,
        category,
        firstDetected: tech.FirstDetected
          ? new Date(tech.FirstDetected * 1000).toISOString().split('T')[0] : '',
        lastDetected: tech.LastDetected
          ? new Date(tech.LastDetected * 1000).toISOString().split('T')[0] : '',
        verified: true,
      }
      tools.push(tool)
      if (!byCategory[category]) byCategory[category] = []
      byCategory[category].push(tech.Name)
    }

    return { tools, byCategory }
  } catch (e) {
    console.error('BuiltWith error:', e)
    return { tools: [], byCategory: {} }
  }
}

// ── News classifier ───────────────────────────────────────────────────────────
function classifyNews(title: string, snippet: string): NewsItem['type'] {
  const t = (title + ' ' + snippet).toLowerCase()
  if (t.match(/acqui|merger|acquired|acquisition|buys|bought/)) return 'acquisition'
  if (t.match(/layoff|laid off|reduct|workforce|cuts jobs|let go/)) return 'layoff'
  if (t.match(/raise|raised|funding|series [a-e]|million|billion|seed|investment|investors/)) return 'funding'
  if (t.match(/appoint|hired|joins|new ceo|new cto|new cro|president|chief|founder/)) return 'leadership'
  if (t.match(/launch|releases|new product|new feature|introduces|unveils|announces/)) return 'product'
  if (t.match(/expand|expansion|new market|international|opens office|global/)) return 'expansion'
  if (t.match(/partner|integration|collaborate|alliance/)) return 'partnership'
  return 'press'
}

// ── Tool mentions in job postings ─────────────────────────────────────────────
const KNOWN_TOOLS = [
  'Salesforce','HubSpot','Zendesk','Intercom','Gainsight','Totango','ChurnZero',
  'Marketo','Pardot','Outreach','Salesloft','Gong','Chorus','Apollo',
  'Slack','Notion','Jira','Confluence','Asana','Monday','Linear','ClickUp',
  'Okta','OneLogin','Workday','BambooHR','Rippling','Lattice',
  'Snowflake','Databricks','Looker','Tableau','PowerBI','Mixpanel','Amplitude','Segment',
  'AWS','GCP','Azure','Vercel','Heroku','Kubernetes','Docker',
  'Stripe','Braintree','Zuora','Chargebee','Recurly',
  'Figma','Miro','Loom','Zoom','Google Workspace','Microsoft 365',
  'ZoomInfo','Clay','Clearbit','Apollo.io','Lusha',
  'Twilio','SendGrid','Postmark','Customer.io','Braze','Iterable',
]

function extractTools(text: string): string[] {
  const lower = text.toLowerCase()
  return KNOWN_TOOLS.filter(t => lower.includes(t.toLowerCase()))
}

// ── MAIN: fetch all company data ──────────────────────────────────────────────
export async function fetchCompanyData(companyName: string, domain?: string): Promise<RawCompanyData> {
  const cleanDomain = domain?.replace('www.', '') ||
    `${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`

  // All searches run in parallel
  const [
    crunchbaseResults,
    fundingNewsResults,
    acquisitionResults,
    layoffResults,
    websiteResults,
    linkedinResults,
    techNewsResults,
    productNewsResults,
    hiringResults,
    reviewResults,
    builtWith,
  ] = await Promise.all([
    // Crunchbase — funding, investors, stage
    serper(`site:crunchbase.com/organization "${companyName}"`, 3),

    // Funding news from multiple sources
    serper(`"${companyName}" funding raised series investors 2024 2025`, 6, 'news'),

    // Acquisition/M&A news
    serper(`"${companyName}" acquired acquisition merger 2024 2025`, 4, 'news'),

    // Layoffs
    serper(`"${companyName}" layoffs laid off employees 2024 2025`, 3, 'news'),

    // Official website
    serper(`"${companyName}" site:${cleanDomain} OR "${companyName}" about product overview`, 4),

    // LinkedIn company page
    serper(`site:linkedin.com/company "${companyName}"`, 3),

    // TechCrunch + tech press
    serper(`"${companyName}" site:techcrunch.com OR site:venturebeat.com 2024 2025`, 5),

    // Product launches
    serper(`"${companyName}" product launch feature announcement 2025`, 5, 'news'),

    // Job postings for tool signals
    serper(`"${companyName}" jobs hiring site:greenhouse.io OR site:lever.co OR site:ashbyhq.com OR site:${cleanDomain}/careers`, 5),

    // G2/Glassdoor reviews
    serper(`"${companyName}" site:g2.com OR site:glassdoor.com review 2025`, 3),

    // BuiltWith tech stack
    getBuiltWith(cleanDomain),
  ])

  // LinkedIn URL
  const linkedinCompanyUrl = linkedinResults
    .find(r => r.link.includes('linkedin.com/company/') && !r.link.includes('/search'))
    ?.link?.split('?')[0] || null

  // Crunchbase URL
  const crunchbaseUrl = crunchbaseResults
    .find(r => r.link.includes('crunchbase.com/organization'))
    ?.link || null

  // Build news feed — deduplicated, classified
  const rawNews = [
    ...fundingNewsResults,
    ...acquisitionResults,
    ...layoffResults,
    ...techNewsResults,
    ...productNewsResults,
  ]

  const seenTitles = new Set<string>()
  const news: NewsItem[] = []
  for (const n of rawNews) {
    const key = n.title.slice(0, 50).toLowerCase()
    if (seenTitles.has(key)) continue
    seenTitles.add(key)
    news.push({
      title: n.title,
      snippet: n.snippet,
      url: n.link,
      source: n.source || (() => { try { return new URL(n.link).hostname.replace('www.','') } catch { return '' } })(),
      date: n.date || 'recent',
      type: classifyNews(n.title, n.snippet),
    })
  }

  // Job signals
  const jobSignals: JobSignal[] = []
  for (const j of hiringResults) {
    const tools = extractTools(j.title + ' ' + j.snippet)
    const signals: string[] = []
    const t = (j.title + ' ' + j.snippet).toLowerCase()
    if (t.includes('head of') || t.includes('vp ') || t.includes('director')) signals.push('Senior hire — budget authority')
    if (t.includes('revops') || t.includes('revenue ops')) signals.push('RevOps build-out — systems investment likely')
    if (t.includes('enterprise')) signals.push('Enterprise motion — upmarket push')
    if (t.includes('scale') || t.includes('growth')) signals.push('Scaling phase — tool evaluation likely')
    if (tools.length) signals.push(`Stack signals: ${tools.join(', ')}`)
    if (tools.length || signals.length) {
      jobSignals.push({
        title: j.title.replace(/\s*[-|]\s*.*/,'').trim(),
        tools_mentioned: tools,
        signals,
        url: j.link,
      })
    }
  }

  return {
    companyName,
    domain: cleanDomain,
    crunchbaseUrl,
    crunchbaseSnippet: fmt(crunchbaseResults),
    fundingData: fmt(fundingNewsResults),
    techStack: builtWith.tools,
    techByCategory: builtWith.byCategory,
    websiteData: fmt(websiteResults),
    linkedinCompanyUrl,
    linkedinData: fmt(linkedinResults),
    news: news.slice(0, 12),
    jobSignals,
    reviewData: fmt(reviewResults),
  }
}
