import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { discoverCompanies, runFullResearch } from '@/lib/research-engine'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const { profile_id } = await req.json()
    if (!profile_id) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

    const db = createServerClient()
    const { data: profile } = await db.from('sales_profiles').select('*').eq('id', profile_id).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const companies = await discoverCompanies(
      profile.product_description,
      profile.target_industries || [],
      profile.target_company_sizes || [],
      profile.icp_notes || '',
      5
    )

    if (!companies.length) return NextResponse.json({ error: 'Could not identify target companies' }, { status: 500 })

    const results = []
    for (const companyName of companies) {
      try {
        const research = await runFullResearch(companyName, profile.product_description, profile.target_industries || [])
        if (!research) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const co = (research as any).company || {}
        const { data: prospect } = await db.from('prospects').insert({
          profile_id,
          company_name: co.name || companyName,
          domain: co.domain || null,
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
        })
        if (Array.isArray(r.contacts) && r.contacts.length > 0) {
          await db.from('contacts').insert(r.contacts.map((c: Record<string, unknown>) => ({
            prospect_id: prospect.id,
            name: c.name, title: c.title || null, department: c.department || null,
            linkedin_url: c.linkedin_url || null, linkedin_verified: c.linkedin_verified || false,
            email_guess: c.email_guess || null, email_pattern: c.email_pattern || null,
            email_confidence: c.email_confidence || 'low', role_in_deal: c.role_in_deal || null,
            outreach_message: c.outreach_message || null,
          })))
        }
        if (Array.isArray(r.recent_news) && r.recent_news.length > 0) {
          await db.from('signals').insert(r.recent_news.map((n: Record<string, unknown>) => ({
            prospect_id: prospect.id,
            signal_type: n.signal_type || 'other', title: n.title, summary: n.summary,
            source_name: n.source_name || n.source || null, source_url: n.source_url || null,
            source_verified: true, is_new: true, signal_date: n.date || null,
          })))
        }
        results.push({ company: companyName, prospect_id: prospect.id })
        await new Promise(r => setTimeout(r, 500))
      } catch (e) { console.error(`Failed: ${companyName}`, e) }
    }
    return NextResponse.json({ success: true, companies: results })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
