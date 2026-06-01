# GTM Intel — Sales Intelligence Platform

AI-powered prospect research, contact discovery, and daily signal alerts for B2B sales teams.

## What it does

- **Company Research** — input any company name, get a full GTM brief: pain points, tech stack, buying signals, outreach angles
- **Contact Discovery** — finds key stakeholders with verified LinkedIn URLs and guessed emails (with confidence scores)
- **Daily Signal Engine** — monitors your tracked accounts for new funding, hiring, product launches, and press coverage
- **Email Digest** — sends a daily briefing to your inbox every morning at 7am (only if there are new signals)

## Tech Stack

- **Frontend** — Next.js 14 (App Router), Tailwind CSS
- **Backend** — Next.js API Routes + Vercel Cron
- **Database** — Supabase (PostgreSQL)
- **AI** — Anthropic Claude Sonnet + web_search tool (verified sources only)
- **Email** — Resend (free: 3,000 emails/month)

---

## Setup Guide

### Step 1 — Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/gtm-intel.git
cd gtm-intel
npm install
```

### Step 2 — Set up Supabase

1. Go to [supabase.com](https://supabase.com) and open your project (or create a new one)
2. Open the **SQL Editor**
3. Copy and paste the contents of `supabase/migrations/001_initial_schema.sql`
4. Click **Run**
5. Go to **Settings → API** and copy:
   - Project URL
   - `anon` public key
   - `service_role` secret key

### Step 3 — Set up Resend (free email)

1. Go to [resend.com](https://resend.com) and create a free account
2. Create an API key
3. Add and verify your sending domain (or use their shared domain for testing)

### Step 4 — Environment variables

Copy `.env.local.example` to `.env.local` and fill in all values:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

ANTHROPIC_API_KEY=sk-ant-...

RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=digest@yourdomain.com

CRON_SECRET=any-random-string-you-choose
NEXT_PUBLIC_APP_URL=https://gtm-intel.vercel.app
```

### Step 5 — Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be taken through setup.

### Step 6 — Deploy to Vercel

```bash
# Push to GitHub first
git add .
git commit -m "Initial commit"
git push origin main
```

Then in Vercel:
1. Import your GitHub repo
2. Add all environment variables from `.env.local` in **Project Settings → Environment Variables**
3. Deploy

The Vercel Cron in `vercel.json` runs `GET /api/cron/daily-refresh` every day at 7:00 AM UTC.

---

## How to manually trigger the daily digest

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-app.vercel.app/api/cron/daily-refresh
```

---

## Email disclaimer

All emails include a clear disclaimer that:
- LinkedIn URLs for contacts are AI-inferred and should be verified
- Emails are pattern-guessed, not verified — always check at email-checker.net before sending
- Sources are filtered to verified publications only

---

## Notes on verified sources

The research engine instructs Claude to only cite:
- Official company newsrooms and press releases
- LinkedIn (company pages and public profiles)
- Crunchbase, PitchBook
- TechCrunch, Reuters, Bloomberg, Forbes, WSJ
- SEC / regulatory filings
- G2, Glassdoor
- Official job boards (Greenhouse, Lever, Workday, Ashby)
- GitHub (for tech signals)

Reddit, anonymous blogs, forums, and unverifiable sources are explicitly excluded.

---

## Adding Resend later

If you don't have Resend yet, the app still works — research and contact discovery work without it. The daily cron will run and store signals in Supabase, but won't send emails until `RESEND_API_KEY` is configured.
