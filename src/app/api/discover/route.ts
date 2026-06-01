import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { runFullResearch } from '@/lib/research-engine'

export const maxDuration = 300

const SERPER_API = 'https://google.serper.dev/search'

async function serperSearch(query: string, num = 10): Promise<Array<{title: string; snippet: string; link: string}>> {
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

async function serperNews(query: string, num = 10): Promise<Array<{title: string; snippet: string; link: string}>> {
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
  try {
    const u = new URL(url)
    return u.hostname.replace('www.', '')
  } catch { return '' }
}

function cleanCompanyName(title: string, domain: string): string {
  // Remove common suffixes and clean up
  let name = title
    .replace(/\s*[-|–—]\s*.*/g, '')  // remove everything after dash
    .replace(/\s*(Inc|LLC|Ltd|Corp|Co|AG|GmbH)\.?$/gi, '')
    .replace(/\s*\|.*$/g, '')
    .replace(/\s*:.*$/g, '')
    .trim()

  // If title is too generic, use domain
  if (name.length < 2 || name.length > 40) {
    name = domain.split('.')[0]
    name = name.charAt(0).toUpperCase() + name.slice(1)
  }
  return name
}

interface DiscoveredCompany {
  name: string
  domain: string
  snippet: string
  source: string
  score: number
}

async function discoverFromSources(
  salesDescription: string,
  targetIndustries: string[],
  targetSizes: string[],
  icpNotes: string
): Promise<DiscoveredCompany[]> {

  const industryStr = targetIndustries.slice(0, 3).join(' OR ')
  const isEnterprise = targetSizes.some(s => s.includes('1000'))
  const isMid = targetSizes.some(s => s.includes('201') || s.includes('501'))
  const stageHint = isEnterprise ? 'Series C D growth' : isMid ? 'Series B C' : 'Series A B seed'

  // 10 targeted searches to find real companies
  const searches = await Promise.all([
    // Crunchbase searches
    serperSearch(`site:crunchbase.com/organization AI SaaS startup ${industryStr} ${stageHint} 2024 2025`, 10),
    serperSearch(`site:crunchbase.com/organization "artificial intelligence" "${targetIndustries[0] || 'SaaS'}" founded:2018..2024`, 10),

    // TechCrunch funding news
    serperNews(`site:techcrunch.com AI startup ${industryStr} funding raised Series 2025`, 10),
    serperNews(`techcrunch.com "${targetIndustries[0] || 'AI'}" startup raises million 2025`, 10),

    // Product Hunt AI companies
    serperSearch(`site:producthunt.com AI ${targetIndustries[0] || 'SaaS'} tool 2024 2025`, 10),

    // G2 category leaders
    serperSearch(`site:g2.com best AI ${targetIndustries[0] || 'sales'} software 2025`, 10),

    // LinkedIn company searches
    serperSearch(`site:linkedin.com/company AI-first ${industryStr} startup ${stageHint}`, 10),

    // Direct funding news
    serperNews(`AI ${industryStr} startup "Series ${isEnterprise ? 'C' : 'B'}" funding 2025`, 10),
    serperNews(`"raised" million AI SaaS ${targetIndustries[0] || ''} 2025 startup`, 10),

    // Specific ICP-based search using sales description keywords
    serperSearch(`AI startup company "${salesDescription.split(' ').slice(0, 5).join(' ')}" 2025`, 8),
  ])

  // Extract company candidates from all results
  const candidates = new Map<string, DiscoveredCompany>()
  const excludedDomains = new Set([
    'techcrunch.com', 'crunchbase.com', 'linkedin.com', 'producthunt.com',
    'g2.com', 'forbes.com', 'bloomberg.com', 'venturebeat.com', 'wired.com',
    'medium.com', 'github.com', 'twitter.com', 'x.com', 'facebook.com',
    'youtube.com', 'wikipedia.org', 'reddit.com', 'glassdoor.com',
    'indeed.com', 'angel.co', 'ycombinator.com', 'pitchbook.com',
  ])

  const sourceWeights: Record<number, {source: string; score: number}> = {
    0: { source: 'Crunchbase', score: 25 },
    1: { source: 'Crunchbase', score: 25 },
    2: { source: 'TechCrunch', score: 20 },
    3: { source: 'TechCrunch', score: 20 },
    4: { source: 'Product Hunt', score: 15 },
    5: { source: 'G2', score: 15 },
    6: { source: 'LinkedIn', score: 20 },
    7: { source: 'Funding News', score: 22 },
    8: { source: 'Funding News', score: 22 },
    9: { source: 'ICP Match', score: 30 },
  }

  searches.forEach((results, searchIndex) => {
    const { source, score: baseScore } = sourceWeights[searchIndex] || { source: 'Web', score: 10 }

    results.forEach(result => {
      const domain = extractDomain(result.link)
      if (!domain || excludedDomains.has(domain)) return
      if (domain.includes('crunchbase') || domain.includes('linkedin')) {
        // Extract company domain from Crunchbase/LinkedIn URLs
        const crunchSlug = result.link.match(/crunchbase\.com\/organization\/([^/]+)/)?.[1]
        if (crunchSlug) {
          const name = cleanCompanyName(result.title, crunchSlug)
          const key = crunchSlug
          const existing = candidates.get(key)
          const snippet = result.snippet || ''
          if (existing) {
            existing.score += baseScore
          } else {
            candidates.set(key, { name, domain: `${crunchSlug}.com`, snippet, source, score: baseScore })
          }
        }
        return
      }

      const name = cleanCompanyName(result.title, domain)
      if (!name || name.length < 2) return

      const existing = candidates.get(domain)
      if (existing) {
        existing.score += baseScore
        // Boost if snippet mentions relevant keywords
        const snippet = result.snippet.toLowerCase()
        const keywords = [...targetIndustries.map(i => i.toLowerCase()), 'ai', 'saas', 'startup', 'funding', 'series']
        keywords.forEach(kw => { if (snippet.includes(kw)) existing.score += 5 })
      } else {
        candidates.set(domain, {
          name, domain, snippet: result.snippet || '', source, score: baseScore,
        })
      }
    })
  })

  // Sort by score and return top candidates
  return Array.from(candidates.values())
    .filter(c => c.domain && !c.domain.includes('undefined'))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20) // top 20 for LLM to pick from
}

async function scoreAndSelectWithLLM(
  companies: DiscoveredCompany[],
  salesDescription: string,
  targetIndustries: string[],
  icpNotes: string,
  count: number
): Promise<Array<{name: string; domain: string}>> {
  const key = process.env.GROQ_API_KEY
  if (!key) return companies.slice(0, count).map(c => ({ name: c.name, domain: c.domain }))

  const companyList = companies.map((c, i) =>
    `${i + 1}. ${c.name} (${c.domain}) — ${c.snippet.slice(0, 120)}`
  ).join('\n')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `You are a GTM analyst scoring companies for sales prospecting.

Sales rep sells: "${salesDescription}"
Target industries: ${targetIndustries.join(', ')}
ICP notes: ${icpNotes || 'AI-first SaaS startups'}

Here are ${companies.length} discovered companies from Crunchbase, TechCrunch, and funding news:
${companyList}

Select the BEST ${count} companies that are:
1. AI-first or AI-native (not legacy software with AI added on)
2. Most likely to need what the sales rep sells
3. Have real buying signals (funding, growth, hiring)
4. Are actual companies (not news sites, aggregators, or platforms)

Return ONLY a JSON array with name and domain — no markdown, no explanation:
[{"name":"Actual Company Name","domain":"actualdomain.com"}]`
      }],
      max_tokens: 500,
      temperature: 0.1,
    }),
  })

  if (!res.ok) return companies.slice(0, count).map(c => ({ name: c.name, domain: c.domain }))
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content || ''

  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('no match')
    return JSON.parse(match[0])
  } catch {
    return companies.slice(0, count).map(c => ({ name: c.name, domain: c.domain }))
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile_id } = await req.json()
    if (!profile_id) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

    const db = createServerClient()
    const { data: profile } = await db.from('sales_profiles').select('*').eq('id', profile_id).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Step 1: discover from real sources
    const discovered = await discoverFromSources(
      profile.product_description,
      profile.target_industries || [],
      profile.target_company_sizes || [],
      profile.icp_notes || ''
    )

    if (!discovered.length) {
      return NextResponse.json({ error: 'No companies found from sources' }, { status: 500 })
    }

    // Step 2: LLM scores and selects best 5
    const selected = await scoreAndSelectWithLLM(
      discovered,
      profile.product_description,
      profile.target_industries || [],
      profile.icp_notes || '',
      5
    )

    if (!selected.length) {
      return NextResponse.json({ error: 'Could not select companies' }, { status: 500 })
    }

    // Step 3: full research for each
    const results = []
    for (const company of selected) {
      try {
        const research = await runFullResearch(
          company.name,
          profile.product_description,
          profile.target_industries || []
        )
        if (!research) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const co = (research as any).company || {}

        const { data: prospect } = await db.from('prospects').insert({
          profile_id,
          company_name: co.name || company.name,
          domain: co.domain || company.domain,
          industry: co.industry || null,
          size: co.size || null,
          stage: co.stage || null,
          hq: co.hq || null,
          linkedin_url: co.linkedin_url || null,
          description: co.description || null,
          priority_score: co.priority_score || 5,
          last_researched_at: new Date().toISOString(),
        }).select('id').single()

        if (!prospect) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = research as any

        await db.from('gtm_briefs').insert({
          prospect_id: prospect.id,
          executive_summary: r.executive_summary || null,
          business_model: r.business_model || null,
          gtm_motion: r.gtm_motion || null,
          pain_points: r.pain_points || [],
          tech_stack: r.tech_stack || [],
          buying_signals: r.buying_signals || [],
          discovery_questions: r.discovery_questions || [],
          outreach_angles: r.outreach_angles || [],
          cold_email: r.cold_email || null,
          linkedin_message: r.linkedin_message || null,
          call_script: r.call_script || null,
          objections: r.objections || [],
          raw_response: JSON.stringify(r.gtm_scoops || []),
        })

        if (Array.isArray(r.contacts) && r.contacts.length > 0) {
          await db.from('contacts').insert(
            r.contacts.map((c: Record<string, unknown>) => ({
              prospect_id: prospect.id,
              name: c.name, title: c.title || null, department: c.department || null,
              linkedin_url: c.linkedin_url || null,
              linkedin_verified: c.linkedin_verified || false,
              email_guess: c.email_guess || null, email_pattern: c.email_pattern || null,
              email_confidence: c.email_confidence || 'low',
              role_in_deal: c.role_in_deal || null,
              outreach_message: c.outreach_message || null,
            }))
          )
        }

        if (Array.isArray(r.gtm_scoops) && r.gtm_scoops.length > 0) {
          await db.from('signals').insert(
            r.gtm_scoops.map((s: Record<string, unknown>) => ({
              prospect_id: prospect.id,
              signal_type: s.type || 'other',
              title: s.headline || s.title,
              summary: `${s.detail || s.summary || ''} | Why it matters: ${s.why_it_matters || ''}`,
              source_name: s.source || null,
              source_url: s.source_url || null,
              source_verified: true,
              is_new: true,
              signal_date: s.date || null,
            }))
          )
        }

        if (Array.isArray(r.recent_news) && r.recent_news.length > 0) {
          await db.from('signals').insert(
            r.recent_news.map((n: Record<string, unknown>) => ({
              prospect_id: prospect.id,
              signal_type: n.signal_type || 'other',
              title: n.title, summary: n.summary,
              source_name: n.source_name || n.source || null,
              source_url: n.source_url || null,
              source_verified: true, is_new: true, signal_date: n.date || null,
            }))
          )
        }

        results.push({ company: company.name, domain: company.domain, prospect_id: prospect.id })
        await new Promise(r => setTimeout(r, 800))
      } catch (e) { console.error(`Failed: ${company.name}`, e) }
    }

    return NextResponse.json({
      success: true,
      discovered_count: discovered.length,
      companies: results,
    })
  } catch (err) {
    console.error('Discover error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
