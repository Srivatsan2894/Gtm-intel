import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tiauzbhbrkowupqmlaho.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpYXV6Ymhicmtvd3VwcW1sYWhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjkxNDEsImV4cCI6MjA5NTg0NTE0MX0.N4cAPz5IZ9hi0pVVXO_dArbi8bHlqGpEx46hKeYUPhw'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpYXV6Ymhicmtvd3VwcW1sYWhvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDI2OTE0MSwiZXhwIjoyMDk1ODQ1MTQxfQ.TmhzRJsvnpwBPT2FZHcevdwmSxZVP6Ny81oXaPzf6Zw'

export function createServerClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  })
}

export function createBrowserClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}
