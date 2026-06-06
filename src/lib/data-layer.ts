/**
 * Data Layer v3 — Real website fetching + OpenExplorer + verified news
 * Zero AI. Pure structured data.
 */

const SERPER_API = 'https://google.serper.dev/search'

export interface TechTool {
  name: string
  category: string
  verified: boolean
  source: string
}

export interface CompanyWebData {
  domain: string
  homepageText: string
  aboutText: string
  metaDescription: string
  fetchedAt: string
  fetchSuccess: boolean
}

export interface NewsItem {
  title: string
  snippet: string
  url: string
  source: string
  date: string
  type: 'funding' | 'acquisition' | 'layoff' | 'leadership' | 'product' | 'expansion' | 'partnership' | 'press' | 'other'
}

export interface RawCompanyData {
  companyName: string
  domain: string
  resolvedDomain: string
  // Website content (fetched directly)
  webData: CompanyWebData
  // Tech stack from OpenExplorer
  techStack: TechTool[]
  techByCategory: Record<string, string[]>
  // Verified news from specific sources
  techCrunchNews: NewsItem[]
  fundingNews: NewsItem[]
  generalNews: NewsItem[]
  allNews: NewsItem[]
  // LinkedIn
  linkedinCompanyUrl: string | null
  linkedinSnippet: string
  // Crunchbase
  crunchbaseUrl: string | null
  crunchbaseSnippet: string
}

// ── Serper ────────────────────────────────────────────────────────────────────
async function serperSearch(query: string, num = 6): Promise<Array<{title: string; snippet: string; link: string; date?: string; source?: string}>> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num }),
    })
    const d = await res.json()
    return d.organic || []
  } catch { return [] }
}

async function serperNews(query: string, num = 6): Promise<Array<{title: string; snippet: string; link: string; date?: string; source?: string}>> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num, type: 'news' }),
    })
    const d = await res.json()
    return d.news || []
  } catch { return [] }
}

// ── Website fetcher ───────────────────────────────────────────────────────────
async function fetchWebsite(domain: string): Promise<CompanyWebData> {
  const base: CompanyWebData = {
    domain, homepageText: '', aboutText: '',
    metaDescription: '', fetchedAt: new Date().toISOString(), fetchSuccess: false,
  }

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

  const tryFetch = async (url: string): Promise<string> => {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GTMIntel/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return ''
      const html = await res.text()
      // Extract text content — strip HTML tags
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000)

      // Extract meta description
      const metaMatch = html.match(/<meta[^>]*name=['"](description|og:description)['"]\s*content=['"](.*?)['"][^>]*>/i)
      if (metaMatch) base.metaDescription = metaMatch[2].trim()

      return text
    } catch { return '' }
  }

  // Try homepage
  const homepage = await tryFetch(`https://www.${cleanDomain}`)
    || await tryFetch(`https://${cleanDomain}`)

  if (homepage) {
    base.homepageText = homepage
    base.fetchSuccess = true
    base.domain = cleanDomain
  }

  // Try /about page
  const about = await tryFetch(`https://www.${cleanDomain}/about`)
    || await tryFetch(`https://${cleanDomain}/about`)
    || await tryFetch(`https://www.${cleanDomain}/company`)
  base.aboutText = about.slice(0, 2000)

  return base
}

// ── OpenExplorer tech stack ───────────────────────────────────────────────────
const TOOL_CATEGORIES: Record<string, string> = {
  // CRM & Sales
  'salesforce': 'CRM', 'hubspot': 'CRM', 'pipedrive': 'CRM', 'close': 'CRM',
  'outreach': 'Sales Engagement', 'salesloft': 'Sales Engagement', 'apollo': 'Sales',
  'gong': 'Revenue Intelligence', 'chorus': 'Revenue Intelligence',
  // Marketing
  'marketo': 'Marketing', 'pardot': 'Marketing', 'mailchimp': 'Email Marketing',
  'sendgrid': 'Email', 'klaviyo': 'Email Marketing', 'braze': 'Marketing',
  'iterable': 'Marketing', 'customer.io': 'Marketing',
  // Analytics
  'google analytics': 'Analytics', 'mixpanel': 'Analytics', 'amplitude': 'Analytics',
  'segment': 'Data', 'heap': 'Analytics', 'posthog': 'Analytics', 'hotjar': 'Analytics',
  'fullstory': 'Analytics',
  // Support
  'zendesk': 'Support', 'intercom': 'Support & Chat', 'freshdesk': 'Support',
  'drift': 'Chat', 'crisp': 'Chat', 'helpscout': 'Support',
  // Infra
  'aws': 'Infrastructure', 'google cloud': 'Infrastructure', 'azure': 'Infrastructure',
  'cloudflare': 'Infrastructure', 'vercel': 'Infrastructure', 'fastly': 'CDN',
  // Payments
  'stripe': 'Payments', 'braintree': 'Payments', 'zuora': 'Billing',
  'chargebee': 'Billing', 'recurly': 'Billing',
  // Productivity
  'slack': 'Productivity', 'notion': 'Productivity', 'jira': 'Project Management',
  'linear': 'Project Management', 'asana': 'Project Management',
  // Auth & HR
  'okta': 'Identity', 'auth0': 'Identity', 'workday': 'HR', 'bamboohr': 'HR',
  'rippling': 'HR',
  // Frontend
  'react': 'Frontend', 'next.js': 'Frontend', 'vue': 'Frontend',
  'angular': 'Frontend', 'typescript': 'Frontend',
  // Design
  'figma': 'Design', 'miro': 'Design',
}

function categorize(name: string): string {
  const lower = name.toLowerCase()
  for (const [tool, cat] of Object.entries(TOOL_CATEGORIES)) {
    if (lower.includes(tool)) return cat
  }
  return 'Other'
}

// OpenExplorer public anon key (from their API docs)
const OPEN_EXPLORER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhdG5hdHJ6cGpxY3dxbnBwZ2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3ODE2MTEsImV4cCI6MjA2NjM1NzYxMX0.RO4IJkuMNuLoE70UC2-b1JoGH2eXsFkED7HFpOlMofs'

async function getOpenExplorerStack(domain: string): Promise<{tools: TechTool[]; byCategory: Record<string, string[]>}> {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

  try {
    // Official endpoint: GET /api/website/{domain}
    const res = await fetch(`https://openexplorer.tech/api/website/${cleanDomain}`, {
      headers: {
        'Authorization': `Bearer ${OPEN_EXPLORER_KEY}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      console.log(`OpenExplorer ${res.status} for ${cleanDomain}`)
      return { tools: [], byCategory: {} }
    }

    const data = await res.json()
    console.log(`OpenExplorer response for ${cleanDomain}:`, JSON.stringify(data).slice(0, 300))

    // Handle response shape
    let technologies: Array<Record<string, unknown>> = []
    if (Array.isArray(data)) {
      technologies = data
    } else if (Array.isArray(data.technologies)) {
      technologies = data.technologies
    } else if (data.data && Array.isArray(data.data)) {
      technologies = data.data
    } else if (data.techStack) {
      technologies = Array.isArray(data.techStack) ? data.techStack : []
    } else if (data.tools) {
      technologies = Array.isArray(data.tools) ? data.tools : []
    }

    if (!technologies.length) return { tools: [], byCategory: {} }

    const tools: TechTool[] = []
    const byCategory: Record<string, string[]> = {}

    for (const t of technologies) {
      const name = (t.name || t.technology || t.tool || t.title || '') as string
      if (!name || name.length < 2) continue
      const rawCat = (t.category || t.type || t.group || '') as string
      const cat = rawCat
        ? rawCat.charAt(0).toUpperCase() + rawCat.slice(1)
        : categorize(name)
      if (cat === 'Other') continue

      tools.push({ name, category: cat, verified: true, source: 'OpenExplorer' })
      if (!byCategory[cat]) byCategory[cat] = []
      if (!byCategory[cat].includes(name)) byCategory[cat].push(name)
    }

    return { tools, byCategory }
  } catch (e) {
    console.error('OpenExplorer error:', e)
    return { tools: [], byCategory: {} }
  }
}

// ── News classifier ───────────────────────────────────────────────────────────
function classifyNews(title: string, snippet: string): NewsItem['type'] {
  const t = (title + ' ' + snippet).toLowerCase()
  if (t.match(/acqui|merger|acquired|buys|bought/)) return 'acquisition'
  if (t.match(/layoff|laid off|workforce reduction|job cuts|let go/)) return 'layoff'
  if (t.match(/raises|raised|funding|series [a-e]|seed round|million|billion|investors/)) return 'funding'
  if (t.match(/appoint|new ceo|new cto|joins as|promoted to|hires/)) return 'leadership'
  if (t.match(/launch|releases|new product|new feature|announces|unveils/)) return 'product'
  if (t.match(/expand|new market|international|opens|global/)) return 'expansion'
  if (t.match(/partner|integration|integrates|alliance|collaborate/)) return 'partnership'
  return 'press'
}

// ── MAIN: fetch all company data ──────────────────────────────────────────────
export async function fetchCompanyData(companyName: string): Promise<RawCompanyData> {
  // Step 1: Resolve domain first
  const domainResults = await serperSearch(`"${companyName}" official website`, 3)
  let resolvedDomain = ''
  const skipDomains = ['crunchbase', 'linkedin', 'techcrunch', 'forbes', 'bloomberg', 'g2', 'glassdoor', 'wikipedia', 'reddit']

  for (const r of domainResults) {
    try {
      const h = new URL(r.link).hostname.replace('www.', '')
      if (!skipDomains.some(s => h.includes(s))) {
        resolvedDomain = h
        break
      }
    } catch { continue }
  }

  if (!resolvedDomain) {
    // Fallback: guess from company name
    resolvedDomain = `${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`
  }

  // All remaining fetches in parallel
  const [
    webData,
    techStackData,
    techCrunchRaw,
    fundingRaw,
    generalNewsRaw,
    linkedinRaw,
    crunchbaseRaw,
  ] = await Promise.all([
    fetchWebsite(resolvedDomain),
    getOpenExplorerStack(resolvedDomain),
    // TechCrunch specifically
    serperNews(`"${companyName}" site:techcrunch.com`, 5),
    // Funding from multiple sources
    serperNews(`"${companyName}" funding raised investors 2024 2025`, 6),
    // General news last 6 months
    serperNews(`"${companyName}" 2025 announcement news`, 6),
    // LinkedIn
    serperSearch(`site:linkedin.com/company "${companyName}"`, 2),
    // Crunchbase
    serperSearch(`site:crunchbase.com/organization "${companyName}"`, 2),
  ])

  const linkedinCompanyUrl = linkedinRaw
    .find(r => r.link.includes('linkedin.com/company/') && !r.link.includes('/search'))
    ?.link?.split('?')[0] || null

  const crunchbaseUrl = crunchbaseRaw
    .find(r => r.link.includes('crunchbase.com/organization'))
    ?.link || null

  // Build unified deduped news list
  const seen = new Set<string>()
  const allNews: NewsItem[] = []

  for (const n of [...fundingRaw, ...techCrunchRaw, ...generalNewsRaw]) {
    const key = n.title.slice(0, 50).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    allNews.push({
      title: n.title,
      snippet: n.snippet,
      url: n.link,
      source: n.source || (() => { try { return new URL(n.link).hostname.replace('www.','') } catch { return '' } })(),
      date: n.date || 'recent',
      type: classifyNews(n.title, n.snippet),
    })
  }

  return {
    companyName,
    domain: resolvedDomain,
    resolvedDomain,
    webData,
    techStack: techStackData.tools,
    techByCategory: techStackData.byCategory,
    techCrunchNews: techCrunchRaw.map(n => ({ title: n.title, snippet: n.snippet, url: n.link, source: 'TechCrunch', date: n.date || 'recent', type: classifyNews(n.title, n.snippet) })),
    fundingNews: fundingRaw.map(n => ({ title: n.title, snippet: n.snippet, url: n.link, source: n.source || '', date: n.date || 'recent', type: classifyNews(n.title, n.snippet) })),
    generalNews: generalNewsRaw.map(n => ({ title: n.title, snippet: n.snippet, url: n.link, source: n.source || '', date: n.date || 'recent', type: classifyNews(n.title, n.snippet) })),
    allNews: allNews.slice(0, 15),
    linkedinCompanyUrl,
    linkedinSnippet: linkedinRaw.map(r => r.snippet).join(' '),
    crunchbaseUrl,
    crunchbaseSnippet: crunchbaseRaw.map(r => r.snippet).join(' '),
  }
}
