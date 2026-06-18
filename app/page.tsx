"use client";

import { useState, useEffect, useRef } from "react";

const T = {
  bg: "#0E1420", panel: "#151D2E", panelEdge: "#243044", ink: "#EDF1F7",
  dim: "#8B96A8", amber: "#F5A524", amberSoft: "rgba(245,165,36,0.12)",
  green: "#4ADE80", red: "#F87171",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  display: "'Space Grotesk', system-ui, sans-serif",
  body: "'Inter', system-ui, -apple-system, sans-serif",
};

const STAGES = [
  "Researching the target account…",
  "Detecting their tech stack…",
  "Scanning news sources for live signals…",
  "Translating signals into your pitch angles…",
  "Writing plays for SDR, AE and CSM…",
  "Compiling the executive brief…",
];

const roleColor = (r: string) => (r === "SDR" ? T.amber : r === "AE" ? "#7DC4F7" : T.green);

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

function Panel({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 12, padding: "20px 22px", marginBottom: 14 }}>
      <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1.5, color: T.amber, marginBottom: 4 }}>{kicker}</div>
      <div style={{ fontFamily: T.display, fontSize: 17, fontWeight: 600, color: T.ink, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function List({ label, items }: { label: string; items?: { text: string; sourceUrl?: string | null; sourceName?: string | null; sourceDate?: string | null }[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.dim, margin: "0 0 6px" }}>{label}</div>
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

export default function Home() {
  const [url, setUrl] = useState("");
  const [selling, setSelling] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => {
    clearInterval(timer.current);
    if (loading) {
      setStage(0);
      timer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 6000);
    }
    return () => clearInterval(timer.current);
  }, [loading]);

  const run = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "target", url: url.trim(), selling: selling.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Engine error");
      setData(json);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body, padding: "0 0 80px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
        input::placeholder { color: #5A6478; }
        @keyframes pulse { 0%,100%{opacity:.35} 50%{opacity:1} }
      `}</style>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "56px 20px 0" }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.amber, marginBottom: 10 }}>
          WHY NOW · THE GTM SEARCH ENGINE
        </div>
        <h1 style={{ fontFamily: T.display, fontSize: 34, fontWeight: 700, color: T.ink, margin: "0 0 10px", lineHeight: 1.15 }}>
          Paste your target&apos;s URL.<br />Get the signals — and the pitch.
        </h1>
        <p style={{ color: T.dim, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 28px", maxWidth: 600 }}>
          Live research from real news sources — every signal dated and linked to where it was found. The engine
          profiles your target, detects their tech stack, and translates market moves into pitch angles with
          plays for SDR, AE and CSM.
        </p>

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

        {loading && (
          <div style={{ background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 12, padding: "18px 22px", marginBottom: 14 }}>
            {STAGES.slice(0, stage + 1).map((m, i) => (
              <div key={i} style={{ fontFamily: T.mono, fontSize: 12.5, lineHeight: 2, color: i === stage ? T.amber : T.dim, animation: i === stage ? "pulse 1.4s infinite" : "none" }}>
                {i < stage ? "✓" : "›"} {m}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ color: T.red, fontFamily: T.mono, fontSize: 13, border: `1px solid ${T.red}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>{error}</div>
        )}

        {(data?.summary?.narrative || data?.summary?.tldr?.length > 0) && (
          <Panel kicker="⚡ EXECUTIVE BRIEF" title="The 15-second version">
            {data.summary.narrative && (
              <div style={{ color: T.ink, fontSize: 15, lineHeight: 1.7, marginBottom: 14 }}>
                {data.summary.narrative}
              </div>
            )}
            {data.summary.tldr?.map((l: string, i: number) => (
              <div key={i} style={{ color: T.dim, fontSize: 13.5, lineHeight: 1.8 }}>· {l}</div>
            ))}
            <div style={{ color: T.amber, fontSize: 13.5, marginTop: 10, fontFamily: T.mono }}>→ {data.summary.topAction}</div>
          </Panel>
        )}

        {data?.techStack?.length > 0 && (
          <div style={{ margin: "0 0 14px" }}>
            <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.dim, marginRight: 10 }}>DETECTED ON THEIR SITE:</span>
            {data.techStack.map((t: string, i: number) => (
              <span key={i} style={{ fontFamily: T.mono, fontSize: 11, color: T.amber, background: T.amberSoft, border: `1px solid ${T.panelEdge}`, borderRadius: 5, padding: "3px 9px", marginRight: 6, display: "inline-block", marginBottom: 6 }}>{t}</span>
            ))}
          </div>
        )}

        {data?.profile && (
          <Panel kicker="01 / TARGET PROFILE" title={data.profile.company?.name || ""}>
            <div style={{ color: T.dim, fontSize: 14, margin: "-8px 0 14px" }}>{data.profile.company?.oneLiner}</div>
            <List label="THEIR STRATEGIC PRIORITIES" items={data.profile.priorities} />
            <List label="RECENT MOVES" items={data.profile.recentMoves} />
            <List label="PRESSURES THEY FACE" items={data.profile.pressures} />
          </Panel>
        )}

        {data?.scoops?.length > 0 && (
          <Panel kicker="02 / SIGNAL → INSIGHT → ANGLE" title="Market intel, translated into your pitch">
            {data.scoops.map((s: any, i: number) => (
              <div key={i} style={{ padding: "14px 0", borderTop: `1px solid ${T.panelEdge}` }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.amber, background: T.amberSoft, borderRadius: 5, padding: "2px 8px" }}>{s.type}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.amber }}>{s.sourceDate || s.date}</span>
                  <SourceLink url={s.sourceUrl} name={s.sourceName} />
                </div>
                <div style={{ color: T.ink, fontSize: 14, fontWeight: 600, margin: "7px 0 6px" }}>{s.headline}</div>
                <div style={{ color: T.ink, fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.dim }}>MEANS FOR THEM · </span>{s.meansForTarget}
                </div>
                <div style={{ color: T.amber, fontSize: 13, lineHeight: 1.6 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1 }}>YOUR ANGLE · </span>{s.yourAngle}
                </div>
              </div>
            ))}
          </Panel>
        )}

        {data?.plays?.length > 0 && (
          <Panel kicker="03 / PLAYS BY ROLE" title="Who says what — SDR, AE, CSM">
            {data.plays.map((p: any, i: number) => (
              <div key={i} style={{ padding: "14px 0", borderTop: `1px solid ${T.panelEdge}` }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 600, color: roleColor(p.role), border: `1px solid ${roleColor(p.role)}`, borderRadius: 5, padding: "2px 9px" }}>{p.role}</span>
                  <span style={{ color: T.dim, fontSize: 12.5, fontFamily: T.mono }}>→ {p.who}</span>
                </div>
                <div style={{ color: T.dim, fontSize: 12.5, margin: "8px 0 4px" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.amber }}>HOOK · </span>{p.hook}</div>
                <div style={{ borderLeft: `2px solid ${roleColor(p.role)}`, paddingLeft: 12, margin: "8px 0 2px", color: T.ink, fontSize: 13.5, lineHeight: 1.65, fontStyle: "italic" }}>{p.message}</div>
                <div style={{ marginTop: 8 }}><CopyBtn label="COPY MESSAGE" getText={() => p.message} /></div>
              </div>
            ))}
            <div style={{ textAlign: "center", color: T.dim, fontFamily: T.mono, fontSize: 11, letterSpacing: 1, marginTop: 24 }}>
              BUILT BY SRI · LIVE WEB RESEARCH, NO DATABASE · WANT SIGNALS MONITORED WEEKLY? LET&apos;S TALK
            </div>
          </Panel>
        )}

        {!data && !loading && !error && (
          <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 12, textAlign: "center", padding: "40px 16px", border: `1px dashed ${T.panelEdge}`, borderRadius: 12, lineHeight: 2 }}>
            Paste your target&apos;s URL + what you sell — get their pressures, tech stack, dated signals with sources, and pitch angles by role
          </div>
        )}
      </div>
    </div>
  );
}
