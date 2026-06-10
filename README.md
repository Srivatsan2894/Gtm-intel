# Why Now — The GTM Search Engine

Paste a target account's URL and what you sell. Get the account's strategic
priorities and pressures, recent verifiable market signals translated into
pitch angles, and ready-to-send plays for SDR, AE, and CSM — all from live
web research at query time. **No database. No Apollo, Clay, or ZoomInfo needed.**

## Architecture

- **Stateless answer engine** — every query triggers live retrieval (Serper)
  + AI curation (provider waterfall). Nothing is stored, so there is no data
  pipeline to maintain and no stale data.
- **Evidence-grounded generation** — the model may only cite from retrieved
  search results, referenced by id. Real source URLs are attached in code,
  never written by the model. Hallucinated links are structurally impossible.
- **Provider waterfall** — Groq (Llama 3.3 70B) → Gemini 2.5 Flash → DeepSeek,
  all via OpenAI-compatible APIs. Falls through on rate limits. Stacked free
  tiers cover thousands of runs/day at $0 LLM cost.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your keys — never commit this file
npm run dev
```

Required: `SERPER_API_KEY` (serper.dev) and at least one LLM key
(`GROQ_API_KEY` recommended first).

Test the API directly:

```bash
curl -X POST localhost:3000/api/engine \
  -H "Content-Type: application/json" \
  -d '{"mode":"target","url":"freshworks.com","selling":"AI sales intelligence for SMB teams"}'
```

## Roadmap

- [x] Target-account mode (profile → signals → plays)
- [ ] Seller mode (your ICP → market scoops → why-now accounts)
- [ ] Territory mode (paste your account list → ranked by live signals)
- [ ] Signal search (query the market like a search engine)
- [ ] Meeting prep briefs
- [ ] Per-IP rate limiting (Upstash) before public launch
- [ ] Weekly signal monitoring (paid tier)

Built by [Sri](https://www.linkedin.com/) — 7+ years in B2B SaaS presales
(Zoho, Freshworks, ZoomInfo).
