-- GTM Intel — Full Schema
-- Run this in Supabase SQL Editor

-- ── Sales Profiles ──────────────────────────────────────────────────────────
-- One profile per sales team / rep describing what they sell
create table if not exists sales_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  company_name text,
  product_description text not null,
  target_industries text[] default '{}',
  target_company_sizes text[] default '{}',
  icp_notes text,
  notify_daily boolean default true,
  notify_time text default '07:00',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Prospects ────────────────────────────────────────────────────────────────
-- Target companies being tracked
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references sales_profiles(id) on delete cascade,
  company_name text not null,
  domain text,
  industry text,
  size text,
  stage text,
  hq text,
  linkedin_url text,
  description text,
  priority_score integer default 5,
  status text default 'active' check (status in ('active', 'paused', 'archived')),
  last_researched_at timestamptz,
  created_at timestamptz default now()
);

-- ── Contacts ─────────────────────────────────────────────────────────────────
-- Stakeholders at prospect companies
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references prospects(id) on delete cascade,
  name text not null,
  title text,
  department text,
  linkedin_url text,
  linkedin_verified boolean default false,
  email_guess text,
  email_pattern text,
  email_confidence text check (email_confidence in ('high', 'medium', 'low')),
  role_in_deal text check (role_in_deal in ('champion', 'blocker', 'influencer', 'evaluator')),
  outreach_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Signals ──────────────────────────────────────────────────────────────────
-- News and buying signals per prospect
create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references prospects(id) on delete cascade,
  signal_type text not null check (signal_type in (
    'funding', 'hiring', 'product_launch', 'leadership_change',
    'expansion', 'partnership', 'press', 'financial', 'competitive', 'other'
  )),
  title text not null,
  summary text not null,
  source_name text,
  source_url text,
  source_verified boolean default false,
  is_new boolean default true,
  signal_date date,
  created_at timestamptz default now()
);

-- ── GTM Briefs ───────────────────────────────────────────────────────────────
-- Full research output stored per prospect
create table if not exists gtm_briefs (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references prospects(id) on delete cascade,
  executive_summary text,
  business_model text,
  gtm_motion text,
  pain_points jsonb default '[]',
  tech_stack jsonb default '[]',
  buying_signals jsonb default '[]',
  discovery_questions jsonb default '[]',
  outreach_angles jsonb default '[]',
  cold_email text,
  linkedin_message text,
  call_script text,
  objections jsonb default '[]',
  raw_response text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Digest Log ───────────────────────────────────────────────────────────────
-- Track what was sent in each daily email
create table if not exists digest_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references sales_profiles(id) on delete cascade,
  sent_at timestamptz default now(),
  signal_count integer default 0,
  prospect_count integer default 0,
  email_preview text,
  status text default 'sent' check (status in ('sent', 'failed', 'skipped'))
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_prospects_profile on prospects(profile_id);
create index if not exists idx_contacts_prospect on contacts(prospect_id);
create index if not exists idx_signals_prospect on signals(prospect_id);
create index if not exists idx_signals_new on signals(is_new) where is_new = true;
create index if not exists idx_gtm_briefs_prospect on gtm_briefs(prospect_id);
create index if not exists idx_digest_profile on digest_log(profile_id);

-- ── Updated At Trigger ───────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger sales_profiles_updated_at
  before update on sales_profiles
  for each row execute function update_updated_at();

create trigger contacts_updated_at
  before update on contacts
  for each row execute function update_updated_at();

create trigger gtm_briefs_updated_at
  before update on gtm_briefs
  for each row execute function update_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table sales_profiles enable row level security;
alter table prospects enable row level security;
alter table contacts enable row level security;
alter table signals enable row level security;
alter table gtm_briefs enable row level security;
alter table digest_log enable row level security;

-- For now: service role has full access (API routes use service role key)
-- When you add auth, replace these with user-scoped policies

create policy "service_role_all" on sales_profiles for all using (true);
create policy "service_role_all" on prospects for all using (true);
create policy "service_role_all" on contacts for all using (true);
create policy "service_role_all" on signals for all using (true);
create policy "service_role_all" on gtm_briefs for all using (true);
create policy "service_role_all" on digest_log for all using (true);
