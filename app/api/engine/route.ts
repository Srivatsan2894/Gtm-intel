// app/api/engine/route.ts
// WHY NOW — GTM Search Engine, production pipeline
// Stack: Groq (Llama 3.3 70B) + Serper.dev — costs well under 1 cent per full run.
//
// .env.local:
//   GROQ_API_KEY=...     (rotate your old key before using)
//   SERPER_API_KEY=...
//
// POST /api/engine
//   { mode: "target",  url: "freshworks.com", selling: "what you sell" }
//   { mode: "seller",  url: "yourco.com", hint?: "..." }            // port pattern below
//
// Design principle: the CODE decides what to search; the MODEL only curates
// what was retrieved. The model is forbidden from using outside knowledge for
// facts, which kills fabrication and lets us attach real URLs to every signal.

import { NextResponse } from "next/server";

const SERPER_URL = "https://google.serper.dev/search";

// ---------------------------------------------------------- LLM providers ----
// All OpenAI-compatible. The engine tries them in order and falls through on
// rate limits or errors — stacking free tiers gives ~17K free requests/day
// (Groq 1K RPD on 70B + Gemini Flash 1.5K RPD + DeepSeek's cheap floor).
// Set only the keys you have; missing ones are skipped automatically.
//
// .env.local:
//   GROQ_API_KEY=...       (free: llama-3.3-70b, 30 RPM / 1,000 RPD)
//   GEMINI_API_KEY=...     (free: 2.5 Flash, 1,500 RPD — note: free tier may
//                           use prompts for training; fine for public-web data)
//   DEEPSEEK_API_KEY=...   (5M signup tokens, then ~$0.14/M — best reasoning,
//                           use as the quality fallback)

const PROVIDERS = [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    keyEnv: "GROQ_API_KEY",
  },
  {
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    keyEnv: "GEMINI_API_KEY",
  },
  {
    name: "deepseek",
    url: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
    keyEnv: "DEEPSEEK_API_KEY",
  },
] as const;

// ---------------------------------------------------------------- serper ----

type Hit = { title: string; snippet: string; link: string; date?: string };

async function serper(q: string, num = 6, tbs?: string): Promise<Hit[]> {
  const res = await fetch(SERPER_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    // tbs=qdr:m2 → past 2 months. Recency enforced at retrieval, not by trust.
    body: JSON.stringify({ q, num, ...(tbs ? { tbs } : {}) }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const organic = (data.organic || []) as any[];
  const news = (data.news || []) as any[];
  return [...organic, ...news].slice(0, num).map((r) => ({
    title: r.title || "",
    snippet: r.snippet || r.description || "",
    link: r.link || "",
    date: r.date || "",
  }));
}

// Evidence block the model is allowed to cite from — with stable ids so the
// model returns "E3" and we re-attach the real URL ourselves. The model never
// writes URLs; we do. Zero hallucinated links.
function evidenceBlock(hits: Hit[]) {
  const ids = hits.map((h, i) => ({ id: `E${i + 1}`, ...h }));
  const text = ids
    .map((h) => `[${h.id}] ${h.title} — ${h.snippet}${h.date ? ` (${h.date})` : ""}`)
    .join("\n");
  return { ids, text };
}

function attachUrls<T extends { evidenceId?: string }>(items: T[], ids: { id: string; link: string }[]) {
  const map = Object.fromEntries(ids.map((h) => [h.id, h.link]));
  return items.map((it) => ({ ...it, sourceUrl: it.evidenceId ? map[it.evidenceId] || null : null }));
}

// ------------------------------------------------------------------- llm ----

async function llmJSON(system: string, user: string): Promise<any> {
  let lastErr: any = null;
  for (const p of PROVIDERS) {
    const key = process.env[p.keyEnv];
    if (!key) continue; // provider not configured — skip
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: p.model,
          temperature: 0.3, // curation, not creativity
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        // rate-limited or provider down — fall through to the next free tier
        lastErr = new Error(`${p.name} ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`${p.name} error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (e) {
      lastErr = e; // network/parse failure — try the next provider
    }
  }
  throw lastErr || new Error("No LLM provider configured — set at least one API key");
}

const HONESTY = `GROUNDING RULES (non-negotiable):
- Use ONLY the evidence items provided. Never use outside knowledge for facts, events, dates or names.
- Every factual claim must reference an evidence id like "E3" in the evidenceId field.
- If the evidence doesn't support an item, omit the item. Fewer verified items beats padding.
- Respond with valid JSON only. No markdown, no preamble.`;

// ------------------------------------------------------- target-mode flow ----

async function runTargetMode(url: string, selling: string) {
  const domain = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const name = domain.split(".")[0];

  // ---- Stage 1: profile the target -----------------------------------------
  const s1hits = (
    await Promise.all([
      serper(`${name} company what they do products`, 4),
      serper(`${name} strategy priorities 2026`, 4, "qdr:m3"),
      serper(`${name} announcement launch news`, 4, "qdr:m2"),
    ])
  ).flat();
  const ev1 = evidenceBlock(s1hits);

  const t1 = await llmJSON(
    `You are a senior account researcher profiling a target account for a seller. ${HONESTY}`,
    `Target: ${domain}. The user wants to sell into this company. Their product: ${selling || "a B2B product"}.

EVIDENCE:
${ev1.text}

Return JSON, strings under 18 words:
{"company":{"name":"","oneLiner":"what they do, plainly"},
 "priorities":[{"text":"a current strategic priority","evidenceId":""}],
 "recentMoves":[{"text":"a recent dated move","evidenceId":""}],
 "pressures":[{"text":"a competitive or market pressure they face","evidenceId":""}]}
Max 3 priorities, 3 moves, 2 pressures.`
  );

  // ---- Stage 2: pressure signals → insight → angle --------------------------
  // Search around the target's market, guided by stage-1 pressures.
  const pressureTerms = (t1.pressures || []).map((p: any) => p.text).join(" ");
  const s2hits = (
    await Promise.all([
      serper(`${name} competitors news`, 5, "qdr:m2"),
      serper(`${pressureTerms || name + " market"} news`, 5, "qdr:m2"),
      serper(`${name} hiring jobs leadership`, 4, "qdr:m2"),
    ])
  ).flat();
  const ev2 = evidenceBlock(s2hits);

  const t2 = await llmJSON(
    `You are a GTM intelligence analyst. You translate market events into pitch angles. ${HONESTY}

QUALITY BAR — match this example's depth (never copy its facts):
Event: "Competitor launches AI agent suite"
meansForTarget: "Roadmap pressure to ship comparable AI fast; their sales team needs a sharper differentiation story in every deal"
yourAngle: "Their reps will face the competitor's AI pitch at every renewal — position your product as how they win those head-to-heads"
Note the chain: event → specific internal pressure → specific use of YOUR product. Generic angles like "this shows the market is growing" are failures.`,
    `Target account: ${t1.company?.name} — ${t1.company?.oneLiner}. The user sells: ${selling || "a B2B product"}.

EVIDENCE:
${ev2.text}

For each relevant event build the insight chain. Return JSON, strings under 20 words:
{"scoops":[{"date":"","type":"COMPETITOR|MARKET|THEIR MOVE","headline":"the event",
 "meansForTarget":"the pressure or priority this creates inside the target",
 "yourAngle":"how the user pitches ${selling || "their product"} using this",
 "evidenceId":""}]}
Max 4 scoops. Skip events with no plausible link to the user's product.`
  );

  // ---- Stage 3: plays by role (no new facts, so no new search) --------------
  const t3 = await llmJSON(
    `You are a senior seller writing outreach a real human would send. Use ONLY the signals provided below as facts. Respond with valid JSON only.

TONE BAR — match this example (never copy its facts):
"Saw the CFO flag AI roadmap acceleration on your Q1 call. When every vendor claims AI, your reps' differentiation story is what closes — that's the exact gap we work on."
Rules: reference the specific signal in the first sentence; connect it to a business outcome in the second. BANNED: "I hope this finds you well", "I noticed you're", "crushing it", "quick question", "touching base", exclamation marks, flattery.`,
    `Target: ${t1.company?.name}. User sells: ${selling || "a B2B product"}.
Verified signals: ${(t2.scoops || []).map((s: any) => s.headline).join("; ") || "none"}.
Target priorities: ${(t1.priorities || []).map((p: any) => p.text).join("; ")}.

Return JSON, strings under 22 words:
{"plays":[
 {"role":"SDR","who":"persona/title to open with","hook":"which signal to lead with","message":"2-line cold opener referencing the signal, human tone"},
 {"role":"AE","who":"the economic buyer persona","hook":"the why-now to anchor on","message":"2-line talk track tying signal to business impact"},
 {"role":"CSM","who":"the champion persona (target is already a customer)","hook":"the risk or expansion trigger","message":"2-line proactive check-in referencing the signal"}]}`
  );

  // Re-attach real URLs from the evidence ids — links the model never touched.
  return {
    profile: {
      company: t1.company,
      priorities: attachUrls(t1.priorities || [], ev1.ids),
      recentMoves: attachUrls(t1.recentMoves || [], ev1.ids),
      pressures: attachUrls(t1.pressures || [], ev1.ids),
    },
    scoops: attachUrls(t2.scoops || [], ev2.ids),
    plays: t3.plays || [],
  };
}

// ----------------------------------------------------------------- route ----

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = body.mode || "target";

    if (mode === "target") {
      const url = (body.url || "").trim();
      if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
      const result = await runTargetMode(url, (body.selling || "").trim());
      return NextResponse.json(result);
    }

    // Porting the other modes is the same recipe, only the searches + prompt change:
    //   seller    → serper(site + "{name} competitors" + market news) → s1/s2/s3 prompts
    //   territory → one serper per account ("{account} news funding hiring", qdr:m3) → rank prompt
    //   signals   → decompose the user query into 2-3 serper searches → match prompt
    //   prep      → "{company} news" + "{persona} priorities {industry}" → brief prompt
    return NextResponse.json({ error: `mode "${mode}" not implemented yet` }, { status: 400 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "engine error" }, { status: 500 });
  }
}
