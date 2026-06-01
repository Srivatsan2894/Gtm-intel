import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  const db = createServerClient()

  if (email) {
    const { data, error } = await db
      .from('sales_profiles')
      .select('*')
      .eq('email', email)
      .single()

    if (error) return NextResponse.json({ profile: null })
    return NextResponse.json({ profile: data })
  }

  const { data, error } = await db.from('sales_profiles').select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profiles: data })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const db = createServerClient()

  const { data, error } = await db
    .from('sales_profiles')
    .upsert(body, { onConflict: 'email' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}
