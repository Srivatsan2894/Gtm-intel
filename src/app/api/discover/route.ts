import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const maxDuration = 60

const SERPER_API = 'https://google.serper.dev/search'
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

async function search(query: string, num = 8, type = 'search'): Promise<Array<{title: string; snippet: string; link: string}>> {
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

// Domains that are aggregators/media — not actual companies
const SKIP_DOMAINS = [
  'techcrunch','crunchbase','linkedin','producthunt','g2','forbes','bloomberg',
  'venturebeat','wired','medium','github','twitter','x.com','facebook','youtube',
  'wikipedia','reddit','glassdoor','indeed','angellist','ycombinator','pitchbook',
  'businesswire','prnewswire','globenewswire','techfundingnews','sifted',
  'wsj','ft.com','reuters','nytimes','theverge','zdnet','cnet','mashable',
  'businessinsider','inc.com','entrepreneur','hbr.org','harvard','stanford',
  'notion','google','microsoft','apple','amazon','meta','netflix','salesforce',
  'hubspot','slack','zoom','dropbox','stripe','shopify','atlassian',
]

function isRealCompany(domain: string): boolean {
  if (!domain || domain.length < 4) return false
  const base = domain.split('.')[0].toLowerCase()
  return !SKIP_DOMAINS.some(s => base.includes(s) || domain.includes(s))
}

function extractName(title: string, domain: string): string {
  // Try to get company name from title
  let name = title
    .replace(/\s*[-–—|:]\s*.*/g, '')  // remove after dash/colon
    .replace(/\s*(raises|raised|secures|closes|announces|launches|unveils).*/gi, '')
    .replace(/\s*(Inc|LLC|Ltd|Corp|Co|AG|GmbH|SAS)\.?$/gi, '')
    .replace(/['"]/g, '')
    .trim()

  // If name is too long or too short, use domain
  if (name.length < 2 || name.length > 45) {
    const domainName = domain.split('.')[0]
    name = domainName.charAt(0).toUpperCase() + domainName.slice(1)
  }
  return name
}

export async function POST(req: NextRequest) {
  try {
    const { profile_id } = await req.json()
    if (!profile_id) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

    const db = createServerClient()
    const { data: profile } = await db.from('sales_profiles').select('*').eq('id', profile_id).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const industries = (profile.target_industries || ['B2B SaaS']).slice(0, 2).join(' ')
    // Extract key words from product description for more relevant searches
    const descWords = profile.product_description
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(' ')
      .filter((w: string) => w.length > 4 && !['sells','sell','helps','using','their','about','with','that','this','have'].includes(w))
      .slice(0, 4)
      .join(' ')

    // 6 diverse searches — broader queries, no quoted phrases
    const [s1, s2, s3, s4, s5, s6] = await Promise.all([
      // Recent funded AI companies in target space
      search(`AI startup ${industries} funding raised million 2025`, 10, 'news'),
      // Product description based search
      search(`${descWords} AI SaaS company 2025`, 8, 'news'),
      // Growing AI companies
      search(`fastest growing AI ${industries} companies 2025 2026`, 8),
      // TechCrunch style funding news
      search(`${industries} AI company series funding 2025 techcrunch`, 8, 'news'),
      // Specific product category searches
      search(`best AI ${industries} software tools 2025 startup`, 8),
      // Crunchbase style
      search(`site:crunchbase.com ${industries} AI startup 2024 2025`, 8),
    ])

    // Score every result
    const scoreMap: Record<string, { name: string; domain: string; score: number; snippet: string }> = {}
    const allResults = [...s1, ...s2, ...s3, ...s4, ...s5, ...s6]

    for (const r of allResults) {
      let domain = ''
      try { domain = new URL(r.link).hostname.replace('www.', '') } catch { continue }

      // For Crunchbase results, extract the company slug as a pseudo-domain
      if (domain.includes('crunchbase.com')) {
        const slug = r.link.match(/crunchbase\.com\/organization\/([^/?]+)/)?.[1]
        if (slug) {
          const key = `cb_${slug}`
          const name = extractName(r.title, slug)
          if (!scoreMap[key]) scoreMap[key] = { name, domain: `${slug}.com`, score: 0, snippet: r.snippet || '' }
          scoreMap[key].score += 20
        }
        continue
      }

      if (!isRealCompany(domain)) continue

      const key = domain
      const name = extractName(r.title, domain)
      const snippet = (r.snippet || '').toLowerCase()

      // Base score
      let score = 10
      // Boost for relevant keywords in snippet
      const boostWords = ['ai', 'artificial intelligence', 'machine learning', 'saas', 'platform',
                         'startup', 'series', 'funding', 'raised', 'launch', 'growth', ...descWords.split(' ')]
      score += boostWords.filter(w => w && snippet.includes(w)).length * 3

      if (scoreMap[key]) {
        scoreMap[key].score += score
      } else {
        scoreMap[key] = { name, domain, score, snippet: r.snippet || '' }
      }
    }

    // Sort by score, take top 15
    const candidates = Object.values(scoreMap)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)

    if (!candidates.length) {
      return NextResponse.json({
        error: 'No companies found from search results. Try updating your product description or target industries.',
        debug: { searches_ran: 6, total_results: allResults.length }
      }, { status: 500 })
    }

    // Use Groq to pick the 5 best matches
    let selected = candidates.slice(0, 5).map(c => ({ name: c.name, domain: c.domain }))

    const groqKey = process.env.GROQ_API_KEY
    if (groqKey && candidates.length > 5) {
      try {
        const list = candidates.map((c, i) =>
          `${i + 1}. ${c.name} (${c.domain}) — ${c.snippet.slice(0, 100)}`
        ).join('\n')

        const res = await fetch(GROQ_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{
              role: 'user',
              content: `A sales rep sells: "${profile.product_description.slice(0, 200)}"
Target industries: ${industries}

From these discovered companies, pick the 5 BEST prospects:
${list}

Only pick real B2B software/AI companies (not media, agencies, or marketplaces).
Return ONLY JSON array: [{"name":"Company","domain":"domain.com"}]`
            }],
            max_tokens: 250,
            temperature: 0.1,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          const raw = data.choices?.[0]?.message?.content || ''
          const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          const match = clean.match(/\[[\s\S]*\]/)
          if (match) {
            const parsed = JSON.parse(match[0])
            if (Array.isArray(parsed) && parsed.length > 0) selected = parsed.slice(0, 5)
          }
        }
      } catch (e) { console.error('Groq selection failed:', e) }
    }

    // Save as pending prospects — research runs separately per company
    const saved = []
    for (const company of selected) {
      // Check if already exists
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
