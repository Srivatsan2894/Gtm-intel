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
      serper(`${name} announcement launch news`, 4, { recency: "qdr:m2", endpoint: "news" }),
      serper(`${name} funding raised investment round valuation`, 3, { recency: "qdr:m6", endpoint: "news" }),
      serper(`${name} new hire executive CRO CMO CPO leadership change`, 3, { recency: "qdr:m3", endpoint: "news" }),
      serper(`${name} partnership integration deal announcement`, 3, { recency: "qdr:m3", endpoint: "news" }),
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
    serper(`${name} competitors market`, 5, { recency: "qdr:m2", endpoint: "news" }),
    serper(`${pressureTerms || name + " market trends"}`, 5, { recency: "qdr:m2", endpoint: "news" }),
    serper(`${name} hiring jobs engineering sales marketing`, 4, { recency: "qdr:m2" }),
    serper(`${name} reviews G2 alternatives complaints`, 3),
    serper(`${name} product launch feature release update`, 4, { recency: "qdr:m3", endpoint: "news" }),
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
{"scoops":[{"date":"copy from evidence","type":"COMPETITOR|MARKET|THEIR MOVE|FUNDING|LEADERSHIP|PRODUCT|PARTNERSHIP|HIRING","headline":"the event",
 "meansForTarget":"the pressure or priority this creates inside ${t1.company?.name}",
 "yourAngle":"how the user pitches ${selling || "their product"} using this",
 "evidenceId":""}]}
Max 6 scoops. evidenceId is REQUIRED. Cover a variety of signal types — don't cluster all scoops on the same category. Skip events with no plausible link to the user's product.`
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
    `You are a senior GTM strategist writing a comprehensive sales briefing document. ${HONESTY_SYNTHESIS}

This brief is read by the ENTIRE sales team — SDRs, AEs, CSMs, and managers — before engaging the account. Requirements:
- Grounded ONLY in the verified signals provided. No invented facts.
- Narrative enough to brief a room, specific enough to run a call
- Every talking point references a real, verified signal from the picture below
- Watch-outs are specific risks for THIS account, not generic sales advice
- Signal feed items must cover DIFFERENT types (don't cluster on one category)`,
    `Seller's product: ${selling || "a B2B product"}. Target: ${t1.company?.name}.
Detected tech stack on their site: ${techStack.join(", ") || "unknown"}.

VERIFIED PICTURE (build the entire brief from this only):
${JSON.stringify(verified, null, 2)}

Return JSON:
{"situation":"3-4 sentences: what ${t1.company?.name} does, their current strategic focus, their market position, and what pressures or opportunities are driving their decisions right now. Concrete and specific — no filler.",
 "whyNow":"2-3 sentences: the specific verified signals creating urgency or an opening — reference actual events and timelines and what they trigger internally. This is the core of the pitch.",
 "signalFeed":[
   {"type":"FUNDING|LEADERSHIP|PRODUCT|MARKET|COMPETITIVE|HIRING|PARTNERSHIP",
    "headline":"the signal in one punchy line",
    "implication":"what this creates inside ${t1.company?.name} — a budget shift, a priority change, a gap, or a pressure",
    "angle":"the exact conversation hook — how to reference this specific signal when reaching out or on the first call"}
 ],
 "approach":"2-3 sentences: recommended approach — which persona to engage first, what business problem to lead with, and what proof points to bring to the first meeting",
 "talkingPoints":["a specific, signal-grounded talking point — conversational tone, references a real verified event, under 25 words"],
 "watchOuts":["a specific risk, likely objection, or account-specific blocker to prepare for — under 18 words"],
 "topAction":"the single most important next step today — specific and actionable, under 20 words"}
Max 5 signalFeed items (mix types), 4 talkingPoints, 3 watchOuts.`
  );

  return {
    brief: {
      situation: t4.situation || "",
      whyNow: t4.whyNow || "",
      signalFeed: t4.signalFeed || [],
      approach: t4.approach || "",
      talkingPoints: t4.talkingPoints || [],
      watchOuts: t4.watchOuts || [],
      topAction: t4.topAction || "",
    },
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

// --------------------------------------------------- battlecard mode flow ----

async function runBattlecardMode(competitor: string, yourProduct: string, selling: string) {
  const isUrl = competitor.includes(".");
  const domain = isUrl ? competitor.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : "";
  const compSlug = domain ? domain.split(".")[0] : competitor;
  const productLabel = yourProduct || selling || "our product";

  // Stage 1: Competitor profile — what they do, strengths, weaknesses
  const s1raw = (await Promise.all([
    serper(`${compSlug} company products features overview`, 5),
    serper(`${compSlug} customer reviews complaints G2 reddit`, 5),
    serper(`${compSlug} pricing plans`, 3),
    serper(`${compSlug} weaknesses limitations problems`, 4, { endpoint: "news" }),
  ])).flat();
  const ev1 = evidenceBlock(diversify(s1raw));

  const t1 = await llmJSON(
    `You are a competitive intelligence analyst building a sales battlecard. ${HONESTY}`,
    `Competitor: ${compSlug}. Seller's product: ${productLabel}.

EVIDENCE:
${ev1.text}

Return JSON:
{"competitor":{"name":"full competitor name","tagline":"their actual positioning tagline","positioning":"one sentence — how they position in the market"},
 "strengths":[{"text":"a genuine strength, max 14 words","evidenceId":""}],
 "weaknesses":[{"text":"a real weakness or recurring complaint, max 14 words","evidenceId":""}]}
Max 4 strengths, 4 weaknesses. evidenceId REQUIRED for every item.`
  );

  // Stage 2: Head-to-head comparison, objection handles, discovery landmines
  const compNameFull = t1.competitor?.name || compSlug;
  const s2raw = (await Promise.all([
    serper(`${compNameFull} vs ${productLabel} comparison`, 5),
    serper(`why switch from ${compNameFull} alternatives`, 4),
    serper(`${compNameFull} negative reviews loss`, 4),
    serper(`${compNameFull} sales objections competitor`, 3),
  ])).flat();
  const ev2 = evidenceBlock(diversify(s2raw));

  const t2 = await llmJSON(
    `You are writing a competitive battlecard for a sales team. ${HONESTY}

QUALITY BAR for objection handles:
Objection: "Their pricing is cheaper"
Handle: "G2 reviewers flagged hidden implementation costs that pushed total cost 40% above list price — ask them to model full TCO including setup and support."
Rules: ground every handle in evidence. Never say "we're better" without proof. Handles should give the rep something to say, not just acknowledge the objection.`,
    `Competitor: ${compNameFull}. Seller's product: ${productLabel}.
Competitor strengths: ${(t1.strengths || []).map((s: any) => s.text).join("; ")}.
Competitor weaknesses: ${(t1.weaknesses || []).map((w: any) => w.text).join("; ")}.

EVIDENCE:
${ev2.text}

Return JSON:
{"comparison":[{"category":"comparison dimension e.g. Setup Time","us":"our advantage in max 10 words","them":"competitor position in max 10 words"}],
 "objections":[{"objection":"a specific objection prospects give when they prefer ${compNameFull}","handle":"1-2 sentence rebuttal grounded in evidence","evidenceId":""}],
 "landmines":[{"question":"a discovery question that exposes a ${compNameFull} weakness","why":"what this reveals, max 12 words"}]}
Max 4 comparison rows, 4 objections, 3 landmines. evidenceId REQUIRED for objections.`
  );

  // Stage 3: Proof points and win narrative
  const s3raw = (await Promise.all([
    serper(`${productLabel} vs ${compNameFull} win case study`, 5),
    serper(`${compNameFull} customers switching leaving alternatives`, 4, { endpoint: "news" }),
  ])).flat();
  const ev3 = evidenceBlock(diversify(s3raw));

  const t3 = await llmJSON(
    `You are writing a comprehensive competitive briefing for a sales team. ${HONESTY_SYNTHESIS}

Requirements:
- Grounded only in the verified inputs and evidence provided
- Narrative must be sharp enough to read in 30 seconds before a call
- Kill shot must be highly specific to ${compNameFull}'s actual weakness — not generic advice
- Team brief gives each role a concrete, different instruction`,
    `Competitor: ${compNameFull}. Seller's product: ${productLabel}.
Their positioning: ${t1.competitor?.positioning}.
Key weaknesses: ${(t1.weaknesses || []).map((w: any) => w.text).slice(0, 3).join("; ")}.
Objection handles available: ${(t2.objections || []).map((o: any) => o.handle).slice(0, 2).join("; ")}.
Discovery landmines: ${(t2.landmines || []).map((l: any) => l.question).join("; ")}.

EVIDENCE:
${ev3.text}

Return JSON:
{"proofPoints":[{"claim":"specific, credible proof point or win pattern, max 16 words","evidenceId":""}],
 "narrative":"3-4 sentences: how ${compNameFull} positions in the market, their actual structural weakness, and the opening this creates. Sharp and direct.",
 "killShot":"one sentence — the single most effective competitive move specific to ${compNameFull}'s known weakness. This is what the rep says when the prospect names ${compNameFull} as the frontrunner.",
 "teamBrief":{
   "sdr":"2 sentences: how SDRs handle ${compNameFull} when prospects mention them in prospecting — what to say, what to plant as a question",
   "ae":"2 sentences: how AEs position and close against ${compNameFull} in active evaluations — what to emphasize, what proof to bring",
   "csm":"2 sentences: how CSMs protect existing accounts from ${compNameFull} encroachment — what risk to surface, what expansion lever to use"
 }}`
  );

  return {
    competitor: t1.competitor,
    strengths: attachUrls(t1.strengths || [], ev1.ids),
    weaknesses: attachUrls(t1.weaknesses || [], ev1.ids),
    comparison: t2.comparison || [],
    objections: attachUrls(t2.objections || [], ev2.ids),
    landmines: t2.landmines || [],
    proofPoints: attachUrls(t3.proofPoints || [], ev3.ids),
    narrative: t3.narrative || "",
    killShot: t3.killShot || "",
    teamBrief: t3.teamBrief || {},
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
    if (mode === "battlecard") {
      const competitor = (body.competitor || "").trim();
      if (!competitor) return NextResponse.json({ error: "competitor required" }, { status: 400 });
      const result = await runBattlecardMode(competitor, (body.yourProduct || "").trim(), (body.selling || "").trim());
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: `mode "${mode}" not implemented yet` }, { status: 400 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "engine error" }, { status: 500 });
  }
}
