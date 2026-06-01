import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get('profile_id')
  if (!profileId) return NextResponse.json({ error: 'profile_id required' }, { status: 400 })

  const db = createServerClient()

  const { data, error } = await db
    .from('prospects')
    .select(`
      *,
      contacts (*),
      signals (*, created_at),
      gtm_briefs (*)
    `)
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .order('priority_score', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prospects: data })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = createServerClient()
  const { error } = await db
    .from('prospects')
    .update({ status: 'archived' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
