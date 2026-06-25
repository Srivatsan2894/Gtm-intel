"use client";

import { useState, useEffect, useRef } from "react";

const T = {
  bg: "#0E1420", panel: "#151D2E", panelEdge: "#243044", ink: "#EDF1F7",
  dim: "#8B96A8", amber: "#F5A524", amberSoft: "rgba(245,165,36,0.12)",
  green: "#4ADE80", greenSoft: "rgba(74,222,128,0.10)",
  red: "#F87171", redSoft: "rgba(248,113,113,0.10)",
  blue: "#7DC4F7", blueSoft: "rgba(125,196,247,0.10)",
  purple: "#A78BFA", purpleSoft: "rgba(167,139,250,0.10)",
  orange: "#FB923C", orangeSoft: "rgba(251,146,60,0.10)",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  display: "'Space Grotesk', system-ui, sans-serif",
  body: "'Inter', system-ui, -apple-system, sans-serif",
};

const INTEL_STAGES = [
  "Researching the target account…",
  "Scanning for funding and leadership signals…",
  "Mining news, reviews and product signals…",
  "Translating signals into pitch angles…",
  "Writing plays for SDR, AE and CSM…",
  "Writing the AI sales brief…",
];

const BC_STAGES = [
  "Profiling the competitor…",
  "Mining customer reviews and complaints…",
  "Building head-to-head comparison…",
  "Writing objection handles…",
  "Planting discovery landmines…",
  "Writing the competitive team brief…",
];

const SIGNAL_TYPE_META: Record<string, { color: string; soft: string; label: string }> = {
  FUNDING:     { color: T.blue,   soft: T.blueSoft,   label: "FUNDING"     },
  LEADERSHIP:  { color: T.purple, soft: T.purpleSoft, label: "LEADERSHIP"  },
  PRODUCT:     { color: T.green,  soft: T.greenSoft,  label: "PRODUCT"     },
  MARKET:      { color: T.dim,    soft: "rgba(139,150,168,0.10)", label: "MARKET" },
  COMPETITIVE: { color: T.red,    soft: T.redSoft,    label: "COMPETITIVE" },
  HIRING:      { color: T.amber,  soft: T.amberSoft,  label: "HIRING"      },
  PARTNERSHIP: { color: T.orange, soft: T.orangeSoft, label: "PARTNERSHIP" },
  "THEIR MOVE":{ color: T.amber,  soft: T.amberSoft,  label: "THEIR MOVE"  },
};

const signalMeta = (type: string) =>
  SIGNAL_TYPE_META[type?.toUpperCase()] ?? { color: T.dim, soft: "rgba(139,150,168,0.10)", label: type || "SIGNAL" };

const roleColor = (r: string) => (r === "SDR" ? T.amber : r === "AE" ? T.blue : T.green);

function copyText(str: string, cb: () => void) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(str).then(cb);
}

function CopyBtn({ getText, label = "COPY" }: { getText: () => string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => copyText(getText(), () => { setDone(true); setTimeout(() => setDone(false), 1600); })}
      style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 0.5, color: done ? T.green : T.amber, background: "transparent", border: `1px solid ${done ? T.green : T.panelEdge}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
      {done ? "COPIED" : label}
    </button>
  );
}

function SourceLink({ url, name }: { url?: string | null; name?: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      style={{ fontFamily: T.mono, fontSize: 10.5, color: T.dim, marginLeft: 8, textDecoration: "underline" }}>
      via {name || "source"} ↗
    </a>
  );
}

function Panel({ kicker, title, children, accentColor }: { kicker: string; title: string; children: React.ReactNode; accentColor?: string }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 12, padding: "20px 22px", marginBottom: 14 }}>
      <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1.5, color: accentColor || T.amber, marginBottom: 4 }}>{kicker}</div>
      <div style={{ fontFamily: T.display, fontSize: 17, fontWeight: 600, color: T.ink, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1.5, color: color || T.dim, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function List({ label, items }: { label: string; items?: { text: string; sourceUrl?: string | null; sourceName?: string | null; sourceDate?: string | null }[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <SectionLabel>{label}</SectionLabel>
      {(items || []).map((it, i) => (
        <div key={i} style={{ color: T.ink, fontSize: 13.5, lineHeight: 1.7, padding: "3px 0", borderBottom: `1px solid ${T.panelEdge}` }}>
          {it.text}
          {it.sourceDate && <span style={{ fontFamily: T.mono, fontSize: 10.5, color: T.amber, marginLeft: 8 }}>{it.sourceDate}</span>}
          <SourceLink url={it.sourceUrl} name={it.sourceName} />
        </div>
      ))}
    </div>
  );
}

// ── AI Sales Brief panels ──────────────────────────────────────────────────

function SignalCard({ signal }: { signal: any }) {
  const meta = signalMeta(signal.type);
  return (
    <div style={{ background: meta.soft, border: `1px solid ${meta.color}22`, borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: meta.color, background: `${meta.color}22`, border: `1px solid ${meta.color}44`, borderRadius: 4, padding: "2px 8px" }}>
          {meta.label}
        </span>
        <span style={{ color: T.ink, fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>{signal.headline}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontFamily: T.mono, fontSize: 9.5, letterSpacing: 1, color: T.dim, marginBottom: 4 }}>MEANS FOR THEM</div>
          <div style={{ color: T.ink, fontSize: 12.5, lineHeight: 1.6 }}>{signal.implication}</div>
        </div>
        <div>
          <div style={{ fontFamily: T.mono, fontSize: 9.5, letterSpacing: 1, color: meta.color, marginBottom: 4 }}>YOUR ANGLE</div>
          <div style={{ color: T.ink, fontSize: 12.5, lineHeight: 1.6 }}>{signal.angle}</div>
          <div style={{ marginTop: 6 }}><CopyBtn label="COPY ANGLE" getText={() => signal.angle} /></div>
        </div>
      </div>
    </div>
  );
}

function SalesBrief({ brief, companyName }: { brief: any; companyName?: string }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 12, padding: "22px 24px", marginBottom: 14 }}>
      <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1.5, color: T.amber, marginBottom: 4 }}>⚡ AI SALES BRIEF</div>
      <div style={{ fontFamily: T.display, fontSize: 17, fontWeight: 600, color: T.ink, marginBottom: 20 }}>
        Full team briefing — {companyName || "target account"}
      </div>

      {/* Situation */}
      {brief.situation && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>SITUATION</SectionLabel>
          <div style={{ color: T.ink, fontSize: 14.5, lineHeight: 1.75 }}>{brief.situation}</div>
        </div>
      )}

      {/* Why Now — highlighted */}
      {brief.whyNow && (
        <div style={{ background: T.amberSoft, border: `1px solid rgba(245,165,36,0.25)`, borderLeft: `3px solid ${T.amber}`, borderRadius: 8, padding: "14px 16px", marginBottom: 20 }}>
          <SectionLabel color={T.amber}>WHY NOW — THE TRIGGER</SectionLabel>
          <div style={{ color: T.ink, fontSize: 14, lineHeight: 1.75 }}>{brief.whyNow}</div>
        </div>
      )}

      {/* Signal Feed */}
      {brief.signalFeed?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>LIVE SIGNAL FEED</SectionLabel>
          {brief.signalFeed.map((s: any, i: number) => <SignalCard key={i} signal={s} />)}
        </div>
      )}

      {/* Recommended Approach */}
      {brief.approach && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>RECOMMENDED APPROACH</SectionLabel>
          <div style={{ color: T.ink, fontSize: 14, lineHeight: 1.75 }}>{brief.approach}</div>
        </div>
      )}

      {/* Talking Points + Watch Outs */}
      {(brief.talkingPoints?.length > 0 || brief.watchOuts?.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          {brief.talkingPoints?.length > 0 && (
            <div>
              <SectionLabel color={T.green}>TALKING POINTS</SectionLabel>
              {brief.talkingPoints.map((tp: string, i: number) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${T.panelEdge}` }}>
                  <span style={{ color: T.green, flexShrink: 0, marginTop: 3, fontSize: 11 }}>→</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: T.ink, fontSize: 13, lineHeight: 1.6 }}>{tp}</span>
                    <div style={{ marginTop: 4 }}><CopyBtn getText={() => tp} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {brief.watchOuts?.length > 0 && (
            <div>
              <SectionLabel color={T.red}>WATCH OUTS</SectionLabel>
              {brief.watchOuts.map((wo: string, i: number) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${T.panelEdge}` }}>
                  <span style={{ color: T.red, flexShrink: 0, marginTop: 3, fontSize: 11 }}>⚠</span>
                  <span style={{ color: T.ink, fontSize: 13, lineHeight: 1.6 }}>{wo}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top Action CTA */}
      {brief.topAction && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: T.amber, borderRadius: 8, padding: "12px 16px" }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 1, color: "#10151F", fontWeight: 600 }}>NEXT ACTION</span>
          <span style={{ color: "#10151F", fontSize: 14, fontWeight: 600, flex: 1 }}>→ {brief.topAction}</span>
          <CopyBtn getText={() => brief.topAction} label="COPY" />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  // Account Intel state
  const [url, setUrl] = useState("");
  const [selling, setSelling] = useState("");
  const [data, setData] = useState<any>(null);

  // Battlecard state
  const [competitor, setCompetitor] = useState("");
  const [yourProduct, setYourProduct] = useState("");
  const [bcSelling, setBcSelling] = useState("");
  const [bcData, setBcData] = useState<any>(null);

  // Shared state
  const [activeMode, setActiveMode] = useState<"intel" | "battlecard">("intel");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const activeStages = activeMode === "intel" ? INTEL_STAGES : BC_STAGES;

  useEffect(() => {
    clearInterval(timer.current);
    if (loading) {
      setStage(0);
      timer.current = setInterval(() => setStage((s) => Math.min(s + 1, activeStages.length - 1)), 6000);
    }
    return () => clearInterval(timer.current);
  }, [loading]);

  const run = async () => {
    if (activeMode === "intel" && !url.trim()) return;
    if (activeMode === "battlecard" && !competitor.trim()) return;
    setLoading(true); setError(null); setData(null); setBcData(null);
    try {
      if (activeMode === "intel") {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "target", url: url.trim(), selling: selling.trim() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Engine error");
        setData(json);
      } else {
        const res = await fetch("/api/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "battlecard", competitor: competitor.trim(), yourProduct: yourProduct.trim(), selling: bcSelling.trim() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Engine error");
        setBcData(json);
      }
    } catch (e: any) {
      setError(e.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (mode: "intel" | "battlecard") => {
    setActiveMode(mode);
    setError(null);
    setData(null);
    setBcData(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body, padding: "0 0 80px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
        input::placeholder { color: #5A6478; }
        @keyframes pulse { 0%,100%{opacity:.35} 50%{opacity:1} }
      `}</style>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "56px 20px 0" }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.amber, marginBottom: 10 }}>
          WHY NOW · THE GTM SEARCH ENGINE
        </div>
        <h1 style={{ fontFamily: T.display, fontSize: 34, fontWeight: 700, color: T.ink, margin: "0 0 10px", lineHeight: 1.15 }}>
          {activeMode === "intel"
            ? <> Paste your target&apos;s URL.<br />Get the signals — and the pitch.</>
            : <>Name your competitor.<br />Get a battlecard in 60 seconds.</>}
        </h1>
        <p style={{ color: T.dim, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 24px", maxWidth: 620 }}>
          {activeMode === "intel"
            ? "Live research across funding, leadership, product and competitive signals — every insight consolidated into an AI brief your whole sales team can act on."
            : "Live research on your competitor — real weaknesses from actual reviews, objection handles grounded in evidence, discovery landmines, and a role-by-role team brief."}
        </p>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: 4, width: "fit-content" }}>
          {(["intel", "battlecard"] as const).map((m) => (
            <button key={m} onClick={() => switchMode(m)}
              style={{
                fontFamily: T.mono, fontSize: 11, letterSpacing: 1, padding: "8px 20px", borderRadius: 7, border: "none", cursor: "pointer",
                background: activeMode === m ? T.amber : "transparent",
                color: activeMode === m ? "#10151F" : T.dim,
                fontWeight: activeMode === m ? 600 : 400,
              }}>
              {m === "intel" ? "ACCOUNT INTEL" : "⚔ BATTLECARD"}
            </button>
          ))}
        </div>

        {/* Account Intel form */}
        {activeMode === "intel" && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && run()}
                placeholder="paste your TARGET account's URL — e.g. freshworks.com"
                style={{ flex: "1 1 260px", fontFamily: T.mono, fontSize: 14, color: T.ink, background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: "13px 16px", outline: "none" }} />
              <button onClick={run} disabled={loading}
                style={{ fontFamily: T.display, fontSize: 14, fontWeight: 600, color: "#10151F", background: loading ? "#9a7833" : T.amber, border: "none", borderRadius: 10, padding: "13px 22px", cursor: loading ? "default" : "pointer" }}>
                {loading ? "Hunting…" : "Crack this account"}
              </button>
            </div>
            <input value={selling} onChange={(e) => setSelling(e.target.value)}
              placeholder="What do YOU sell? (one line — this powers the pitch angles)"
              style={{ width: "100%", boxSizing: "border-box", fontFamily: T.body, fontSize: 13, color: T.ink, background: "transparent", border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: "11px 16px", outline: "none", marginBottom: 28 }} />
          </>
        )}

        {/* Battlecard form */}
        {activeMode === "battlecard" && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <input value={competitor} onChange={(e) => setCompetitor(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && run()}
                placeholder="Competitor name or URL — e.g. salesforce.com or HubSpot"
                style={{ flex: "1 1 260px", fontFamily: T.mono, fontSize: 14, color: T.ink, background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: "13px 16px", outline: "none" }} />
              <button onClick={run} disabled={loading}
                style={{ fontFamily: T.display, fontSize: 14, fontWeight: 600, color: "#10151F", background: loading ? "#9a7833" : T.amber, border: "none", borderRadius: 10, padding: "13px 22px", cursor: loading ? "default" : "pointer" }}>
                {loading ? "Building…" : "Build battlecard"}
              </button>
            </div>
            <input value={yourProduct} onChange={(e) => setYourProduct(e.target.value)}
              placeholder="Your product name — so we frame the comparison around you"
              style={{ width: "100%", boxSizing: "border-box", fontFamily: T.body, fontSize: 13, color: T.ink, background: "transparent", border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: "11px 16px", outline: "none", marginBottom: 10 }} />
            <input value={bcSelling} onChange={(e) => setBcSelling(e.target.value)}
              placeholder="What do YOU sell? (optional — sharpens objection handles)"
              style={{ width: "100%", boxSizing: "border-box", fontFamily: T.body, fontSize: 13, color: T.ink, background: "transparent", border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: "11px 16px", outline: "none", marginBottom: 28 }} />
          </>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 12, padding: "18px 22px", marginBottom: 14 }}>
            {activeStages.slice(0, stage + 1).map((m, i) => (
              <div key={i} style={{ fontFamily: T.mono, fontSize: 12.5, lineHeight: 2, color: i === stage ? T.amber : T.dim, animation: i === stage ? "pulse 1.4s infinite" : "none" }}>
                {i < stage ? "✓" : "›"} {m}
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ color: T.red, fontFamily: T.mono, fontSize: 13, border: `1px solid ${T.red}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>{error}</div>
        )}

        {/* ══════════ ACCOUNT INTEL RESULTS ══════════ */}

        {/* AI Sales Brief — top of results */}
        {data?.brief && (
          <SalesBrief brief={data.brief} companyName={data.profile?.company?.name} />
        )}

        {/* Tech stack */}
        {data?.techStack?.length > 0 && (
          <div style={{ margin: "0 0 14px" }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.dim, marginRight: 10 }}>DETECTED ON THEIR SITE:</span>
            {data.techStack.map((t: string, i: number) => (
              <span key={i} style={{ fontFamily: T.mono, fontSize: 11, color: T.amber, background: T.amberSoft, border: `1px solid ${T.panelEdge}`, borderRadius: 5, padding: "3px 9px", marginRight: 6, display: "inline-block", marginBottom: 6 }}>{t}</span>
            ))}
          </div>
        )}

        {/* Target profile */}
        {data?.profile && (
          <Panel kicker="01 / TARGET PROFILE" title={data.profile.company?.name || ""}>
            <div style={{ color: T.dim, fontSize: 14, margin: "-8px 0 14px" }}>{data.profile.company?.oneLiner}</div>
            <List label="THEIR STRATEGIC PRIORITIES" items={data.profile.priorities} />
            <List label="RECENT MOVES" items={data.profile.recentMoves} />
            <List label="PRESSURES THEY FACE" items={data.profile.pressures} />
          </Panel>
        )}

        {/* Signal feed (sourced) */}
        {data?.scoops?.length > 0 && (
          <Panel kicker="02 / SIGNALS → INSIGHT → ANGLE" title="Market intel, translated into your pitch">
            {data.scoops.map((s: any, i: number) => {
              const meta = signalMeta(s.type);
              return (
                <div key={i} style={{ padding: "14px 0", borderTop: `1px solid ${T.panelEdge}` }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: meta.color, background: meta.soft, border: `1px solid ${meta.color}33`, borderRadius: 5, padding: "2px 8px" }}>{meta.label}</span>
                    {(s.sourceDate || s.date) && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>{s.sourceDate || s.date}</span>}
                    <SourceLink url={s.sourceUrl} name={s.sourceName} />
                  </div>
                  <div style={{ color: T.ink, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{s.headline}</div>
                  <div style={{ color: T.ink, fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.dim }}>MEANS FOR THEM · </span>{s.meansForTarget}
                  </div>
                  <div style={{ color: meta.color, fontSize: 13, lineHeight: 1.6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1 }}>YOUR ANGLE · </span>{s.yourAngle}
                  </div>
                </div>
              );
            })}
          </Panel>
        )}

        {/* Plays by role */}
        {data?.plays?.length > 0 && (
          <Panel kicker="03 / PLAYS BY ROLE" title="Who says what — SDR, AE, CSM">
            {data.plays.map((p: any, i: number) => (
              <div key={i} style={{ padding: "14px 0", borderTop: `1px solid ${T.panelEdge}` }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, color: roleColor(p.role), border: `1px solid ${roleColor(p.role)}`, borderRadius: 5, padding: "2px 9px" }}>{p.role}</span>
                  <span style={{ color: T.dim, fontSize: 12.5, fontFamily: T.mono }}>→ {p.who}</span>
                </div>
                <div style={{ color: T.dim, fontSize: 12.5, margin: "8px 0 4px" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.amber }}>HOOK · </span>{p.hook}
                </div>
                <div style={{ borderLeft: `2px solid ${roleColor(p.role)}`, paddingLeft: 12, margin: "8px 0 2px", color: T.ink, fontSize: 13.5, lineHeight: 1.65, fontStyle: "italic" }}>{p.message}</div>
                <div style={{ marginTop: 8 }}><CopyBtn label="COPY MESSAGE" getText={() => p.message} /></div>
              </div>
            ))}
            <div style={{ textAlign: "center", color: T.dim, fontFamily: T.mono, fontSize: 11, letterSpacing: 1, marginTop: 24 }}>
              BUILT BY SRI · LIVE WEB RESEARCH, NO DATABASE · WANT SIGNALS MONITORED WEEKLY? LET&apos;S TALK
            </div>
          </Panel>
        )}

        {/* ══════════ BATTLECARD RESULTS ══════════ */}

        {/* Win Brief */}
        {bcData?.narrative && (
          <Panel kicker="⚔ WIN BRIEF" title={`How to beat ${bcData.competitor?.name || "them"}`}>
            <div style={{ color: T.ink, fontSize: 14.5, lineHeight: 1.8, marginBottom: bcData.killShot ? 16 : 0 }}>
              {bcData.narrative}
            </div>
            {bcData.killShot && (
              <div style={{ background: T.redSoft, border: `1px solid ${T.red}33`, borderLeft: `3px solid ${T.red}`, borderRadius: 8, padding: "12px 14px", marginTop: 4 }}>
                <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.red, marginBottom: 6 }}>KILL SHOT — say this when they name {bcData.competitor?.name} as the frontrunner</div>
                <div style={{ color: T.ink, fontSize: 14, lineHeight: 1.65, fontStyle: "italic" }}>{bcData.killShot}</div>
                <div style={{ marginTop: 8 }}><CopyBtn label="COPY KILL SHOT" getText={() => bcData.killShot} /></div>
              </div>
            )}
          </Panel>
        )}

        {/* Team Brief — SDR / AE / CSM */}
        {bcData?.teamBrief && Object.keys(bcData.teamBrief).length > 0 && (
          <Panel kicker="AI TEAM BRIEF" title="Role-by-role competitive playbook">
            {[
              { key: "sdr", label: "SDR", color: T.amber },
              { key: "ae",  label: "AE",  color: T.blue  },
              { key: "csm", label: "CSM", color: T.green },
            ].map(({ key, label, color }) => bcData.teamBrief[key] && (
              <div key={key} style={{ padding: "14px 0", borderTop: `1px solid ${T.panelEdge}` }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 5, padding: "2px 9px" }}>{label}</span>
                </div>
                <div style={{ borderLeft: `2px solid ${color}`, paddingLeft: 12, color: T.ink, fontSize: 13.5, lineHeight: 1.7 }}>
                  {bcData.teamBrief[key]}
                </div>
                <div style={{ marginTop: 8 }}><CopyBtn label={`COPY ${label} BRIEF`} getText={() => bcData.teamBrief[key]} /></div>
              </div>
            ))}
          </Panel>
        )}

        {/* Competitor profile */}
        {(bcData?.strengths?.length > 0 || bcData?.weaknesses?.length > 0) && (
          <Panel kicker="01 / COMPETITOR PROFILE" title={bcData.competitor?.name || "Competitor"}>
            {bcData.competitor?.tagline && (
              <div style={{ color: T.dim, fontSize: 13.5, fontStyle: "italic", margin: "-8px 0 4px" }}>{bcData.competitor.tagline}</div>
            )}
            <div style={{ color: T.dim, fontSize: 12.5, marginBottom: 16 }}>
              <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1 }}>HOW THEY POSITION · </span>
              {bcData.competitor?.positioning}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <SectionLabel>THEIR STRENGTHS</SectionLabel>
                {(bcData.strengths || []).map((s: any, i: number) => (
                  <div key={i} style={{ color: T.ink, fontSize: 13, lineHeight: 1.7, padding: "5px 0", borderBottom: `1px solid ${T.panelEdge}`, display: "flex", gap: 8 }}>
                    <span style={{ color: T.dim, flexShrink: 0, marginTop: 1 }}>△</span>
                    <span>{s.text}<SourceLink url={s.sourceUrl} name={s.sourceName} /></span>
                  </div>
                ))}
              </div>
              <div>
                <SectionLabel color={T.red}>THEIR WEAK SPOTS</SectionLabel>
                {(bcData.weaknesses || []).map((w: any, i: number) => (
                  <div key={i} style={{ color: T.ink, fontSize: 13, lineHeight: 1.7, padding: "5px 0", borderBottom: `1px solid ${T.panelEdge}`, display: "flex", gap: 8 }}>
                    <span style={{ color: T.red, flexShrink: 0, marginTop: 1 }}>✕</span>
                    <span>{w.text}<SourceLink url={w.sourceUrl} name={w.sourceName} /></span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        )}

        {/* Head-to-head */}
        {bcData?.comparison?.length > 0 && (
          <Panel kicker="02 / HEAD-TO-HEAD" title="Where you win">
            <div style={{ border: `1px solid ${T.panelEdge}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr" }}>
                <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.dim, background: "rgba(255,255,255,0.03)", padding: "9px 14px", borderBottom: `1px solid ${T.panelEdge}` }}>DIMENSION</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.green, background: "rgba(255,255,255,0.03)", padding: "9px 14px", borderBottom: `1px solid ${T.panelEdge}`, borderLeft: `1px solid ${T.panelEdge}` }}>US</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.red, background: "rgba(255,255,255,0.03)", padding: "9px 14px", borderBottom: `1px solid ${T.panelEdge}`, borderLeft: `1px solid ${T.panelEdge}` }}>THEM</div>
              </div>
              {bcData.comparison.map((row: any, i: number) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${T.panelEdge}` }}>
                  <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.amber, padding: "11px 14px", lineHeight: 1.5 }}>{row.category}</div>
                  <div style={{ fontSize: 13, color: T.green, padding: "11px 14px", borderLeft: `1px solid ${T.panelEdge}`, lineHeight: 1.5 }}>{row.us}</div>
                  <div style={{ fontSize: 13, color: T.dim, padding: "11px 14px", borderLeft: `1px solid ${T.panelEdge}`, lineHeight: 1.5 }}>{row.them}</div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Objection handles */}
        {bcData?.objections?.length > 0 && (
          <Panel kicker="03 / OBJECTION HANDLES" title="When they say this — you say that">
            {bcData.objections.map((obj: any, i: number) => (
              <div key={i} style={{ padding: "14px 0", borderTop: i > 0 ? `1px solid ${T.panelEdge}` : "none" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.red, flexShrink: 0, paddingTop: 3 }}>THEY SAY</span>
                  <span style={{ color: T.ink, fontSize: 13.5, fontStyle: "italic" }}>&ldquo;{obj.objection}&rdquo;</span>
                </div>
                <div style={{ borderLeft: `2px solid ${T.green}`, paddingLeft: 14, color: T.ink, fontSize: 13.5, lineHeight: 1.65 }}>
                  {obj.handle}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                  <CopyBtn label="COPY HANDLE" getText={() => obj.handle} />
                  <SourceLink url={obj.sourceUrl} name={obj.sourceName} />
                </div>
              </div>
            ))}
          </Panel>
        )}

        {/* Discovery landmines */}
        {bcData?.landmines?.length > 0 && (
          <Panel kicker="04 / DISCOVERY LANDMINES" title="Questions that expose their gaps">
            {bcData.landmines.map((lm: any, i: number) => (
              <div key={i} style={{ padding: "12px 0", borderTop: i > 0 ? `1px solid ${T.panelEdge}` : "none" }}>
                <div style={{ color: T.amber, fontSize: 14, lineHeight: 1.6, marginBottom: 6, fontStyle: "italic" }}>
                  &ldquo;{lm.question}&rdquo;
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>REVEALS · {lm.why}</div>
                <div style={{ marginTop: 8 }}><CopyBtn label="COPY QUESTION" getText={() => lm.question} /></div>
              </div>
            ))}
          </Panel>
        )}

        {/* Proof points */}
        {bcData?.proofPoints?.length > 0 && (
          <Panel kicker="05 / PROOF POINTS" title="Evidence to use in the deal">
            {bcData.proofPoints.map((pp: any, i: number) => (
              <div key={i} style={{ color: T.ink, fontSize: 13.5, lineHeight: 1.7, padding: "7px 0", borderBottom: `1px solid ${T.panelEdge}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ color: T.green, flexShrink: 0, marginTop: 2 }}>→</span>
                <span>{pp.claim}<SourceLink url={pp.sourceUrl} name={pp.sourceName} /></span>
              </div>
            ))}
            <div style={{ textAlign: "center", color: T.dim, fontFamily: T.mono, fontSize: 11, letterSpacing: 1, marginTop: 24 }}>
              BUILT BY SRI · LIVE WEB RESEARCH, NO DATABASE · WANT BATTLECARDS REFRESHED WEEKLY? LET&apos;S TALK
            </div>
          </Panel>
        )}

        {/* Empty state */}
        {!data && !bcData && !loading && !error && (
          <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 12, textAlign: "center", padding: "40px 16px", border: `1px dashed ${T.panelEdge}`, borderRadius: 12, lineHeight: 2 }}>
            {activeMode === "intel"
              ? "Paste your target's URL + what you sell — get an AI sales brief, live signals across funding / leadership / product, and pitch plays by role"
              : "Enter a competitor name or URL — get their weak spots, objection handles, landmines, and a role-by-role competitive brief"}
          </div>
        )}
      </div>
    </div>
  );
}
