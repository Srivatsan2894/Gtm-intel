// app/api/engine/route.ts
// WHY NOW — GTM Search Engine, production pipeline v2.2
// v2.2: real recency dates ("3 days ago") carried from news results to the UI,
// provider logging so you can see which model answered, OpenRouter in waterfall.

import { NextResponse } from "next/server";

// ---------------------------------------------------------- LLM providers ----
// All OpenAI-compatible. Tried top to bottom; falls through on rate limit or
// error. Providers without a key in env are skipped automatically.
const PROVIDERS = [
  { name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY" },
  { name: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.5-flash", keyEnv: "GEMINI_API_KEY" },
  { name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: "deepseek/deepseek-chat-v3.1:free", keyEnv: "OPENROUTER_API_KEY" },
  { name: "deepseek", url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", keyEnv: "DEEPSEEK_API_KEY" },
] as const;

async function llmJSON(system: string, user: string): Promise<any> {
  let lastErr: any = null;
  for (const p of PROVIDERS) {
    const key = process.env[p.keyEnv];
    if (!key) continue;
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: p.model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`${p.name} ${res.status}`); continue; }
      if (!res.ok) throw new Error(`${p.name} error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      console.log(`[llm] answered by ${p.name} (${p.model})`);
      return JSON.parse(data.choices[0].message.content);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("No LLM provider configured — set at least one API key");
}

// ---------------------------------------------------------------- search ----

type Hit = { title: string; snippet: string; link: string; date?: string };

const SOCIAL = ["linkedin.com", "facebook.com", "x.com", "twitter.com", "instagram.com", "youtube.com", "reddit.com"];
const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function serper(q: string, num = 6, opts: { recency?: string; endpoint?: "search" | "news" } = {}): Promise<Hit[]> {
  const url = opts.endpoint === "news" ? "https://google.serper.dev/news" : "https://google.serper.dev/search";
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num, ...(opts.recency ? { tbs: opts.recency } : {}) }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return [...(data.news || []), ...(data.organic || [])].slice(0, num).map((r: any) => ({
    title: r.title || "", snippet: r.snippet || r.description || "", link: r.link || "", date: r.date || "",
  }));
}

// Source diversity: news-grade sources first, max 2 per domain, max 1 social item total.
function diversify(hits: Hit[], max = 12): Hit[] {
  const isSocial = (h: Hit) => SOCIAL.some((s) => domainOf(h.link).includes(s));
  const perDomain: Record<string, number> = {};
  let socialUsed = 0;
  const out: Hit[] = [];
  for (const h of [...hits].sort((a, b) => Number(isSocial(a)) - Number(isSocial(b)))) {
    const d = domainOf(h.link);
    if (!d || !h.title) continue;
    if (isSocial(h) && socialUsed >= 1) continue;
    if ((perDomain[d] || 0) >= 2) continue;
    perDomain[d] = (perDomain[d] || 0) + 1;
    if (isSocial(h)) socialUsed++;
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

function evidenceBlock(hits: Hit[]) {
  const ids = hits.map((h, i) => ({ id: `E${i + 1}`, ...h, source: domainOf(h.link) }));
  const text = ids.map((h) => `[${h.id}] (${h.source}) ${h.title} — ${h.snippet}${h.date ? ` (${h.date})` : ""}`).join("\n");
  return { ids, text };
}

// Re-attach real URL, publication name AND the real recency date ("3 days ago")
// from the original news result. The model never writes these — code does.
function attachUrls(items: any[], ids: { id: string; link: string }[]) {
  const map: Record<string, any> = Object.fromEntries(ids.map((h: any) => [h.id, h]));
  return (items || []).map((it) => {
    const hit = it.evidenceId ? map[it.evidenceId] : null;
    return {
      ...it,
      sourceUrl: hit?.link || null,
      sourceName: hit ? domainOf(hit.link) : null,
      sourceDate: hit?.date || null,
    };
  });
}

// ------------------------------------------------ tech stack (BuiltWith-lite) ----

const FINGERPRINTS: [string, RegExp][] = [
  ["Salesforce", /salesforce|force\.com|pardot/i], ["HubSpot", /hs-scripts|hubspot/i],
  ["Marketo", /marketo|munchkin/i], ["Zendesk", /zendesk|zdassets/i],
  ["Intercom", /intercom/i], ["Drift", /driftt|drift\.com/i],
  ["Freshworks", /freshworks|freshdesk|freshchat/i], ["Segment", /cdn\.segment|segment\.com/i],
  ["Google Analytics", /googletagmanager|gtag|google-analytics/i], ["Mixpanel", /mixpanel/i],
  ["Amplitude", /amplitude/i], ["Hotjar", /hotjar/i], ["Stripe", /js\.stripe\.com/i],
  ["Shopify", /cdn\.shopify/i], ["Webflow", /webflow/i], ["WordPress", /wp-content/i],
  ["Next.js", /\/_next\//i], ["Optimizely", /optimizely/i], ["Clearbit", /clearbit/i],
  ["6sense", /6sense|6sc\.co/i], ["ZoomInfo", /zoominfo/i], ["Qualified", /qualified\.com/i],
];

async function detectTechStack(domain: string): Promise<string[]> {
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WhyNowBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    const html = (await res.text()).slice(0, 400_000);
    return FINGERPRINTS.filter(([, re]) => re.test(html)).map(([name]) => name);
  } catch { return []; }
}

// ----------------------------------------------------------------- prompts ----

const HONESTY = `GROUNDING RULES (non-negotiable):
- Use ONLY the evidence items provided. Never use outside knowledge for facts, events, dates or names.
- Every factual claim MUST include its evidence id (like "E3") in the evidenceId field. evidenceId is REQUIRED.
- Copy dates exactly as they appear in the evidence.
- If the evidence doesn't support an item, omit the item. Fewer verified items beats padding.
- Respond with valid JSON only. No markdown, no preamble.`;

const HONESTY_SYNTHESIS = `GROUNDING RULES (non-negotiable):
- Build the synthesis ONLY from the verified items provided. Never introduce a company, person, number, date or event that isn't in them.
- You may connect and interpret the verified items, but every claim must trace back to one of them.
- If the verified picture is thin, write a shorter, honest synthesis. Never pad with filler like "the market is growing" or "AI is transforming the industry".
- Respond with valid JSON only. No markdown.`;

// ------------------------------------------------------- target-mode flow ----

async function runTargetMode(url: string, selling: string) {
  const domain = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const name = domain.split(".")[0];

  // ---- Stage 1: profile the target (tech detection runs in parallel) ------
  const [techStack, s1raw] = await Promise.all([
    detectTechStack(domain),
    Promise.all([
      serper(`${name} company what they do products`, 4),
      serper(`${name} strategy priorities 2026`, 4, { recency: "qdr:m3", endpoint: "news" }),
      serper(`${name} announcement launch`, 4, { recency: "qdr:m2", endpoint: "news" }),
    ]).then((r) => r.flat()),
  ]);
  const ev1 = evidenceBlock(diversify(s1raw));

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
Max 3 priorities, 3 moves, 2 pressures. evidenceId is REQUIRED for every item.`
  );

  // ---- Stage 2: pressure signals → insight → angle -------------------------
  const pressureTerms = (t1.pressures || []).map((p: any) => p.text).join(" ");
  const s2raw = (await Promise.all([
    serper(`${name} competitors`, 5, { recency: "qdr:m2", endpoint: "news" }),
    serper(`${pressureTerms || name + " market"}`, 5, { recency: "qdr:m2", endpoint: "news" }),
    serper(`${name} hiring leadership`, 4, { recency: "qdr:m2" }),
    serper(`${name} reviews G2 alternatives`, 3),
  ])).flat();
  const ev2 = evidenceBlock(diversify(s2raw));

  const t2 = await llmJSON(
    `You are a GTM intelligence analyst. You translate market events into pitch angles. ${HONESTY}

QUALITY BAR — match this example's depth (never copy its facts):
Event: "Competitor launches AI agent suite"
meansForTarget: "Roadmap pressure to ship comparable AI fast; their sales team needs a sharper differentiation story in every deal"
yourAngle: "Their reps will face the competitor's AI pitch at every renewal — position your product as how they win those head-to-heads"
Note the chain: event → specific internal pressure → specific use of YOUR product. Generic angles like "this shows the market is growing" are failures.`,
    `Target account: ${t1.company?.name} — ${t1.company?.oneLiner}. The user sells: ${selling || "a B2B product"}.
Detected tools on their website: ${techStack.join(", ") || "unknown"}.

EVIDENCE:
${ev2.text}

For each relevant event build the insight chain. Return JSON, strings under 20 words:
{"scoops":[{"date":"copy from evidence","type":"COMPETITOR|MARKET|THEIR MOVE","headline":"the event",
 "meansForTarget":"the pressure or priority this creates inside ${t1.company?.name}",
 "yourAngle":"how the user pitches ${selling || "their product"} using this",
 "evidenceId":""}]}
Max 4 scoops. evidenceId is REQUIRED. Skip events with no plausible link to the user's product.`
  );

  // ---- Stage 3: plays by role (locked to verified signals, no new facts) ---
  const t3 = await llmJSON(
    `You are a senior seller writing outreach a real human would send. Use ONLY the signals provided below as facts. Respond with valid JSON only.

TONE BAR — match this example (never copy its facts):
"Saw the CFO flag AI roadmap acceleration on your Q1 call. When every vendor claims AI, your reps' differentiation story is what closes — that's the exact gap we work on."
Rules: reference the specific signal in the first sentence; connect it to a business outcome in the second. BANNED: "I hope this finds you well", "I noticed you're", "crushing it", "quick question", "touching base", exclamation marks, flattery.`,
    `Target: ${t1.company?.name}. User sells: ${selling || "a B2B product"}.
Verified signals: ${(t2.scoops || []).map((s: any) => s.headline).join("; ") || "none"}.
Their detected tools: ${techStack.join(", ") || "unknown"}.
Target priorities: ${(t1.priorities || []).map((p: any) => p.text).join("; ")}.

Return JSON, strings under 22 words:
{"plays":[
 {"role":"SDR","who":"persona/title to open with","hook":"which signal to lead with","message":"2-line cold opener referencing the signal, human tone"},
 {"role":"AE","who":"the economic buyer persona","hook":"the why-now to anchor on","message":"2-line talk track tying signal to business impact"},
 {"role":"CSM","who":"the champion persona (target is already a customer)","hook":"the risk or expansion trigger","message":"2-line proactive check-in referencing the signal"}]}`
  );

  // ---- Stage 4: synthesis — a cohesive "why now" narrative + the brief ------
  // Reads ACROSS the already-verified Stage 1-2 outputs. Adds NO new facts,
  // so the trust model holds — every claim traces to a sourced item below.
  const verified = {
    oneLiner: t1.company?.oneLiner || "",
    priorities: (t1.priorities || []).map((p: any) => p.text),
    recentMoves: (t1.recentMoves || []).map((p: any) => p.text),
    pressures: (t1.pressures || []).map((p: any) => p.text),
    signals: (t2.scoops || []).map((s: any) => ({
      headline: s.headline, meansForThem: s.meansForTarget, yourAngle: s.yourAngle,
    })),
  };

  const t4 = await llmJSON(
    `You are a GTM strategist writing the synthesis a seller reads right before they walk into the account. ${HONESTY_SYNTHESIS}`,
    `Seller's product: ${selling || "a B2B product"}. Target: ${t1.company?.name}.
Detected stack: ${techStack.join(", ") || "unknown"}.

VERIFIED PICTURE (use only this):
${JSON.stringify(verified, null, 2)}

Return JSON:
{"narrative":"3-5 sentences of plain prose that connect the dots ACROSS all the verified items: what this company is focused on now, the live signal that makes this the moment, the pressure it creates inside them, and where ${selling || "the product"} fits. Read across everything — never just restate one item. No bullets, no headers. Sharp and conversational.",
 "tldr":["3 short lines: the situation, the opening, the risk to avoid"],
 "topAction":"the single best next step today, under 20 words"}`
  );

  return {
    summary: { narrative: t4.narrative || "", tldr: t4.tldr || [], topAction: t4.topAction || "" },
    techStack,
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
    return NextResponse.json({ error: `mode "${mode}" not implemented yet` }, { status: 400 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "engine error" }, { status: 500 });
  }
}
