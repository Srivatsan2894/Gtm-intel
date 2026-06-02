/**
 * GTM Intel Research Engine v8
 * 4-step structured AI pipeline — AI only sees clean JSON, never raw web text
 *
 * Step 1: fetchCompanyData() — parallel source fetching (no AI)
 * Step 2: extractSnapshot()  — facts only (temp 0)
 * Step 3: generateInsights() — sales analysis (temp 0.2)
 * Step 4: writeOutreach()    — personalized copy (temp 0.3)
 * Step 5: findContacts()     — LinkedIn validated contacts
 */

import { fetchCompanyData, type RawCompanyData, type TechTool, type JobSignal } from './data-layer'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

async function groq(prompt: string, maxTokens = 1000, temp = 0.1): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not configured')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: temp,
    }),
  })
  if (!res.ok) { const e = await res.text(); throw new Error(`Groq ${res.status}: ${e}`) }
  const d = await res.json()
  return d.choices?.[0]?.message?.content || ''
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const clean = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()
    const m = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!m) return fallback
    return JSON.parse(m[0])
  } catch { return fallback }
}

// ── LinkedIn validator ────────────────────────────────────────────────────────
async function validateLinkedIn(name: string, company: string, title: string): Promise<{url:string|null;verified:boolean}> {
  const key = process.env.SERPER_API_KEY
  if (!key) return { url: null, verified: false }
  const parts = name.toLowerCase().split(' ').filter(p => p.length > 1)
  const first = parts[0] || ''
  const last = parts[parts.length-1] || ''
  for (const q of [
    `site:linkedin.com/in "${name}" "${company}"`,
    `site:linkedin.com/in "${first} ${last}" "${company}" "${title.split(' ').slice(0,3).join(' ')}"`,
  ]) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
        body: JSON.stringify({ q, num: 3 }),
      })
      const data = await res.json()
      for (const r of (data.organic || [])) {
        if (!r.link?.includes('linkedin.com/in/')) continue
        if (r.link.includes('/in/search')) continue
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

// ── STEP 2: Extract snapshot (temp 0 — facts only) ────────────────────────────
interface Snapshot {
  name: string; domain: string; industry: string; category: string
  hq: string; founded: string; employee_count: string; stage: string
  total_funding: string; latest_round: string; investors: string
  description: string; linkedin_url: string; website: string
  icp: string; business_model: string; priority_score: number
}

async function extractSnapshot(data: RawCompanyData): Promise<Snapshot> {
  const prompt = `Extract ONLY explicitly stated facts. Use "Unknown" if not found. No inference.

Company: "${data.companyName}"

CRUNCHBASE: ${data.crunchbaseSnippet}
FUNDING NEWS: ${data.fundingData}
WEBSITE: ${data.websiteData}
LINKEDIN: ${data.linkedinData}
LinkedIn URL: ${data.linkedinCompanyUrl || 'not found'}
Crunchbase URL: ${data.crunchbaseUrl || 'not found'}

Return ONLY JSON:
{"name":"${data.companyName}","domain":"${data.domain}","industry":"from sources","category":"specific product category","hq":"city, country","founded":"year","employee_count":"count or range","stage":"Seed|Series A|Series B|Series C|Growth|Public|Unknown","total_funding":"amount","latest_round":"round+amount+date","investors":"names","description":"2 sentences from website","linkedin_url":"${data.linkedinCompanyUrl||''}","website":"${data.domain}","icp":"who they sell to","business_model":"SaaS|Usage-based|Enterprise|Unknown","priority_score":7}`

  const raw = await groq(prompt, 600, 0.0)
  return parseJSON<Snapshot>(raw, {
    name: data.companyName, domain: data.domain, industry: 'Unknown', category: 'Unknown',
    hq: 'Unknown', founded: 'Unknown', employee_count: 'Unknown', stage: 'Unknown',
    total_funding: 'Unknown', latest_round: 'Unknown', investors: 'Unknown',
    description: '', linkedin_url: data.linkedinCompanyUrl || '', website: data.domain,
    icp: 'Unknown', business_model: 'Unknown', priority_score: 5,
  })
}

// ── STEP 3: Generate scoops from structured news (temp 0.1) ───────────────────
interface GTMScoop {
  type: string; headline: string; detail: string
  why_it_matters: string; source: string; source_url: string; date: string
}

async function generateScoops(snapshot: Snapshot, data: RawCompanyData, salesDescription: string): Promise<GTMScoop[]> {
  if (!data.news.length && !data.jobSignals.length) return []

  const newsText = data.news.slice(0, 10).map(n =>
    `[${n.type.toUpperCase()}] "${n.title}" — ${n.snippet} | Source: ${n.source} | Date: ${n.date} | URL: ${n.url}`
  ).join('\n')

  const jobText = data.jobSignals.slice(0, 4).map(j =>
    `[HIRING] ${j.title} | Tools: ${j.tools_mentioned.join(', ')} | Signals: ${j.signals.join(', ')}`
  ).join('\n')

  const prompt = `You are a sales signal analyst. Extract buying signals from REAL news data below.

Sales rep sells: "${salesDescription}"
Company: ${snapshot.name} (${snapshot.category}, ${snapshot.stage})

REAL NEWS DATA — extract signals from these exact articles:
${newsText || 'No news found'}

HIRING SIGNALS:
${jobText || 'No hiring data found'}

RULES:
- Use ONLY information explicitly in the data above
- source_url MUST be the exact URL from the data (the link after "Source:")
- source MUST be the publication name from the data
- date MUST be the exact date from the data
- headline must reference specific facts (amounts, names, dates)
- detail must contain specifics (e.g. "$38M Series B led by GV" not "raised funding")

Return ONLY JSON array ([] if no real signals with URLs):
[{
  "type": "funding|acquisition|layoff|leadership_change|hiring_spike|product_launch|expansion|partnership|press",
  "headline": "specific headline with exact details from source",
  "detail": "2-3 sentences with exact specifics (amounts, names, dates) from the article",
  "summary": "one sentence plain summary of what happened",
  "why_it_matters": "one sentence: specific buying opportunity for this sales rep",
  "source": "exact publication name from data",
  "source_url": "exact URL from the data — REQUIRED",
  "date": "exact date from data"
}]
Max 8 scoops. Every scoop MUST have a source_url.`

  const raw = await groq(prompt, 1500, 0.1)
  return parseJSON<GTMScoop[]>(raw, [])
}

// ── STEP 3b: Generate sales insights (temp 0.2) ───────────────────────────────
interface SalesInsights {
  why_relevant: string
  executive_summary: string
  pain_points: Array<{title:string;description:string;severity:'high'|'medium'|'low'}>
  discovery_questions: string[]
  outreach_angles: Array<{title:string;description:string}>
  icp_fit_score: number
  icp_fit_reasoning: string
}

async function generateInsights(
  snapshot: Snapshot,
  techByCategory: Record<string, string[]>,
  scoops: GTMScoop[],
  jobSignals: JobSignal[],
  salesDescription: string
): Promise<SalesInsights> {
  const techText = Object.entries(techByCategory)
    .map(([cat, tools]) => `${cat}: ${tools.join(', ')}`).join('\n') || 'No BuiltWith data'

  const allJobTools = jobSignals.flatMap(j => j.tools_mentioned)
  const uniqueJobTools = allJobTools.filter((t, i) => allJobTools.indexOf(t) === i)

  const topScoops = scoops.slice(0, 4).map(s => `[${s.type}] ${s.headline}: ${s.why_it_matters}`).join('\n')

  const prompt = `Sales strategist generating insights from STRUCTURED company data.

SELLING: "${salesDescription}"

COMPANY SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

VERIFIED TECH STACK (BuiltWith):
${techText}

TOOLS IN JOB POSTINGS:
${uniqueJobTools.join(', ') || 'None found'}

TOP SIGNALS:
${topScoops || 'No signals yet'}

Generate insights based on this specific data. Return ONLY JSON:
{
  "why_relevant": "2 specific sentences on why THIS company needs what the rep sells, based on their actual stage/tech/signals",
  "executive_summary": "3 sentences: what they do + their current moment + the sales opportunity",
  "pain_points": [{"title":"specific pain from their data","description":"evidence from tech stack or signals","severity":"high|medium|low"}],
  "discovery_questions": ["question referencing something specific from their stack or news"],
  "outreach_angles": [{"title":"angle","description":"specific angle from their actual data"}],
  "icp_fit_score": 7,
  "icp_fit_reasoning": "specific reasoning based on their actual data"
}`

  const raw = await groq(prompt, 1200, 0.2)
  return parseJSON<SalesInsights>(raw, {
    why_relevant:'', executive_summary:'', pain_points:[],
    discovery_questions:[], outreach_angles:[], icp_fit_score:5, icp_fit_reasoning:'',
  })
}

// ── STEP 4: Write outreach (temp 0.3) ─────────────────────────────────────────
interface OutreachKit {
  cold_email: string; linkedin_message: string; call_script: string
  objections: Array<{objection:string;counter:string}>
}

async function writeOutreach(snapshot: Snapshot, scoops: GTMScoop[], insights: SalesInsights, salesDescription: string): Promise<OutreachKit> {
  const topScoop = scoops[0] ? `${scoops[0].headline} (${scoops[0].date}) — ${scoops[0].why_it_matters}` : insights.why_relevant
  const angle = insights.outreach_angles[0] ? `${insights.outreach_angles[0].title}: ${insights.outreach_angles[0].description}` : ''

  const prompt = `Expert SDR writing outreach. Be specific — reference REAL signals below.

SELLING: "${salesDescription}"
TARGET: ${snapshot.name} — ${snapshot.description}
STAGE: ${snapshot.stage} | EMPLOYEES: ${snapshot.employee_count} | HQ: ${snapshot.hq}

TOP SIGNAL TO REFERENCE:
${topScoop}

ANGLE:
${angle || insights.why_relevant}

Rules: reference a specific real signal. No generic phrases. Subject line under 8 words.
Return ONLY JSON:
{
  "cold_email": "Subject: [under 8 words]\\n\\nHi [First Name],\\n\\n[2-3 sentences: specific signal + how product helps + CTA]\\n\\n[Name]",
  "linkedin_message": "Hi [Name] — [50 words max, one specific observation, clear ask]",
  "call_script": "Hi [Name], [Rep] from [Company]. [One specific observation]. Quick question — [discovery question]?",
  "objections": [{"objection":"likely objection","counter":"specific counter using their data"}]
}`

  const raw = await groq(prompt, 800, 0.3)
  return parseJSON<OutreachKit>(raw, { cold_email:'', linkedin_message:'', call_script:'', objections:[] })
}

// ── STEP 5: Find and validate contacts ────────────────────────────────────────
interface Contact {
  name:string; title:string; department:string
  linkedin_url:string|null; linkedin_verified:boolean
  email_guess:string; email_pattern:string; email_confidence:'high'|'medium'|'low'
  role_in_deal:'champion'|'blocker'|'influencer'|'evaluator'
  outreach_message:string
}

async function findContacts(snapshot: Snapshot, insights: SalesInsights, salesDescription: string): Promise<Contact[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const [r1, r2] = await Promise.all([
    fetch('https://google.serper.dev/search', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-API-KEY':key},
      body: JSON.stringify({ q: `site:linkedin.com/in "${snapshot.name}" VP OR Head OR Director OR CRO OR CMO OR "Chief"`, num: 5 }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
    fetch('https://google.serper.dev/search', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-API-KEY':key},
      body: JSON.stringify({ q: `"${snapshot.name}" leadership team executives 2025 site:linkedin.com`, num: 5 }),
    }).then(r => r.json()).then(d => d.organic || []).catch(() => []),
  ])

  const found = [...r1, ...r2]
    .filter((r: {link:string}) => r.link?.includes('linkedin.com/in/') && !r.link.includes('/in/search'))
    .map((r: {title:string;snippet:string;link:string}) => ({
      name: r.title?.split(' - ')[0]?.replace(' | LinkedIn','')?.trim() || '',
      title: r.title?.split(' - ')[1]?.trim() || '',
      url: r.link,
      snippet: r.snippet || '',
    }))
    .filter(p => p.name.length > 2 && p.name.length < 50)
    .slice(0, 6)

  if (!found.length) return []

  const domain = snapshot.domain
  const contactList = found.map((p,i) => `${i+1}. ${p.name} — ${p.title}`).join('\n')

  const prompt = `Company: ${snapshot.name} (${snapshot.category}, ${snapshot.stage}, ${snapshot.employee_count} employees)
Domain: ${domain}
Rep sells: "${salesDescription}"
Insight: ${insights.why_relevant}

Contacts found:
${contactList}

Assign role and write 3-line personalized message for each.
Return ONLY JSON array:
[{"name":"exact","title":"exact","department":"Sales|RevOps|CS|Product|Engineering|Finance|IT|Marketing|Executive","email_guess":"firstname@${domain}","email_pattern":"first@${domain}","email_confidence":"high|medium|low","role_in_deal":"champion|blocker|influencer|evaluator","outreach_message":"Hi [name], 3 lines referencing ${snapshot.name} insight"}]`

  const raw = await groq(prompt, 800, 0.2)
  const enriched = parseJSON<Array<Omit<Contact,'linkedin_url'|'linkedin_verified'>>>(raw, [])

  const validated = await Promise.all(
    enriched.slice(0, 6).map(async (c, i) => {
      const foundPerson = found[i]
      if (foundPerson?.url?.includes('linkedin.com/in/')) {
        const slug = foundPerson.url.split('linkedin.com/in/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase() || ''
        const parts = c.name.toLowerCase().split(' ')
        const score = (slug.includes(parts[0]?.slice(0,4)||'') ? 35 : 0) +
                      (slug.includes(parts[parts.length-1]?.slice(0,4)||'') ? 35 : 0)
        if (score >= 70) return { ...c, linkedin_url: foundPerson.url.split('?')[0], linkedin_verified: true }
        if (score >= 35) return { ...c, linkedin_url: foundPerson.url.split('?')[0], linkedin_verified: false }
      }
      const { url, verified } = await validateLinkedIn(c.name, snapshot.name, c.title)
      return { ...c, linkedin_url: url, linkedin_verified: verified }
    })
  )

  return validated
}

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────────
export async function runFullResearch(companyName: string, salesDescription: string, targetIndustries: string[]) {
  try {
    // Step 1: Fetch all data (no AI)
    const data = await fetchCompanyData(companyName)

    // Step 2: Extract facts (temp 0)
    const snapshot = await extractSnapshot(data)

    // Steps 3+3b+4: Run scoops, insights, contacts in parallel then outreach
    const [scoops, insights] = await Promise.all([
      generateScoops(snapshot, data, salesDescription),
      generateInsights(snapshot, data.techByCategory, [], data.jobSignals, salesDescription),
    ])

    const [outreach, contacts] = await Promise.all([
      writeOutreach(snapshot, scoops, insights, salesDescription),
      findContacts(snapshot, insights, salesDescription),
    ])

    // Build tech_stack for display
    const techStackDisplay = Object.entries(data.techByCategory).length > 0
      ? Object.entries(data.techByCategory).map(([cat, tools]) => ({
          category: cat, tool: tools.join(', '), confidence: 'high' as const,
          verified: true, source: 'BuiltWith',
        }))
      : data.jobSignals.flatMap(j => j.tools_mentioned)
          .filter((t, i, arr) => arr.indexOf(t) === i)
          .map(t => ({ category: 'Job postings', tool: t, confidence: 'medium' as const, verified: false, source: 'Hiring data' }))

    // All signals merged — AI scoops first, then raw news as fallback
    const aiScoopUrls = new Set(scoops.map(s => s.source_url).filter(Boolean))
    const allScoops = [
      ...scoops,
      // Add raw news items not already covered by AI scoops
      ...data.news
        .filter(n => !aiScoopUrls.has(n.url) && !scoops.some(s => s.headline.toLowerCase().includes(n.title.slice(0,25).toLowerCase())))
        .map(n => ({
          type: n.type,
          headline: n.title,
          detail: n.snippet,
          summary: n.snippet,
          why_it_matters: '',
          source: n.source,
          source_url: n.url,
          date: n.date,
        })),
    ].filter(s => s.source_url) // only show scoops with real source URLs
    .slice(0, 12)

    return {
      company: {
        name: snapshot.name || companyName,
        domain: snapshot.domain,
        industry: snapshot.industry,
        size: snapshot.employee_count,
        stage: snapshot.stage,
        hq: snapshot.hq,
        linkedin_url: snapshot.linkedin_url,
        description: snapshot.description,
        founded: snapshot.founded,
        total_funding: snapshot.total_funding,
        latest_round: snapshot.latest_round,
        investors: snapshot.investors,
        priority_score: insights.icp_fit_score || snapshot.priority_score,
        icp_fit_reasoning: insights.icp_fit_reasoning,
        crunchbase_url: data.crunchbaseUrl,
      },
      executive_summary: insights.executive_summary || snapshot.description,
      business_model: snapshot.business_model,
      gtm_motion: `${snapshot.icp} — ${snapshot.business_model}`,
      why_relevant: insights.why_relevant,
      gtm_scoops: allScoops,
      pain_points: insights.pain_points,
      tech_stack: techStackDisplay,
      buying_signals: scoops.map(s => ({ signal: s.headline, why_it_matters: s.why_it_matters, source: s.source, source_url: s.source_url, date: s.date })),
      discovery_questions: insights.discovery_questions,
      outreach_angles: insights.outreach_angles,
      cold_email: outreach.cold_email,
      linkedin_message: outreach.linkedin_message,
      call_script: outreach.call_script,
      objections: outreach.objections,
      contacts,
      recent_news: data.news.map(n => ({
        title: n.title, summary: n.snippet, source_name: n.source,
        source_url: n.url, date: n.date, signal_type: n.type,
      })),
      job_signals: data.jobSignals,
    }
  } catch (err) {
    console.error('Research pipeline error:', err)
    return null
  }
}

// ── DISCOVER ──────────────────────────────────────────────────────────────────
export async function discoverCompanies(salesDescription: string, targetIndustries: string[], targetSizes: string[], icpNotes: string, count = 5): Promise<string[]> {
  const ind = targetIndustries.slice(0,2).join(' ')
  const key = process.env.SERPER_API_KEY
  if (!key) return []

  const [s1, s2, s3] = await Promise.all([
    fetch('https://google.serper.dev/search', { method:'POST', headers:{'Content-Type':'application/json','X-API-KEY':key}, body: JSON.stringify({q:`AI SaaS startup ${ind} funding raised 2025 2026`,num:10,type:'news'}) }).then(r=>r.json()).then(d=>d.news||[]).catch(()=>[]),
    fetch('https://google.serper.dev/search', { method:'POST', headers:{'Content-Type':'application/json','X-API-KEY':key}, body: JSON.stringify({q:`AI-first ${ind} company product launch 2025`,num:8,type:'news'}) }).then(r=>r.json()).then(d=>d.news||[]).catch(()=>[]),
    fetch('https://google.serper.dev/search', { method:'POST', headers:{'Content-Type':'application/json','X-API-KEY':key}, body: JSON.stringify({q:`top AI ${ind} startups raised funding 2025`,num:8}) }).then(r=>r.json()).then(d=>d.organic||[]).catch(()=>[]),
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

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) return candidates.slice(0, count)

  const res = await fetch(GROQ_API, {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${groqKey}`},
    body: JSON.stringify({
      model:'llama-3.3-70b-versatile',
      messages:[{role:'user',content:`Rep sells: "${salesDescription.slice(0,150)}" to ${ind}. ICP: ${icpNotes||'AI-first SaaS'}
Pick ${count} best AI-first companies (not media/aggregators/agencies):
${candidates.map((c,i)=>`${i+1}. ${c}`).join('\n')}
Return ONLY: ["Company A","Company B"]`}],
      max_tokens:150, temperature:0.0,
    }),
  })
  const d = await res.json()
  return parseJSON<string[]>(d.choices?.[0]?.message?.content||'', candidates.slice(0,count))
}

// ── SIGNAL REFRESH ────────────────────────────────────────────────────────────
export async function refreshSignals(companyName: string, domain: string, salesDescription: string, lastCheckedAt: string|null) {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  const since = lastCheckedAt ? `since ${new Date(lastCheckedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}` : 'in the last 7 days'
  const [news, funding] = await Promise.all([
    fetch('https://google.serper.dev/search',{method:'POST',headers:{'Content-Type':'application/json','X-API-KEY':key},body:JSON.stringify({q:`"${companyName}" news ${since}`,num:5,type:'news'})}).then(r=>r.json()).then(d=>d.news||[]).catch(()=>[]),
    fetch('https://google.serper.dev/search',{method:'POST',headers:{'Content-Type':'application/json','X-API-KEY':key},body:JSON.stringify({q:`"${companyName}" funding raised acquisition ${since}`,num:4,type:'news'})}).then(r=>r.json()).then(d=>d.news||[]).catch(()=>[]),
  ])
  const combined = [...news,...funding].map((n:{title:string;snippet:string;link:string;date?:string;source?:string}) => `[${n.title}] ${n.snippet} (${n.source||''}, ${n.date||''}, ${n.link})`).join('\n')
  if (!combined.trim()) return []
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) return []
  const res = await fetch(GROQ_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${groqKey}`},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:`Rep sells: "${salesDescription}". Extract new signals ${since} for "${companyName}" from: ${combined}\nReturn ONLY JSON array: [{"signal_type":"funding|hiring|product_launch|leadership_change|acquisition|layoff|expansion|press|other","title":"headline","summary":"2 sentences + why it matters for sales","source_name":"pub","source_url":"url","source_verified":true,"signal_date":"YYYY-MM-DD"}]\nReturn [] if nothing new.`}],max_tokens:800,temperature:0.0})})
  const d = await res.json()
  return parseJSON<SignalResult[]>(d.choices?.[0]?.message?.content||'', [])
}

export async function generateDigestSummary(salesDescription: string, signalsByProspect: Array<{company:string;signals:SignalResult[]}>) {
  const key = process.env.GROQ_API_KEY
  if (!key) return ''
  const text = signalsByProspect.map(p => `${p.company}: ${p.signals.map(s=>`[${s.signal_type}] ${s.title}`).join(', ')}`).join('\n')
  const res = await fetch(GROQ_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:`Coach for rep selling "${salesDescription}". Signals: ${text}. 3-4 sentence briefing: top signal, who to call first, why. Plain text.`}],max_tokens:200,temperature:0.2})})
  const d = await res.json()
  return d.choices?.[0]?.message?.content || ''
}

export interface SignalResult {
  signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean; signal_date: string
}
