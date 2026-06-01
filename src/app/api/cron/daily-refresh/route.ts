import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { refreshSignals, generateDigestSummary, SignalResult } from '@/lib/research-engine'
import { sendDigestEmail } from '@/lib/email'
import { format } from 'date-fns'

export const maxDuration = 300 // 5 min for full cron run

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel cron or manually with secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServerClient()
  const today = format(new Date(), 'MMMM d, yyyy')
  const results: Record<string, unknown>[] = []

  try {
    // Get all active sales profiles that have notifications enabled
    const { data: profiles } = await db
      .from('sales_profiles')
      .select('*')
      .eq('notify_daily', true)

    if (!profiles?.length) {
      return NextResponse.json({ message: 'No active profiles' })
    }

    for (const profile of profiles) {
      // Get active prospects for this profile
      const { data: prospects } = await db
        .from('prospects')
        .select('*')
        .eq('profile_id', profile.id)
        .eq('status', 'active')

      if (!prospects?.length) continue

      const allNewSignals: Array<{ company: string; signals: unknown[] }> = []

      // Refresh signals for each prospect
      for (const prospect of prospects) {
        const newSignals = await refreshSignals(
          prospect.company_name,
          prospect.domain || '',
          profile.product_description,
          prospect.last_researched_at
        )

        if (newSignals.length > 0) {
          // Save new signals to DB
          await db.from('signals').insert(
            newSignals.map(s => ({
              prospect_id: prospect.id,
              signal_type: s.signal_type,
              title: s.title,
              summary: s.summary,
              source_name: s.source_name,
              source_url: s.source_url,
              source_verified: s.source_verified,
              is_new: true,
              signal_date: s.signal_date,
            }))
          )

          // Update last researched timestamp
          await db
            .from('prospects')
            .update({ last_researched_at: new Date().toISOString() })
            .eq('id', prospect.id)

          allNewSignals.push({
            company: prospect.company_name,
            signals: newSignals,
          })
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 1000))
      }

      // Only send email if there are new signals
      if (allNewSignals.length > 0) {
        const aiSummary = await generateDigestSummary(
          profile.product_description,
          allNewSignals as Array<{ company: string; signals: SignalResult[] }>
        )

        const flatSignals = allNewSignals.flatMap(p =>
          (p.signals as Array<{ signal_type: string; title: string; summary: string; source_name: string; source_url: string; signal_date: string }>).map(s => ({
            company: p.company as string,
            ...s,
          }))
        )

        if (process.env.RESEND_API_KEY) {
          await sendDigestEmail({
            repName: profile.name,
            repEmail: profile.email,
            salesDescription: profile.product_description,
            date: today,
            aiSummary,
            signals: flatSignals,
            appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://gtm-intel.vercel.app',
          })
        }

        // Log the digest
        await db.from('digest_log').insert({
          profile_id: profile.id,
          signal_count: flatSignals.length,
          prospect_count: allNewSignals.length,
          status: 'sent',
        })

        results.push({
          profile: profile.email,
          signals_sent: flatSignals.length,
          prospects: allNewSignals.length,
        })
      }
    }

    return NextResponse.json({
      success: true,
      date: today,
      profiles_processed: profiles.length,
      results,
    })

  } catch (err) {
    console.error('Cron error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
