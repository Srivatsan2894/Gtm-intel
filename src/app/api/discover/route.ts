import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const maxDuration = 60

const SERPER_API = 'https://google.serper.dev/search'
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

async function serperSearch(query: string, num = 8): Promise<Array<{title: string; snippet: string; link: string}>> {
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

async function serperNews(query: string, num = 8): Promise<Array<{title: string; snippet: string; link: string}>> {
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

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', '') } catch { return '' }
}

const EXCLUDED = new Set([
  'techcrunch.com','crunchbase.com','linkedin.com','producthunt.com','g2.com',
  'forbes.com','bloomberg.com','venturebeat.com','wired.com','medium.com',
  'github.com','twitter.com','x.com','facebook.com','youtube.com',
  'wikipedia.org','reddit.com','glassdoor.com','indeed.com','angel.co',
  'ycombinator.com','pitchbook.com','techfundingnews.com','sifted.eu',
  'businesswire.com','prnewswire.com','globenewswire.com',
])

export async function POST(req: NextRequest) {
  try {
    const { profile_id } = await req.json()
    if (!profile_id) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

    const db = createServerClient()
    const { data: profile } = await db.from('sales_profiles').select('*').eq('id', profile_id).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const industries = (profile.target_industries || []).slice(0, 3).join(' ')
    const sizes = profile.target_company_sizes || []
    const stage = sizes.some((s: string) => s.includes('1000')) ? 'Series C D' :
                  sizes.some((s: string) => s.includes('201') || s.includes('501')) ? 'Series B C' : 'Series A B'

    // Run 6 fast parallel searches — names only, no full research
    const [s1, s2, s3, s4, s5, s6] = await Promise.all([
      serperNews(`AI SaaS startup ${industries} "Series ${stage.split(' ')[1]}" funding raised 2025`, 10),
      serperNews(`AI-first ${industries} company funding round 2025 2026`, 10),
      serperSearch(`site:crunchbase.com/organization AI ${industries} startup ${stage}`, 8),
      serperNews(`${profile.product_description.split(' ').slice(0, 6).join(' ')} startup funding 2025`, 8),
      serperSearch(`top AI ${industries} startups "raised" million 2025`, 8),
      serperNews(`artificial intelligence ${industries} "Series B" OR "Series C" startup 2025 2026`, 8),
    ])

    // Score and extract companies
    const scores = new Map<string, { name: string; domain: string; score: number; snippet: string }>()

    const allResults = [...s1, ...s2, ...s3, ...s4, ...s5, ...s6]

    for (const r of allResults) {
      const domain = extractDomain(r.link)
      if (!domain || EXCLUDED.has(domain)) continue

      // Extract company name from title
      let name = r.title
        .replace(/\s*[-|–—|:]\s*.*/g, '')
        .replace(/\s*(Inc|LLC|Ltd|Corp|Co|AG)\.?$/gi, '')
        .trim()
      if (name.length < 2 || name.length > 50) {
        name = domain.split('.')[0]
        name = name.charAt(0).toUpperCase() + name.slice(1)
      }

      const existing = scores.get(domain)
      const snippetLower = r.snippet?.toLowerCase() || ''
      const boost = ['ai', 'artificial intelligence', 'machine learning', 'saas', 'series', 'funding', 'raised']
        .filter(k => snippetLower.includes(k)).length * 3

      if (existing) {
        existing.score += 10 + boost
      } else {
        scores.set(domain, { name, domain, score: 10 + boost, snippet: r.snippet || '' })
      }
    }

    const candidates = Array.from(scores.values())
      .filter(c => !c.domain.includes('undefined'))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)

    if (!candidates.length) {
      return NextResponse.json({ error: 'No companies found' }, { status: 500 })
    }

    // Ask Groq to pick best 5 from the scored list — fast single call
    const groqKey = process.env.GROQ_API_KEY
    let selected: Array<{ name: string; domain: string }> = candidates.slice(0, 5).map(c => ({ name: c.name, domain: c.domain }))

    if (groqKey) {
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
            content: `Sales rep sells: "${profile.product_description.slice(0, 200)}"
Target industries: ${industries}
ICP: ${profile.icp_notes || 'AI-first SaaS startups'}

Pick the best 5 from these discovered companies that are:
- AI-first or AI-native SaaS companies (not media sites, aggregators, agencies)
- Most likely to need what the sales rep sells
- Real companies with actual products

${list}

Return ONLY JSON array, no markdown:
[{"name":"Company Name","domain":"domain.com"}]`
          }],
          max_tokens: 300,
          temperature: 0.1,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const raw = data.choices?.[0]?.message?.content || ''
        try {
          const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          const match = clean.match(/\[[\s\S]*\]/)
          if (match) selected = JSON.parse(match[0]).slice(0, 5)
        } catch { /* use fallback */ }
      }
    }

    // Save as pending prospects (no research yet — dashboard will trigger research per company)
    const saved = []
    for (const company of selected) {
      const { data: existing } = await db.from('prospects')
        .select('id').eq('profile_id', profile_id).eq('company_name', company.name).single()
      if (existing) { saved.push({ ...company, prospect_id: existing.id, status: 'existing' }); continue }

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
