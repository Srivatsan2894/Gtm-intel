/**
 * Data Layer v4 — Website-first intelligence
 *
 * Primary source: company's own website (always accurate, no ToS issues)
 * Secondary sources: Crunchbase, TechCrunch, OpenExplorer, GitHub
 * Removed: LinkedIn scraping
 */

const SERPER_API = 'https://google.serper.dev/search'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface WebsiteData {
  domain: string
  homepage: string
  about: string
  team: string
  careers: string
  pricing: string
  customers: string
  contact: string
  metaDescription: string
  metaKeywords: string
  hqAddress: string
  socialLinks: { linkedin?: string; twitter?: string; github?: string }
  fetchedPages: string[]
  fetchSuccess: boolean
}

export interface GitHubData {
  orgName: string
  description: string
  location: string
  publicRepos: number
  followers: number
  topLanguages: string[]
  recentActivity: string
  engineers_estimate: number
  found: boolean
}

export interface TechTool {
  name: string
  category: string
  verified: boolean
  source: string
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
  // Website intelligence (primary source)
  website: WebsiteData
  // GitHub (free, reliable, no ToS issues)
  github: GitHubData
  // Tech stack from OpenExplorer
  techStack: TechTool[]
  techByCategory: Record<string, string[]>
  // News from verified sources
  allNews: NewsItem[]
  techCrunchNews: NewsItem[]
  fundingNews: NewsItem[]
  // Crunchbase (public data via Serper)
  crunchbaseSnippet: string
  crunchbaseUrl: string | null
}

// ── Website scraper ────────────────────────────────────────────────────────────
function extractText(html: string, maxLen = 3000): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

function extractMeta(html: string, name: string): string {
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i'),
    new RegExp(`<meta[^>]*property=["']og:${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return ''
}

function extractAddress(text: string): string {
  // Look for address patterns in text
  const patterns = [
    /\d+\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Way|Lane|Ln)[^,\n]*/i,
    /[A-Z][a-z]+,\s+[A-Z]{2}\s+\d{5}/i, // City, ST 12345
    /[A-Z][a-z]+,\s+[A-Z][a-z]+,\s+[A-Z]{2}/i, // City, State, Country
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[0].trim()
  }
  return ''
}

function extractSocialLinks(html: string): { linkedin?: string; twitter?: string; github?: string } {
  const links: { linkedin?: string; twitter?: string; github?: string } = {}
  const linkedinMatch = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"'/?]+)[/"']/i)
  if (linkedinMatch) links.linkedin = linkedinMatch[1]
  const twitterMatch = html.match(/href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'/?]+)[/"']/i)
  if (twitterMatch) links.twitter = twitterMatch[1]
  const githubMatch = html.match(/href=["'](https?:\/\/github\.com\/[^"'/?]+)[/"']/i)
  if (githubMatch) links.github = githubMatch[1]
  return links
}

async function fetchPage(url: string, timeout = 8000): Promise<{ html: string; ok: boolean }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(timeout),
    })
    if (!res.ok) return { html: '', ok: false }
    const html = await res.text()
    return { html, ok: true }
  } catch {
    return { html: '', ok: false }
  }
}

async function scrapeWebsite(domain: string): Promise<WebsiteData> {
  const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  const base = `https://${clean}`
  const wwwBase = `https://www.${clean}`

  const result: WebsiteData = {
    domain: clean,
    homepage: '', about: '', team: '', careers: '', pricing: '',
    customers: '', contact: '', metaDescription: '', metaKeywords: '',
    hqAddress: '', socialLinks: {}, fetchedPages: [], fetchSuccess: false,
  }

  // Pages to try scraping
  const pagesToFetch = [
    { key: 'homepage', paths: ['/', ''] },
    { key: 'about', paths: ['/about', '/about-us', '/company', '/who-we-are'] },
    { key: 'team', paths: ['/team', '/leadership', '/about/team', '/company/team', '/people'] },
    { key: 'careers', paths: ['/careers', '/jobs', '/work-with-us', '/join-us', '/hiring'] },
    { key: 'pricing', paths: ['/pricing', '/plans', '/pricing-plans'] },
    { key: 'customers', paths: ['/customers', '/case-studies', '/success-stories', '/clients'] },
    { key: 'contact', paths: ['/contact', '/contact-us', '/get-in-touch'] },
  ]

  // Fetch homepage first to determine working base URL
  let workingBase = base
  const homepageRes = await fetchPage(base + '/')
  if (!homepageRes.ok) {
    const wwwRes = await fetchPage(wwwBase + '/')
    if (wwwRes.ok) {
      workingBase = wwwBase
      result.homepage = extractText(wwwRes.html, 2500)
      result.metaDescription = extractMeta(wwwRes.html, 'description')
      result.metaKeywords = extractMeta(wwwRes.html, 'keywords')
      result.socialLinks = extractSocialLinks(wwwRes.html)
      result.hqAddress = extractAddress(wwwRes.html)
      result.fetchSuccess = true
      result.fetchedPages.push('homepage')
    }
  } else {
    result.homepage = extractText(homepageRes.html, 2500)
    result.metaDescription = extractMeta(homepageRes.html, 'description')
    result.metaKeywords = extractMeta(homepageRes.html, 'keywords')
    result.socialLinks = extractSocialLinks(homepageRes.html)
    result.hqAddress = extractAddress(homepageRes.html)
    result.fetchSuccess = true
    result.fetchedPages.push('homepage')
  }

  if (!result.fetchSuccess) return result

  // Fetch remaining pages in parallel (skip homepage, already done)
  const remaining = pagesToFetch.slice(1)
  const fetches = await Promise.allSettled(
    remaining.map(async page => {
      for (const path of page.paths) {
        const res = await fetchPage(workingBase + path)
        if (res.ok && res.html.length > 500) {
          return { key: page.key, text: extractText(res.html, 2000), html: res.html }
        }
      }
      return { key: page.key, text: '', html: '' }
    })
  )

  for (const fetch of fetches) {
    if (fetch.status === 'fulfilled' && fetch.value.text) {
      const { key, text, html } = fetch.value
      result[key as keyof WebsiteData] = text as never
      result.fetchedPages.push(key)

      // Extract address from contact/about pages if not found yet
      if (!result.hqAddress && (key === 'contact' || key === 'about')) {
        result.hqAddress = extractAddress(html)
      }
      // Extract social links if not found yet
      if (!result.socialLinks.linkedin && key === 'about') {
        const links = extractSocialLinks(html)
        result.socialLinks = { ...result.socialLinks, ...links }
      }
    }
  }

  return result
}

// ── GitHub intelligence ────────────────────────────────────────────────────────
async function fetchGitHub(domain: string, socialGitHub?: string): Promise<GitHubData> {
  const empty: GitHubData = {
    orgName: '', description: '', location: '', publicRepos: 0,
    followers: 0, topLanguages: [], recentActivity: '', engineers_estimate: 0, found: false,
  }

  // Try to determine org name from domain or social links
  let orgName = ''
  if (socialGitHub) {
    orgName = socialGitHub.replace('https://github.com/', '').split('/')[0]
  } else {
    orgName = domain.split('.')[0] // e.g. attio.com → attio
  }

  if (!orgName) return empty

  try {
    // GitHub API is free, 60 req/hour unauthenticated
    const [orgRes, reposRes] = await Promise.allSettled([
      fetch(`https://api.github.com/orgs/${orgName}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'GTMIntelligence/1.0' },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`https://api.github.com/orgs/${orgName}/repos?sort=updated&per_page=10`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'GTMIntelligence/1.0' },
        signal: AbortSignal.timeout(5000),
      }),
    ])

    if (orgRes.status !== 'fulfilled' || !orgRes.value.ok) {
      // Try as user instead of org
      const userRes = await fetch(`https://api.github.com/users/${orgName}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'GTMIntelligence/1.0' },
        signal: AbortSignal.timeout(5000),
      })
      if (!userRes.ok) return empty
      const user = await userRes.json()
      return {
        orgName, description: user.bio || '', location: user.location || '',
        publicRepos: user.public_repos || 0, followers: user.followers || 0,
        topLanguages: [], recentActivity: '', engineers_estimate: 0, found: true,
      }
    }

    const org = await orgRes.value.json()
    const repos = reposRes.status === 'fulfilled' && reposRes.value.ok
      ? await reposRes.value.json() : []

    // Get top languages from repos
    const langCount: Record<string, number> = {}
    for (const repo of repos) {
      if (repo.language) langCount[repo.language] = (langCount[repo.language] || 0) + 1
    }
    const topLanguages = Object.entries(langCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang]) => lang)

    // Recent activity from latest repos
    const recentActivity = repos.slice(0, 3)
      .map((r: { name: string; description?: string; updated_at: string }) =>
        `${r.name}: ${r.description || 'No description'} (updated ${new Date(r.updated_at).toLocaleDateString()})`)
      .join('; ')

    return {
      orgName,
      description: org.description || '',
      location: org.location || '',
      publicRepos: org.public_repos || 0,
      followers: org.followers || 0,
      topLanguages,
      recentActivity,
      engineers_estimate: Math.round((org.followers || 0) * 0.3),
      found: true,
    }
  } catch {
    return empty
  }
}

// ── OpenExplorer tech stack ────────────────────────────────────────────────────
const OE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhdG5hdHJ6cGpxY3dxbnBwZ2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3ODE2MTEsImV4cCI6MjA2NjM1NzYxMX0.RO4IJkuMNuLoE70UC2-b1JoGH2eXsFkED7HFpOlMofs'

function categorize(name: string): string {
  const n = name.toLowerCase()
  if (['salesforce','hubspot','pipedrive','attio','close'].some(t => n.includes(t))) return 'CRM'
  if (['marketo','pardot','mailchimp','sendgrid','klaviyo','braze'].some(t => n.includes(t))) return 'Marketing'
  if (['google analytics','mixpanel','amplitude','segment','heap','posthog','hotjar'].some(t => n.includes(t))) return 'Analytics'
  if (['intercom','zendesk','freshdesk','drift','crisp','helpscout'].some(t => n.includes(t))) return 'Support'
  if (['stripe','braintree','zuora','chargebee'].some(t => n.includes(t))) return 'Payments'
  if (['outreach','salesloft','gong','apollo','zoominfo'].some(t => n.includes(t))) return 'Sales'
  if (['okta','auth0','onelogin'].some(t => n.includes(t))) return 'Identity'
  if (['aws','gcp','azure','cloudflare','vercel','fastly'].some(t => n.includes(t))) return 'Infrastructure'
  if (['react','next','vue','angular','typescript','tailwind'].some(t => n.includes(t))) return 'Frontend'
  if (['slack','notion','jira','linear','asana','monday'].some(t => n.includes(t))) return 'Productivity'
  if (['workday','bamboohr','rippling','greenhouse','lever'].some(t => n.includes(t))) return 'HR'
  if (['figma','miro','canva'].some(t => n.includes(t))) return 'Design'
  return 'Other'
}

async function getOpenExplorer(domain: string): Promise<{ tools: TechTool[]; byCategory: Record<string, string[]> }> {
  const clean = domain.replace(/^www\./, '').split('/')[0]
  try {
    const res = await fetch(`https://openexplorer.tech/api/website/${clean}`, {
      headers: { 'Authorization': `Bearer ${OE_KEY}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { tools: [], byCategory: {} }
    const data = await res.json()
    const techs: Array<Record<string, unknown>> = Array.isArray(data) ? data
      : Array.isArray(data.technologies) ? data.technologies
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data.results) ? data.results
      : []

    const tools: TechTool[] = []
    const byCategory: Record<string, string[]> = {}
    for (const t of techs) {
      const name = (t.name || t.technology || t.tool || '') as string
      if (!name || name.length < 2) continue
      const cat = ((t.category || t.type || '') as string) || categorize(name)
      if (cat === 'Other') continue
      tools.push({ name, category: cat, verified: true, source: 'OpenExplorer' })
      if (!byCategory[cat]) byCategory[cat] = []
      if (!byCategory[cat].includes(name)) byCategory[cat].push(name)
    }
    return { tools, byCategory }
  } catch { return { tools: [], byCategory: {} } }
}

// ── News fetcher ───────────────────────────────────────────────────────────────
async function serperNews(query: string, num = 6): Promise<NewsItem[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num, type: 'news' }),
    })
    const d = await res.json()
    return (d.news || []).map((n: { title: string; snippet: string; link: string; date?: string; source?: string }) => {
      const type = classifyNews(n.title, n.snippet)
      return { title: n.title, snippet: n.snippet, url: n.link, source: n.source || extractDomain(n.link), date: n.date || 'recent', type }
    })
  } catch { return [] }
}

async function serperSearch(query: string, num = 4): Promise<Array<{ title: string; snippet: string; link: string }>> {
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

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

function classifyNews(title: string, snippet: string): NewsItem['type'] {
  const t = (title + ' ' + snippet).toLowerCase()
  if (t.match(/acqui|merger|acquired|buys|bought/)) return 'acquisition'
  if (t.match(/layoff|laid off|workforce|job cuts/)) return 'layoff'
  if (t.match(/raises|raised|funding|series [a-e]|million|billion|investors|seed/)) return 'funding'
  if (t.match(/appoint|new ceo|new cto|joins as|promoted|hires/)) return 'leadership'
  if (t.match(/launch|releases|new product|new feature|announces/)) return 'product'
  if (t.match(/expand|new market|international|opens|global/)) return 'expansion'
  if (t.match(/partner|integration|integrates|alliance/)) return 'partnership'
  return 'press'
}

// ── MAIN: fetch all company data ───────────────────────────────────────────────
export async function fetchCompanyData(companyName: string): Promise<RawCompanyData> {
  // Step 1: resolve domain from company name
  const domainResults = await serperSearch(`"${companyName}" official website`, 3)
  const skipDomains = ['crunchbase','linkedin','techcrunch','forbes','bloomberg','g2','glassdoor','wikipedia','reddit','twitter','x.com']
  let domain = ''
  for (const r of domainResults) {
    const h = extractDomain(r.link)
    if (h && !skipDomains.some(s => h.includes(s))) { domain = h; break }
  }
  if (!domain) domain = `${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`

  console.log(`[DataLayer] Fetching ${companyName} at ${domain}`)

  // Step 2: fetch everything in parallel
  const [website, techStack, techCrunchNews, fundingNews, generalNews, crunchbase] = await Promise.all([
    // PRIMARY: scrape the actual website
    scrapeWebsite(domain),
    // Tech stack from OpenExplorer
    getOpenExplorer(domain),
    // TechCrunch specifically
    serperNews(`"${companyName}" site:techcrunch.com`, 5),
    // Funding from verified sources
    serperNews(`"${companyName}" funding raised series investors 2024 2025`, 6),
    // General news
    serperNews(`"${companyName}" 2025 announcement news`, 5),
    // Crunchbase public data
    serperSearch(`site:crunchbase.com/organization "${companyName}"`, 2),
  ])

  // Step 3: fetch GitHub using domain + any github link found on website
  const github = await fetchGitHub(domain, website.socialLinks.github)

  // Dedupe and merge news
  const seen = new Set<string>()
  const allNews: NewsItem[] = []
  for (const n of [...fundingNews, ...techCrunchNews, ...generalNews]) {
    const key = n.title.slice(0, 50).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    allNews.push(n)
  }

  const crunchbaseUrl = crunchbase.find(r => r.link.includes('crunchbase.com/organization'))?.link || null
  const crunchbaseSnippet = crunchbase.map(r => r.snippet).join(' ')

  console.log(`[DataLayer] ${companyName}: website=${website.fetchSuccess}, pages=${website.fetchedPages.join(',')}, github=${github.found}, news=${allNews.length}, tech=${techStack.tools.length}`)

  return {
    companyName,
    domain,
    website,
    github,
    techStack: techStack.tools,
    techByCategory: techStack.byCategory,
    allNews: allNews.slice(0, 12),
    techCrunchNews,
    fundingNews,
    crunchbaseSnippet,
    crunchbaseUrl,
  }
}
