import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { runFullResearch } from '@/lib/research-engine'

export const maxDuration = 120

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { company_name, profile_id, prospect_id: existingProspectId } = body

    if (!company_name || !profile_id) {
      return NextResponse.json({ error: 'company_name and profile_id required' }, { status: 400 })
    }

    const db = createServerClient()

    const { data: profile, error: profileError } = await db
      .from('sales_profiles').select('*').eq('id', profile_id).single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const research: Any = await runFullResearch(
      company_name,
      profile.product_description,
      profile.target_industries || []
    )

    if (!research) {
      return NextResponse.json({ error: 'Research failed — try again' }, { status: 500 })
    }

    const co = research.company || {}
    let prospectId: string | null = existingProspectId || null

    if (prospectId) {
      // Update the pending prospect created by discover
      await db.from('prospects').update({
        company_name: co.name || company_name,
        domain: co.domain || null,
        industry: co.industry || null,
        size: co.size || null,
        stage: co.stage || null,
        hq: co.hq || null,
        linkedin_url: co.linkedin_url || null,
        description: co.description || null,
        priority_score: co.priority_score || 5,
        last_researched_at: new Date().toISOString(),
      }).eq('id', prospectId)
    } else {
      // Manual search — upsert
      const { data: upserted } = await db.from('prospects').upsert({
        profile_id,
        company_name: co.name || company_name,
        domain: co.domain || null,
        industry: co.industry || null,
        size: co.size || null,
        stage: co.stage || null,
        hq: co.hq || null,
        linkedin_url: co.linkedin_url || null,
        description: co.description || null,
        priority_score: co.priority_score || 5,
        last_researched_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,company_name', ignoreDuplicates: false })
        .select('id').single()

      if (upserted) {
        prospectId = upserted.id
      } else {
        const { data: inserted } = await db.from('prospects').insert({
          profile_id,
          company_name: co.name || company_name,
          domain: co.domain || null, industry: co.industry || null,
          size: co.size || null, stage: co.stage || null,
          hq: co.hq || null, linkedin_url: co.linkedin_url || null,
          description: co.description || null,
          priority_score: co.priority_score || 5,
          last_researched_at: new Date().toISOString(),
        }).select('id').single()
        if (inserted) prospectId = inserted.id
      }
    }

    if (!prospectId) {
      return NextResponse.json({ error: 'Failed to save prospect' }, { status: 500 })
    }

    // Save GTM brief
    await db.from('gtm_briefs').upsert({
      prospect_id: prospectId,
      executive_summary: research.executive_summary || null,
      business_model: research.business_model || null,
      gtm_motion: research.gtm_motion || null,
      pain_points: research.pain_points || [],
      tech_stack: research.tech_stack || [],
      buying_signals: research.buying_signals || [],
      discovery_questions: research.discovery_questions || [],
      outreach_angles: research.outreach_angles || [],
      cold_email: research.cold_email || null,
      linkedin_message: research.linkedin_message || null,
      call_script: research.call_script || null,
      objections: research.objections || [],
      raw_response: JSON.stringify({ scoops: research.gtm_scoops || [], job_signals: research.job_signals || [] }),
    }, { onConflict: 'prospect_id' })

    // Save contacts
    if (Array.isArray(research.contacts) && research.contacts.length > 0) {
      await db.from('contacts').delete().eq('prospect_id', prospectId)
      await db.from('contacts').insert(
        research.contacts.map((c: Any) => ({
          prospect_id: prospectId,
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

    // Save GTM scoops as signals
    const scoops = Array.isArray(research.gtm_scoops) ? research.gtm_scoops : []
    const news = Array.isArray(research.recent_news) ? research.recent_news : []
    const allSignals = [...scoops.map((s: Any) => ({
      signal_type: s.type || 'other',
      title: s.headline || s.title,
      summary: `${s.detail || ''} ${s.why_it_matters ? '| Why it matters: ' + s.why_it_matters : ''}`.trim(),
      source_name: s.source || null,
      source_url: s.source_url || null,
      signal_date: s.date || null,
    })), ...news.map((n: Any) => ({
      signal_type: n.signal_type || 'other',
      title: n.title, summary: n.summary,
      source_name: n.source_name || n.source || null,
      source_url: n.source_url || null,
      signal_date: n.date || null,
    }))]

    if (allSignals.length > 0) {
      await db.from('signals').delete().eq('prospect_id', prospectId)
      await db.from('signals').insert(
        allSignals.map(s => ({
          prospect_id: prospectId, ...s,
          source_verified: true, is_new: true,
        }))
      )
    }

    return NextResponse.json({ success: true, prospect_id: prospectId, research })

  } catch (err) {
    console.error('Research error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
