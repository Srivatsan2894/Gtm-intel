import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const maxDuration = 60

const SERPER_API = 'https://google.serper.dev/search'
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

async function callAI(prompt: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey && anthropicKey.startsWith('sk-ant')) {
    try {
      const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (res.ok) {
        const d = await res.json()
        return d.content?.[0]?.text || ''
      }
    } catch { /* fall through */ }
  }
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey) return ''
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.1,
    }),
  })
  if (!res.ok) return ''
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

// Strict list of well-known large companies to exclude
const EXCLUDE_COMPANIES = new Set([
  'salesforce','hubspot','microsoft','google','apple','amazon','meta','netflix',
  'oracle','sap','adobe','workday','servicenow','zendesk','slack','zoom',
  'dropbox','stripe','shopify','atlassian','twilio','datadog','snowflake',
  'databricks','palantir','splunk','crowdstrike','okta','docusign','veeva',
  'zoominfo','outreach','salesloft','gong','seismic','highspot','drift',
])

function isValidStartup(name: string, domain: string): boolean {
  if (!name || name.length < 2 || name.length > 50) return false
  const lower = name.toLowerCase()
  if (EXCLUDE_COMPANIES.has(lower)) return false
  if (!domain || domain.length < 4) return false
  return true
}

export async function POST(req: NextRequest) {
  try {
    const { profile_id } = await req.json()
    if (!profile_id) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

    const db = createServerClient()
    const { data: profile } = await db.from('sales_profiles').select('*').eq('id', profile_id).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const industries = (profile.target_industries || []).slice(0, 2).join(' ')
    const sizes = profile.target_company_sizes || []
    const stage = sizes.some((s: string) => s.includes('1000')) ? 'Series C D growth'
      : sizes.some((s: string) => s.includes('501')) ? 'Series B C'
      : 'Series A B'

    const serperKey = process.env.SERPER_API_KEY
    if (!serperKey) return NextResponse.json({ error: 'SERPER_API_KEY not configured' }, { status: 500 })

    // Strategy: search specifically for STARTUPS that raised funding
    // These searches return the startup as the subject, not a big company
    const searches = await Promise.all([
      fetch(SERPER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
        body: JSON.stringify({
          q: `${industries} AI startup raises Series ${stage.split(' ')[1]} million 2025`,
          num: 8, type: 'news',
        }),
      }).then(r => r.json()).then(d => d.news || []).catch(() => []),

      fetch(SERPER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
        body: JSON.stringify({
          q: `${industries} AI company raises funding 2025 site:techcrunch.com`,
          num: 8, type: 'news',
        }),
      }).then(r => r.json()).then(d => d.news || []).catch(() => []),

      fetch(SERPER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
        body: JSON.stringify({
          q: `AI ${industries} startup ${stage} funding round 2025 techcrunch`,
          num: 8, type: 'news',
        }),
      }).then(r => r.json()).then(d => d.news || []).catch(() => []),

      fetch(SERPER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
        body: JSON.stringify({
          q: `new AI ${industries} SaaS company launched product 2025`,
          num: 8, type: 'news',
        }),
      }).then(r => r.json()).then(d => d.news || []).catch(() => []),
    ])

    const allResults = searches.flat()

    // Build structured candidate list with name + domain + context
    const seen = new Set<string>()
    const candidates: Array<{name: string; domain: string; context: string}> = []

    const skipDomains = new Set([
      'techcrunch.com','crunchbase.com','linkedin.com','forbes.com','bloomberg.com',
      'venturebeat.com','wired.com','medium.com','github.com','twitter.com','x.com',
      'facebook.com','youtube.com','wikipedia.org','reddit.com','glassdoor.com',
      'businesswire.com','prnewswire.com','reuters.com','wsj.com','ft.com',
      'nytimes.com','theverge.com','inc.com','entrepreneur.com','pitchbook.com',
    ])

    for (const r of allResults) {
      let domain = ''
      try { domain = new URL(r.link).hostname.replace('www.', '') } catch { continue }
      if (skipDomains.has(domain)) continue
      if (seen.has(domain)) continue
      seen.add(domain)

      // Extract company name more carefully
      // For news about "Company raises $X" - the company name is the subject
      let name = r.title
        .replace(/\s+raises\s+.*/i, '')
        .replace(/\s+secured?\s+.*/i, '')
        .replace(/\s+closes?\s+.*/i, '')
        .replace(/\s+launches?\s+.*/i, '')
        .replace(/\s+announces?\s+.*/i, '')
        .replace(/\s+acquires?\s+.*/i, '')
        .replace(/\s+[-–—|:]\s+.*/g, '')
        .replace(/\s*(Inc|LLC|Ltd|Corp|Co|AG)\.?$/gi, '')
        .trim()

      if (!isValidStartup(name, domain)) continue
      if (name.split(' ').length > 5) continue // too many words = not a company name

      candidates.push({
        name,
        domain,
        context: r.snippet?.slice(0, 100) || '',
      })

      if (candidates.length >= 15) break
    }

    if (!candidates.length) {
      return NextResponse.json({
        error: 'No companies found. Try updating your target industries.',
        debug: { results: allResults.length }
      }, { status: 500 })
    }

    // Use AI to pick the 5 best — it sees name + domain + context
    const candidateList = candidates.map((c, i) =>
      `${i + 1}. ${c.name} (${c.domain}) — "${c.context}"`
    ).join('\n')

    const prompt = `A sales rep sells: "${profile.product_description.slice(0, 200)}"
Target: ${industries} companies, ${stage} stage
ICP: ${profile.icp_notes || 'AI-first SaaS startups'}

These are REAL companies found from funding news. Pick the 5 BEST prospects:
${candidateList}

Rules:
- Only pick actual B2B software/AI companies (not agencies, consulting firms, or consumer apps)
- Company name must match what's in the list exactly
- Domain must match the company

Return ONLY JSON array with exact name and domain from the list above:
[{"name":"ExactNameFromList","domain":"exact-domain.com"}]`

    const raw = await callAI(prompt)
    let selected = parseJSON<Array<{name: string; domain: string}>>(raw, [])

    // Validate selected against candidates
    selected = selected
      .filter(s => candidates.some(c => c.domain === s.domain))
      .slice(0, 5)

    // Fallback if AI picks invalid entries
    if (selected.length < 3) {
      selected = candidates.slice(0, 5).map(c => ({ name: c.name, domain: c.domain }))
    }

    // Save as pending prospects
    const saved = []
    for (const company of selected) {
      const { data: existing } = await db.from('prospects')
        .select('id').eq('profile_id', profile_id).eq('company_name', company.name).single()

      if (existing) {
        saved.push({ ...company, prospect_id: existing.id, status: 'existing' })
        continue
      }

      const { data: prospect } = await db.from('prospects').insert({
        profile_id,
        company_name: company.name,
        domain: company.domain,
        priority_score: 5,
        status: 'active',
      }).select('id').single()

      if (prospect) saved.push({ ...company, prospect_id: prospect.id, status: 'pending' })
    }

    return NextResponse.json({
      success: true,
      total_discovered: candidates.length,
      companies: saved,
    })

  } catch (err) {
    console.error('Discover error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
