/**
 * GTM Intel Research Engine v9
 * Claude API (primary) with Groq fallback
 * Focused on: real scoops with source URLs, verified data, structured output
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'
const SERPER_API = 'https://google.serper.dev/search'

function hasClaude() {
  const k = process.env.ANTHROPIC_API_KEY
  return k && k !== 'placeholder_add_later' && k.startsWith('sk-ant')
}

// ── Claude with web search (handles multi-turn tool_use) ─────────────────────
async function claude(prompt: string, maxTokens = 2000, webSearch = false): Promise<string> {
  if (!hasClaude()) return groq(prompt, maxTokens)

  const body: Record<string, unknown> = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  }
  if (webSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  }

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const e = await res.text()
    console.error('Claude error:', e)
    return groq(prompt, maxTokens)
  }

  const data = await res.json()

  // Handle multi-turn: if Claude used web_search tool, continue conversation
  if (data.stop_reason === 'tool_use' && webSearch) {
    const toolUseBlock = data.content.find((b: {type: string}) => b.type === 'tool_use')
    const toolResultBlock = data.content.find((b: {type: string; content?: Array<{text: string}>}) => b.type === 'tool_result')

    if (toolUseBlock && !toolResultBlock) {
      // Need to send tool result back - but we don't have the actual result
      // Claude's web_search handles this internally, extract text from next response
      const continueRes = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: data.content },
          ],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        }),
      })
      if (continueRes.ok) {
        const continueData = await continueRes.json()
        return (continueData.content || [])
          .filter((b: {type: string}) => b.type === 'text')
          .map((b: {text: string}) => b.text)
          .join('')
      }
    }
  }

  return (data.content || [])
    .filter((b: {type: string}) => b.type === 'text')
    .map((b: {text: string}) => b.text)
    .join('')
}

// ── Groq fallback ─────────────────────────────────────────────────────────────
async function groq(prompt: string, maxTokens = 2000): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('No AI backend configured')
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
  if (!res.ok) { const e = await res.text(); throw new Error(`Groq error: ${e}`) }
  const d = await res.json()
  return d.choices?.[0]?.message?.content || ''
}

// ── Serper ────────────────────────────────────────────────────────────────────
async function serper(
  query: string, num = 6,
  type: 'search' | 'news' = 'search'
): Promise<Array<{title: string; snippet: string; link: string; date?: string; source?: string}>> {
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
  return results.map(r =>
    `TITLE: ${r.title}\nSNIPPET: ${r.snippet}\nURL: ${r.link}${r.date ? `\nDATE: ${r.date}` : ''}`
  ).join('\n\n---\n\n')
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match) return fallback
    return JSON.parse(match[0])
  } catch { return fallback }
}

// ── LinkedIn validator ────────────────────────────────────────────────────────
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

// ── STEP 1: Fetch real data from sources ─────────────────────────────────────
interface RawData {
  companyName: string
  domain: string
  crunchbase: string
  funding: string
  techcrunch: string
  news: string
  hiring: string
  website: string
  linkedin: string
  linkedinUrl: string | null
}

async function fetchData(companyName: string): Promise<RawData> {
  const [crunchbase, funding, techcrunch, news, hiring, website, linkedin] = await Promise.all([
    serper(`site:crunchbase.com/organization "${companyName}"`, 3),
    serper(`"${companyName}" funding raised investors series 2024 2025`, 5, 'news'),
    serper(`"${companyName}" site:techcrunch.com OR site:venturebeat.com OR site:reuters.com 2024 2025`, 5),
    serper(`"${companyName}" news announcement acquisition layoff leadership 2025`, 6, 'news'),
    serper(`"${companyName}" hiring careers jobs director VP 2025`, 4),
    serper(`"${companyName}" official site about product overview`, 3),
    serper(`site:linkedin.com/company "${companyName}"`, 2),
  ])

  const linkedinUrl = linkedin
    .find(r => r.link.includes('linkedin.com/company/') && !r.link.includes('/search'))
    ?.link?.split('?')[0] || null

  // Estimate domain from crunchbase or website results
  let domain = ''
  for (const r of [...website, ...crunchbase]) {
    try {
      const h = new URL(r.link).hostname.replace('www.','')
      if (!h.includes('crunchbase') && !h.includes('techcrunch') && !h.includes('linkedin')) {
        domain = h; break
      }
    } catch { continue }
  }

  return {
    companyName,
    domain: domain || `${companyName.toLowerCase().replace(/[^a-z0-9]/g,'')}.com`,
    crunchbase: fmt(crunchbase),
    funding: fmt(funding),
    techcrunch: fmt(techcrunch),
    news: fmt(news),
    hiring: fmt(hiring),
    website: fmt(website),
    linkedin: fmt(linkedin),
    linkedinUrl,
  }
}

// ── STEP 2: Extract snapshot ──────────────────────────────────────────────────
interface Snapshot {
  name: string; domain: string; industry: string; category: string
  hq: string; founded: string; employee_count: string; stage: string
  total_funding: string; latest_round: string; investors: string
  description: string; linkedin_url: string; icp: string
  business_model: string; priority_score: number
}

async function extractSnapshot(data: RawData): Promise<Snapshot> {
  const prompt = `Extract ONLY confirmed facts from these sources. Use "Unknown" if not found.

Company: "${data.companyName}"

CRUNCHBASE:
${data.crunchbase}

WEBSITE:
${data.website}

LINKEDIN: ${data.linkedinUrl || 'not found'}

FUNDING NEWS:
${data.funding}

Return ONLY this JSON — no explanation:
{
  "name": "exact company name",
  "domain": "${data.domain}",
  "industry": "from sources",
  "category": "specific e.g. AI CRM, Revenue Intelligence",
  "hq": "city, country",
  "founded": "year or Unknown",
  "employee_count": "number/range or Unknown",
  "stage": "Seed|Series A|Series B|Series C|Growth|Public|Unknown",
  "total_funding": "e.g. $141M or Unknown",
  "latest_round": "e.g. Series B $52M August 2025 or Unknown",
  "investors": "key investors or Unknown",
  "description": "2 sentences from website — what they do and who for",
  "linkedin_url": "${data.linkedinUrl || 'Unknown'}",
  "icp": "who they sell to",
  "business_model": "SaaS|Usage-based|Enterprise|Freemium|Unknown",
  "priority_score": 7
}`

  const raw = await claude(prompt, 800, false)
  return parseJSON<Snapshot>(raw, {
    name: data.companyName, domain: data.domain, industry: 'Unknown',
    category: 'Unknown', hq: 'Unknown', founded: 'Unknown',
    employee_count: 'Unknown', stage: 'Unknown', total_funding: 'Unknown',
    latest_round: 'Unknown', investors: 'Unknown', description: '',
    linkedin_url: data.linkedinUrl || '', icp: 'Unknown',
    business_model: 'Unknown', priority_score: 5,
  })
}

// ── STEP 3: Extract scoops from real news data ────────────────────────────────
interface GTMScoop {
  type: string; headline: string; detail: string
  why_it_matters: string; source: string; source_url: string; date: string
}

async function extractScoops(data: RawData, snapshot: Snapshot, salesDescription: string): Promise<GTMScoop[]> {
  const allNews = [data.funding, data.techcrunch, data.news].filter(Boolean).join('\n\n===\n\n')

  if (!allNews.trim() || allNews === 'No results found\n\nNo results found\n\nNo results found') {
    return []
  }

  const prompt = `Extract buying signals from this REAL news data about "${snapshot.name}".

Sales rep sells: "${salesDescription}"
Company stage: ${snapshot.stage}, Funding: ${snapshot.total_funding}

NEWS DATA (use exact details, URLs, and dates from these sources):
${allNews}

For each signal:
- Use the EXACT URL from the source data above
- Use the EXACT date from the source data
- Include specific details (amounts, names, percentages)
- Explain why it matters for the sales rep specifically

Return ONLY JSON array. Every entry MUST have a real source_url from the data above.
Return [] if no real news found with URLs.

[{
  "type": "funding|acquisition|layoff|leadership_change|product_launch|partnership|expansion|press",
  "headline": "specific headline with real details",
  "detail": "2-3 sentences with exact specifics (amounts, names, dates) from the article",
  "why_it_matters": "one sentence: why this creates a sales opportunity",
  "source": "publication name",
  "source_url": "exact URL from the data above — REQUIRED",
  "date": "exact date from the data"
}]`

  const raw = await claude(prompt, 1500, false)
  const scoops = parseJSON<GTMScoop[]>(raw, [])
  return scoops.filter(s => s.source_url && s.source_url.startsWith('http'))
}

// ── STEP 4: Generate insights ─────────────────────────────────────────────────
interface SalesInsights {
  why_relevant: string
  executive_summary: string
  pain_points: Array<{title: string; description: string; severity: 'high'|'medium'|'low'}>
  discovery_questions: string[]
  outreach_angles: Array<{title: string; description: string}>
  tech_stack_hints: Array<{category: string; tool: string; confidence: string; verified: boolean}>
  icp_fit_score: number
}

async function generateInsights(snapshot: Snapshot, scoops: GTMScoop[], data: RawData, salesDescription: string): Promise<SalesInsights> {
  const topScoops = scoops.slice(0,3).map(s => `[${s.type}] ${s.headline}: ${s.why_it_matters}`).join('\n')

  const prompt = `Senior sales strategist generating insights from verified company data.

SELLING: "${salesDescription}"

COMPANY:
${snapshot.name} | ${snapshot.category} | ${snapshot.stage} | ${snapshot.total_funding}
Employees: ${snapshot.employee_count} | HQ: ${snapshot.hq}
Description: ${snapshot.description}
ICP: ${snapshot.icp}

TOP SIGNALS:
${topScoops || 'None found yet'}

HIRING DATA:
${data.hiring}

Generate specific insights. Mention specific details from their data.
Return ONLY JSON:
{
  "why_relevant": "2 sentences specific to their stage/category/signals",
  "executive_summary": "3 sentences: what they do + current moment + opportunity",
  "pain_points": [{"title": "specific pain", "description": "evidence from their data", "severity": "high|medium|low"}],
  "discovery_questions": ["specific question referencing their actual situation"],
  "outreach_angles": [{"title": "angle", "description": "specific to their data"}],
  "tech_stack_hints": [{"category": "CRM|Analytics|Support|Marketing|Data", "tool": "tool name", "confidence": "high|medium|low", "verified": false}],
  "icp_fit_score": 7
}`

  const raw = await claude(prompt, 1200, false)
  return parseJSON<SalesInsights>(raw, {
    why_relevant: '', executive_summary: '', pain_points: [],
    discovery_questions: [], outreach_angles: [], tech_stack_hints: [], icp_fit_score: 5,
  })
}

// ── STEP 5: Write outreach ────────────────────────────────────────────────────
interface OutreachKit {
  cold_email: string; linkedin_message: string; call_script: string
  objections: Array<{objection: string; counter: string}>
}

async function writeOutreach(snapshot: Snapshot, scoops: GTMScoop[], insights: SalesInsights, salesDescription: string): Promise<OutreachKit> {
  const topScoop = scoops[0] ? `${scoops[0].headline} (${scoops[0].date})` : insights.why_relevant
  const angle = insights.outreach_angles[0] ? `${insights.outreach_angles[0].title}: ${insights.outreach_angles[0].description}` : insights.why_relevant

  const prompt = `Write personalized B2B sales outreach. Reference REAL signals below.

SELLING: "${salesDescription}"
TARGET: ${snapshot.name} — ${snapshot.category}, ${snapshot.stage}, ${snapshot.employee_count} employees, ${snapshot.hq}
DESCRIPTION: ${snapshot.description}

SIGNAL TO REFERENCE: ${topScoop}
ANGLE: ${angle}

Rules: specific signal reference, subject line <8 words, LinkedIn <60 words.
Return ONLY JSON:
{
  "cold_email": "Subject: [<8 words]\\n\\nHi [First Name],\\n\\n[2-3 sentences: signal + product fit + CTA]\\n\\n[Name]",
  "linkedin_message": "Hi [Name] — [max 60 words, one real signal, clear ask]",
  "call_script": "Hi [Name], [Rep] calling from [Co]. [One specific observation]. Quick question — [discovery question]?",
  "objections": [{"objection": "realistic objection", "counter": "specific counter"}]
}`

  const raw = await claude(prompt, 800, false)
  return parseJSON<OutreachKit>(raw, { cold_email: '', linkedin_message: '', call_script: '', objections: [] })
}

// ── STEP 6: Find contacts ─────────────────────────────────────────────────────
interface Contact {
  name: string; title: string; department: string
  linkedin_url: string|null; linkedin_verified: boolean
  email_guess: string; email_pattern: string
  email_confidence: 'high'|'medium'|'low'
  role_in_deal: 'champion'|'blocker'|'influencer'|'evaluator'
  outreach_message: string
}

async function findContacts(snapshot: Snapshot, insights: SalesInsights, salesDescription: string): Promise<Contact[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const [r1, r2] = await Promise.all([
    serper(`site:linkedin.com/in "${snapshot.name}" VP OR Head OR Director OR CRO OR CMO OR Chief`, 5),
    serper(`"${snapshot.name}" executive team leadership site:linkedin.com 2025`, 4),
  ])

  const found = [...r1, ...r2]
    .filter(r => r.link?.includes('linkedin.com/in/') && !r.link.includes('/in/search'))
    .map(r => ({
      name: r.title?.split(' - ')[0]?.replace(' | LinkedIn','')?.trim() || '',
      title: r.title?.split(' - ')[1]?.trim() || '',
      url: r.link,
    }))
    .filter(p => p.name.length > 2 && p.name.length < 50)
    .slice(0, 6)

  if (!found.length) return []

  const domain = snapshot.domain
  const contactList = found.map((p,i) => `${i+1}. ${p.name} — ${p.title}`).join('\n')

  const prompt = `Company: ${snapshot.name} (${snapshot.category}, ${snapshot.stage})
Domain: ${domain}
Rep sells: "${salesDescription}"
Key insight: ${insights.why_relevant}

Contacts found:
${contactList}

Assign role and write 3-line personalized message for each.
Return ONLY JSON array:
[{"name":"exact","title":"exact","department":"Sales|RevOps|CS|Product|Engineering|Finance|IT|Marketing|Executive","email_guess":"firstname@${domain}","email_pattern":"first@${domain}","email_confidence":"high|medium|low","role_in_deal":"champion|blocker|influencer|evaluator","outreach_message":"Hi [name], [3 lines specific to ${snapshot.name}]"}]`

  const raw = await claude(prompt, 800, false)
  const enriched = parseJSON<Array<Omit<Contact,'linkedin_url'|'linkedin_verified'>>>(raw, [])

  return Promise.all(enriched.slice(0,6).map(async (c,i) => {
    const fp = found[i]
    if (fp?.url?.includes('linkedin.com/in/')) {
      const slug = fp.url.split('linkedin.com/in/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase() || ''
      const parts = c.name.toLowerCase().split(' ')
      const score = (slug.includes(parts[0]?.slice(0,4)||'') ? 35 : 0) +
                    (slug.includes(parts[parts.length-1]?.slice(0,4)||'') ? 35 : 0)
      if (score >= 70) return { ...c, linkedin_url: fp.url.split('?')[0], linkedin_verified: true }
      if (score >= 35) return { ...c, linkedin_url: fp.url.split('?')[0], linkedin_verified: false }
    }
    const { url, verified } = await validateLinkedIn(c.name, snapshot.name, c.title)
    return { ...c, linkedin_url: url, linkedin_verified: verified }
  }))
}

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────────
export async function runFullResearch(companyName: string, salesDescription: string, targetIndustries: string[]) {
  try {
    console.log(`[${hasClaude() ? 'Claude' : 'Groq'}] Researching: ${companyName}`)

    // Step 1: fetch all data from sources (parallel Serper searches)
    const data = await fetchData(companyName)

    // Step 2: extract snapshot (structured facts only)
    const snapshot = await extractSnapshot(data)

    // Step 3: extract scoops from real news
    const scoops = await extractScoops(data, snapshot, salesDescription)

    // Step 4: generate insights
    const insights = await generateInsights(snapshot, scoops, data, salesDescription)

    // Steps 5+6 in parallel: outreach + contacts
    const [outreach, contacts] = await Promise.all([
      writeOutreach(snapshot, scoops, insights, salesDescription),
      findContacts(snapshot, insights, salesDescription),
    ])

    const techStack = insights.tech_stack_hints.map(t => ({
      category: t.category, tool: t.tool,
      confidence: t.confidence as 'high'|'medium'|'low',
      verified: t.verified, source: 'AI research',
    }))

    return {
      company: {
        name: snapshot.name || companyName,
        domain: snapshot.domain,
        industry: snapshot.industry,
        size: snapshot.employee_count,
        stage: snapshot.stage,
        hq: snapshot.hq,
        linkedin_url: snapshot.linkedin_url && snapshot.linkedin_url !== 'Unknown' ? snapshot.linkedin_url : null,
        description: snapshot.description,
        founded: snapshot.founded,
        total_funding: snapshot.total_funding,
        latest_round: snapshot.latest_round,
        investors: snapshot.investors,
        priority_score: insights.icp_fit_score || snapshot.priority_score,
      },
      executive_summary: insights.executive_summary || snapshot.description,
      business_model: snapshot.business_model,
      gtm_motion: `${snapshot.icp} — ${snapshot.business_model}`,
      why_relevant: insights.why_relevant,
      gtm_scoops: scoops,
      pain_points: insights.pain_points,
      tech_stack: techStack,
      buying_signals: scoops.map(s => ({ signal: s.headline, why_it_matters: s.why_it_matters, source: s.source, source_url: s.source_url, date: s.date })),
      discovery_questions: insights.discovery_questions,
      outreach_angles: insights.outreach_angles,
      cold_email: outreach.cold_email,
      linkedin_message: outreach.linkedin_message,
      call_script: outreach.call_script,
      objections: outreach.objections,
      contacts,
      recent_news: scoops.map(s => ({ title: s.headline, summary: s.detail, source_name: s.source, source_url: s.source_url, date: s.date, signal_type: s.type })),
      job_signals: [],
    }
  } catch (err) {
    console.error('Pipeline error:', err)
    return null
  }
}

// ── DISCOVER ──────────────────────────────────────────────────────────────────
export async function discoverCompanies(salesDescription: string, targetIndustries: string[], targetSizes: string[], icpNotes: string, count = 5): Promise<string[]> {
  const ind = targetIndustries.slice(0,2).join(' ')
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const [s1, s2, s3] = await Promise.all([
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `AI SaaS startup ${ind} funding raised 2025 2026`, num: 10, type: 'news' }) }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `AI-first ${ind} company product launch announcement 2025 2026`, num: 8, type: 'news' }) }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    fetch(SERPER_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: `best AI ${ind} startups 2025 raised series funding`, num: 8 }) }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  const skip = new Set(['techcrunch','crunchbase','linkedin','forbes','bloomberg','medium','github','reddit','g2','glassdoor','notion','google','microsoft','salesforce','hubspot'])
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
Pick ${count} best AI-first real B2B companies (not media/news sites):
${candidates.map((c,i) => `${i+1}. ${c}`).join('\n')}
Return ONLY JSON array: ["Company A","Company B"]`

  const raw = await claude(prompt, 200, false)
  return parseJSON<string[]>(raw, candidates.slice(0,count))
}

// ── SIGNAL REFRESH ────────────────────────────────────────────────────────────
export async function refreshSignals(companyName: string, domain: string, salesDescription: string, lastCheckedAt: string|null) {
  const since = lastCheckedAt ? `since ${new Date(lastCheckedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}` : 'in the last 7 days'
  const results = await serper(`"${companyName}" news funding acquisition layoff product launch ${since}`, 6, 'news')
  if (!results.length) return []

  const newsText = results.map(r => `TITLE: ${r.title}\nSNIPPET: ${r.snippet}\nURL: ${r.link}\nDATE: ${r.date||'recent'}\nSOURCE: ${r.source||''}`).join('\n\n---\n\n')

  const prompt = `Extract new signals ${since} for "${companyName}". Rep sells: "${salesDescription}".

NEWS DATA:
${newsText}

Return ONLY JSON array ([] if nothing genuinely new with URLs):
[{"signal_type":"funding|acquisition|layoff|leadership_change|product_launch|partnership|expansion|press|other","title":"headline","summary":"2 sentences + why it matters for sales","source_name":"pub","source_url":"exact URL from data","source_verified":true,"signal_date":"YYYY-MM-DD"}]`

  const raw = await claude(prompt, 800, false)
  return parseJSON<SignalResult[]>(raw, [])
}

export async function generateDigestSummary(salesDescription: string, signalsByProspect: Array<{company: string; signals: SignalResult[]}>) {
  const text = signalsByProspect.map(p => `${p.company}: ${p.signals.map(s => `[${s.signal_type}] ${s.title}`).join(', ')}`).join('\n')
  const prompt = `Coach for rep selling "${salesDescription}". Signals: ${text}. 3-4 sentence briefing: top signal, who to call first, why. Plain text.`
  return claude(prompt, 300, false)
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
