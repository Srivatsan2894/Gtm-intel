/**
 * GTM Intel Research Engine v10
 * Real website fetching → OpenExplorer tech stack → verified news → Claude AI
 */

import { fetchCompanyData, type RawCompanyData } from './data-layer'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const SERPER_API = 'https://google.serper.dev/search'

function hasClaude() {
  const k = process.env.ANTHROPIC_API_KEY
  return k && k !== 'placeholder_add_later' && k.startsWith('sk-ant')
}

async function callAI(prompt: string, maxTokens = 1500): Promise<string> {
  if (hasClaude()) {
    try {
      const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.ok) {
        const data = await res.json()
        return (data.content || [])
          .filter((b: {type: string}) => b.type === 'text')
          .map((b: {text: string}) => b.text)
          .join('')
      }
    } catch (e) { console.error('Claude failed, falling back to Groq:', e) }
  }

  // Groq fallback
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('No AI backend')
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
  if (!res.ok) throw new Error(`Groq error ${res.status}`)
  const d = await res.json()
  return d.choices?.[0]?.message?.content || ''
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match) return fallback
    return JSON.parse(match[0])
  } catch { return fallback }
}

// ── LinkedIn validator (kept for optional use) ───────────────────────────────
async function validateLinkedIn(name: string, company: string, title: string): Promise<{url: string|null; verified: boolean}> {
  const key = process.env.SERPER_API_KEY
  if (!key) return { url: null, verified: false }
  const parts = name.toLowerCase().split(' ').filter(p => p.length > 1)
  const first = parts[0] || '', last = parts[parts.length-1] || ''
  for (const q of [
    `site:linkedin.com/in "${name}" "${company}"`,
    `site:linkedin.com/in "${first} ${last}" "${company}" "${title.split(' ').slice(0,3).join(' ')}"`,
  ]) {
    try {
      const res = await fetch(SERPER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q, num: 3 }),
      })
      const data = await res.json()
      for (const r of (data.organic || [])) {
        if (!r.link?.includes('linkedin.com/in/') || r.link.includes('/in/search')) continue
        const slug = r.link.split('linkedin.com/in/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase() || ''
        if (!slug || slug.length < 3) continue
        let score = 0
        if (slug.includes(first.slice(0,4))) score += 35
        if (slug.includes(last.slice(0,4))) score += 35
        if (r.snippet?.toLowerCase().includes(first)) score += 15
        if (r.snippet?.toLowerCase().includes(company.toLowerCase().split(' ')[0])) score += 15
        if (score >= 70) return { url: r.link.split('?')[0], verified: true }
        if (score >= 45) return { url: r.link.split('?')[0], verified: false }
      }
    } catch { continue }
  }
  return { url: null, verified: false }
}

// ── PROMPT A: Extract snapshot from website + crunchbase ─────────────────────
async function extractSnapshot(data: RawCompanyData) {
  // Build rich website context from all scraped pages
  const websiteContext = [
    data.website.metaDescription && `META DESCRIPTION: ${data.website.metaDescription}`,
    data.website.homepage && `HOMEPAGE TEXT:\n${data.website.homepage.slice(0, 1500)}`,
    data.website.about && `ABOUT PAGE:\n${data.website.about.slice(0, 1000)}`,
    data.website.pricing && `PRICING PAGE:\n${data.website.pricing.slice(0, 500)}`,
    data.website.customers && `CUSTOMERS PAGE:\n${data.website.customers.slice(0, 500)}`,
    data.website.contact && `CONTACT PAGE:\n${data.website.contact.slice(0, 500)}`,
    data.website.hqAddress && `ADDRESS FOUND ON WEBSITE: ${data.website.hqAddress}`,
    data.website.socialLinks.linkedin && `LINKEDIN URL (from website): ${data.website.socialLinks.linkedin}`,
    data.website.socialLinks.github && `GITHUB URL (from website): ${data.website.socialLinks.github}`,
    data.website.socialLinks.twitter && `TWITTER (from website): ${data.website.socialLinks.twitter}`,
  ].filter(Boolean).join('\n\n')

  // GitHub context
  const githubContext = data.github.found ? `
GITHUB ORG (${data.github.orgName}):
- Description: ${data.github.description}
- Location: ${data.github.location}
- Public repos: ${data.github.publicRepos}
- Top languages: ${data.github.topLanguages.join(', ')}
- Recent activity: ${data.github.recentActivity}
` : 'GitHub: not found'

  const prompt = `Extract ONLY confirmed facts from the company's OWN WEBSITE. Do not use LinkedIn as a source.
Use "Unknown" if not found on website or Crunchbase. No guessing.

Company: "${data.companyName}"
Website domain: ${data.domain}
Pages fetched: ${data.website.fetchedPages.join(', ') || 'none'}

WEBSITE CONTENT (PRIMARY SOURCE):
${websiteContext || 'Website could not be fetched'}

${githubContext}

CRUNCHBASE DATA:
${data.crunchbaseSnippet || 'No Crunchbase data'}

FUNDING NEWS:
${data.fundingNews.slice(0,4).map(n => `- ${n.title} | ${n.date} | ${n.url}`).join('\n') || 'No funding news'}

Extract into JSON. For hq: use the ADDRESS FOUND ON WEBSITE if available, otherwise infer from contact/about page text:
{
  "name": "exact company name from website",
  "domain": "${data.domain}",
  "website": "https://${data.domain}",
  "industry": "from website content",
  "category": "specific product category from website e.g. AI CRM, DevTools, RevOps",
  "hq": "full address or city+country from website — NOT from LinkedIn",
  "founded": "year from about page or Unknown",
  "employee_count": "number/range from website/about page or Unknown",
  "stage": "Seed|Series A|Series B|Series C|Growth|Public|Unknown",
  "total_funding": "from Crunchbase/news or Unknown",
  "latest_round": "round + amount + date from Crunchbase/news or Unknown",
  "investors": "investor names from Crunchbase/news or Unknown",
  "description": "2 sentences written from the actual homepage/about text — what they do and who they serve",
  "website_url": "https://${data.domain}",
  "linkedin_url": "${data.website.socialLinks.linkedin || ''}",
  "github_url": "${data.website.socialLinks.github || ''}",
  "crunchbase_url": "${data.crunchbaseUrl || ''}",
  "icp": "who they sell to — from customers page or homepage messaging",
  "business_model": "SaaS|Usage-based|Enterprise|Freemium|Unknown",
  "key_features": ["real features from website"],
  "tech_built_with": ${JSON.stringify(data.github.topLanguages)},
  "priority_score": 7
}`

  const raw = await callAI(prompt, 1000)
  return parseJSON(raw, {
    name: data.companyName, domain: data.domain,
    website: `https://${data.domain}`, website_url: `https://${data.domain}`,
    industry: 'Unknown', category: 'Unknown',
    hq: data.github.location || 'Unknown',
    founded: 'Unknown', employee_count: 'Unknown', stage: 'Unknown',
    total_funding: 'Unknown', latest_round: 'Unknown', investors: 'Unknown',
    description: data.website.metaDescription || '',
    linkedin_url: data.website.socialLinks.linkedin || '',
    github_url: data.website.socialLinks.github || '',
    crunchbase_url: data.crunchbaseUrl || '',
    icp: 'Unknown', business_model: 'Unknown',
    key_features: [], tech_built_with: data.github.topLanguages, priority_score: 5,
  })
}

// ── PROMPT B: Extract scoops from verified news ───────────────────────────────
async function extractScoops(data: RawCompanyData, snapshot: {name: string; stage: string; total_funding: string}, salesDescription: string) {
  if (!data.allNews.length) return []

  const newsText = data.allNews.slice(0, 12).map(n =>
    `[${n.type.toUpperCase()}] ${n.title}\nSnippet: ${n.snippet}\nSource: ${n.source}\nDate: ${n.date}\nURL: ${n.url}`
  ).join('\n\n---\n\n')

  const prompt = `Extract GTM scoops from this REAL news data about "${snapshot.name}".
Sales rep sells: "${salesDescription}"

NEWS DATA (use exact URLs and dates from below):
${newsText}

Rules:
- source_url MUST be the exact URL from above
- Include ONLY news from 2024-2025
- Include specific details: amounts, names, percentages
- Explain WHY each signal matters for outreach

Return ONLY JSON array ([] if nothing with real URLs from 2024-2025):
[{
  "type": "funding|acquisition|layoff|leadership_change|product_launch|partnership|expansion|press",
  "headline": "punchy headline with real specifics",
  "detail": "2-3 sentences with exact details from the source",
  "why_it_matters": "one sentence: specific buying opportunity this creates",
  "source": "publication name from data",
  "source_url": "exact URL from data — required",
  "date": "exact date from data"
}]`

  const raw = await callAI(prompt, 1500)
  const scoops = parseJSON<Array<{type:string;headline:string;detail:string;why_it_matters:string;source:string;source_url:string;date:string}>>(raw, [])
  return scoops.filter(s => s.source_url?.startsWith('http'))
}

// ── PROMPT C: Generate sales insights ────────────────────────────────────────
async function generateInsights(
  snapshot: Record<string, unknown>,
  techByCategory: Record<string, string[]>,
  scoops: Array<{type:string;headline:string;why_it_matters:string}>,
  data: RawCompanyData,
  salesDescription: string
) {
  const techText = Object.entries(techByCategory).length > 0
    ? Object.entries(techByCategory).map(([cat, tools]) => `${cat}: ${tools.join(', ')}`).join('\n')
    : 'No tech stack data available'

  const topScoops = scoops.slice(0,3).map(s => `[${s.type}] ${s.headline}: ${s.why_it_matters}`).join('\n')

  const hiringSignals = data.allNews
    .filter(n => n.title.toLowerCase().includes('hire') || n.title.toLowerCase().includes('appoint') || n.title.toLowerCase().includes('joins'))
    .slice(0,3)
    .map(n => `- ${n.title}`)
    .join('\n')

  const prompt = `Senior sales strategist generating insights from verified company data.

SELLING: "${salesDescription}"

COMPANY DATA:
Name: ${snapshot.name}
Category: ${snapshot.category}
Stage: ${snapshot.stage} | Funding: ${snapshot.total_funding}
Employees: ${snapshot.employee_count} | HQ: ${snapshot.hq}
ICP: ${snapshot.icp}
Key features: ${JSON.stringify(snapshot.key_features)}
Website: ${snapshot.website}

VERIFIED TECH STACK (OpenExplorer):
${techText}

TOP BUYING SIGNALS:
${topScoops || 'None yet'}

RECENT HIRING:
${hiringSignals || 'None found'}

Generate specific, evidence-based insights. Reference actual data above.
Return ONLY JSON:
{
  "why_relevant": "2 specific sentences referencing their stage, tech stack, or signals",
  "executive_summary": "3 sentences: what they do + current moment + the opportunity",
  "pain_points": [
    {"title": "specific pain from their data", "description": "evidence from tech/stage/signals", "severity": "high|medium|low"}
  ],
  "discovery_questions": [
    "question referencing something specific from their stack or news"
  ],
  "outreach_angles": [
    {"title": "angle title", "description": "specific angle based on their actual data"}
  ],
  "icp_fit_score": 8
}`

  const raw = await callAI(prompt, 1200)
  return parseJSON(raw, {
    why_relevant: '', executive_summary: '', pain_points: [],
    discovery_questions: [], outreach_angles: [], icp_fit_score: 5,
  })
}

// ── PROMPT D: Write outreach ──────────────────────────────────────────────────
async function writeOutreach(
  snapshot: Record<string, unknown>,
  scoops: Array<{headline:string;date:string;why_it_matters:string}>,
  insights: {why_relevant:string; outreach_angles:Array<{title:string;description:string}>},
  salesDescription: string
) {
  const topScoop = scoops[0] ? `${scoops[0].headline} (${scoops[0].date})` : insights.why_relevant
  const angle = insights.outreach_angles[0] ? `${insights.outreach_angles[0].title}: ${insights.outreach_angles[0].description}` : ''

  const prompt = `Write personalized B2B outreach. Reference the real signal below.

SELLING: "${salesDescription}"
TARGET: ${snapshot.name} — ${snapshot.category}, ${snapshot.stage}, ${snapshot.employee_count} employees
DESCRIPTION: ${snapshot.description}
SIGNAL: ${topScoop}
ANGLE: ${angle || insights.why_relevant}

Rules: reference specific signal, subject <8 words, LinkedIn <60 words, no generic openers.
Return ONLY JSON:
{
  "cold_email": "Subject: [<8 words]\\n\\nHi [First Name],\\n\\n[2-3 sentences: specific signal + value + CTA]\\n\\n[Name]",
  "linkedin_message": "Hi [Name] — [60 words max, one real signal, clear ask]",
  "call_script": "Hi [Name], [Rep] from [Co]. [One specific observation]. Quick question — [discovery question]? [Pause]",
  "objections": [
    {"objection": "realistic objection", "counter": "specific counter using their situation"}
  ]
}`

  const raw = await callAI(prompt, 800)
  return parseJSON(raw, { cold_email: '', linkedin_message: '', call_script: '', objections: [] })
}

// ── STEP 6: Find contacts ─────────────────────────────────────────────────────
async function findContacts(
  snapshot: Record<string, unknown>,
  insights: {why_relevant: string},
  salesDescription: string
) {
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const companyName = snapshot.name as string

  // Search for team members from company website and press coverage — no LinkedIn scraping
  const [r1, r2] = await Promise.all([
    fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `"${companyName}" CEO CTO founder VP director site:${snapshot.domain as string || ''}`, num: 5 }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
    fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `"${companyName}" leadership team "head of" OR "VP of" OR "director of" 2025`, num: 5 }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  // Extract names from search results — no LinkedIn dependency
  const found = [...r1, ...r2]
    .filter((r: {link: string}) => {
      const domain = r.link?.toLowerCase() || ''
      // Accept company website, tech press, Crunchbase — NOT LinkedIn profiles
      return !domain.includes('linkedin.com/in/') &&
             !domain.includes('twitter.com') &&
             !domain.includes('facebook.com')
    })
    .map((r: {title: string; snippet: string; link: string}) => {
      // Try to extract a person name from title/snippet
      const nameMatch = r.snippet?.match(/([A-Z][a-z]+ [A-Z][a-z]+),?\s+(CEO|CTO|CPO|CRO|CMO|VP|Head|Director|Co-founder|Founder)/i)
      if (nameMatch) {
        return { name: nameMatch[1], title: nameMatch[2], url: r.link }
      }
      return null
    })
    .filter(Boolean)
    .filter((p): p is {name: string; title: string; url: string} => !!p && p.name.length > 2 && p.name.length < 50)
    .slice(0, 6)

  if (!found.length) return []

  const domain = snapshot.domain as string
  const contactList = found.map((p, i) => `${i+1}. ${p.name} — ${p.title}`).join('\n')

  const prompt = `Company: ${companyName} (${snapshot.category}, ${snapshot.stage})
Domain: ${domain}
Rep sells: "${salesDescription}"
Key insight: ${insights.why_relevant}

Contacts found:
${contactList}

Assign role and write personalized 3-line message for each.
Return ONLY JSON array:
[{
  "name": "exact name",
  "title": "exact title",
  "department": "Sales|RevOps|CS|Product|Engineering|Finance|IT|Marketing|Executive",
  "email_guess": "firstname@${domain}",
  "email_pattern": "first@${domain}",
  "email_confidence": "high|medium|low",
  "role_in_deal": "champion|blocker|influencer|evaluator",
  "outreach_message": "Hi [name], [3 lines specific to ${companyName}]"
}]`

  const raw = await callAI(prompt, 800)
  const enriched = parseJSON<Array<Record<string, string>>>(raw, [])

  // Return contacts without LinkedIn dependency
  return enriched.slice(0,6).map(c => ({
    ...c,
    linkedin_url: null,
    linkedin_verified: false,
  }))
}

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────────
export async function runFullResearch(
  companyName: string,
  salesDescription: string,
  targetIndustries: string[]
) {
  try {
    console.log(`[${hasClaude() ? 'Claude' : 'Groq'}] Researching: ${companyName}`)

    // Step 1: fetch all data (website + OpenExplorer + news) in parallel
    const data = await fetchCompanyData(companyName)
    console.log(`Website fetched: ${data.website.fetchSuccess} | Domain: ${data.domain} | News: ${data.allNews.length} | Tech: ${data.techStack.length}`)

    // Step 2: extract snapshot from real website content
    const snapshot = await extractSnapshot(data)

    // Step 3: extract scoops from verified news
    const scoops = await extractScoops(data, snapshot, salesDescription)

    // Step 4: generate insights
    const insights = await generateInsights(snapshot, data.techByCategory, scoops, data, salesDescription)

    // Steps 5+6 parallel: outreach + contacts
    const [outreach, contacts] = await Promise.all([
      writeOutreach(snapshot, scoops, insights, salesDescription),
      findContacts(snapshot, insights, salesDescription),
    ])

    // Build tech stack display
    const techStack = Object.entries(data.techByCategory).length > 0
      ? Object.entries(data.techByCategory).map(([cat, tools]) => ({
          category: cat, tool: tools.join(', '),
          confidence: 'high' as const, verified: true, source: 'OpenExplorer',
        }))
      : []

    return {
      company: {
        name: snapshot.name || companyName,
        domain: snapshot.domain,
        website: snapshot.website,
        industry: snapshot.industry,
        size: snapshot.employee_count,
        stage: snapshot.stage,
        hq: snapshot.hq,
        linkedin_url: snapshot.linkedin_url || null,
        crunchbase_url: snapshot.crunchbase_url || null,
        description: snapshot.description,
        founded: snapshot.founded,
        total_funding: snapshot.total_funding,
        latest_round: snapshot.latest_round,
        investors: snapshot.investors,
        key_features: snapshot.key_features || [],
        priority_score: (insights.icp_fit_score as number) || (snapshot.priority_score as number) || 5,
      },
      executive_summary: (insights.executive_summary as string) || (snapshot.description as string),
      business_model: snapshot.business_model as string,
      why_relevant: insights.why_relevant as string,
      gtm_scoops: scoops,
      pain_points: insights.pain_points,
      tech_stack: techStack,
      buying_signals: scoops.map(s => ({
        signal: s.headline, why_it_matters: s.why_it_matters,
        source: s.source, source_url: s.source_url, date: s.date,
      })),
      discovery_questions: insights.discovery_questions,
      outreach_angles: insights.outreach_angles,
      cold_email: (outreach as {cold_email:string}).cold_email,
      linkedin_message: (outreach as {linkedin_message:string}).linkedin_message,
      call_script: (outreach as {call_script:string}).call_script,
      objections: (outreach as {objections:Array<{objection:string;counter:string}>}).objections,
      contacts,
      recent_news: scoops.map(s => ({
        title: s.headline, summary: s.detail,
        source_name: s.source, source_url: s.source_url,
        date: s.date, signal_type: s.type,
      })),
      job_signals: [],
    }
  } catch (err) {
    console.error('Pipeline error:', err)
    return null
  }
}

// ── DISCOVER ──────────────────────────────────────────────────────────────────
export async function discoverCompanies(
  salesDescription: string,
  targetIndustries: string[],
  targetSizes: string[],
  icpNotes: string,
  count = 5
): Promise<string[]> {
  const ind = targetIndustries.slice(0,2).join(' ')
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const [s1, s2, s3] = await Promise.all([
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `AI SaaS startup ${ind} funding raised 2025 2026`, num: 10, type: 'news' }) }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `AI-first ${ind} company product launch 2025 2026`, num: 8, type: 'news' }) }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `best AI ${ind} startups funding 2025`, num: 8 }) }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  const skip = new Set(['techcrunch','crunchbase','linkedin','forbes','bloomberg','medium','github','reddit','g2','glassdoor'])
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const r of [...s1, ...s2, ...s3]) {
    try {
      const domain = new URL(r.link).hostname.replace('www.','')
      const base = domain.split('.')[0]
      if (skip.has(base) || seen.has(domain)) continue
      seen.add(domain)
      const name = r.title?.replace(/\s*[-|–:]\s*.*/g,'')?.replace(/\s*(Inc|LLC|Ltd|Corp)\.?$/gi,'')?.trim()
      if (name && name.length > 2 && name.length < 50) { candidates.push(name); if (candidates.length >= 15) break }
    } catch { continue }
  }

  if (!candidates.length) return []

  const prompt = `Rep sells: "${salesDescription.slice(0,150)}" to ${ind}. ICP: ${icpNotes||'AI-first SaaS'}
Pick ${count} best AI-first B2B companies (not media/news sites):
${candidates.map((c,i) => `${i+1}. ${c}`).join('\n')}
Return ONLY JSON array: ["Company A","Company B"]`

  const raw = await callAI(prompt, 200)
  return parseJSON<string[]>(raw, candidates.slice(0,count))
}

// ── SIGNAL REFRESH ────────────────────────────────────────────────────────────
export async function refreshSignals(
  companyName: string,
  domain: string,
  salesDescription: string,
  lastCheckedAt: string|null
) {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  const since = lastCheckedAt
    ? `since ${new Date(lastCheckedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`
    : 'in the last 7 days'

  try {
    const res = await fetch(SERPER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: `"${companyName}" ${since} news funding acquisition layoff`, num: 6, type: 'news' }),
    })
    const data = await res.json()
    const news = data.news || []
    if (!news.length) return []

    const newsText = news.map((n: {title:string;snippet:string;link:string;date?:string;source?:string}) =>
      `[${n.title}] ${n.snippet} | URL: ${n.link} | Date: ${n.date||'recent'} | Source: ${n.source||''}`
    ).join('\n\n')

    const prompt = `Extract new signals ${since} for "${companyName}". Rep sells: "${salesDescription}".
Data: ${newsText}
Return ONLY JSON array ([] if nothing new with real URLs):
[{"signal_type":"funding|acquisition|layoff|leadership_change|product_launch|partnership|expansion|press|other","title":"headline","summary":"2 sentences + why it matters for sales","source_name":"pub","source_url":"exact URL","source_verified":true,"signal_date":"YYYY-MM-DD"}]`

    const raw = await callAI(prompt, 800)
    return parseJSON<SignalResult[]>(raw, [])
  } catch { return [] }
}

export async function generateDigestSummary(
  salesDescription: string,
  signalsByProspect: Array<{company: string; signals: SignalResult[]}>
) {
  const text = signalsByProspect.map(p => `${p.company}: ${p.signals.map(s=>`[${s.signal_type}] ${s.title}`).join(', ')}`).join('\n')
  return callAI(`Coach for rep selling "${salesDescription}". Signals: ${text}. 3-4 sentence briefing: top signal, who to call first, why. Plain text.`, 300)
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
