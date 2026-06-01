'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────
interface Contact {
  id: string
  name: string
  title: string
  department: string
  linkedin_url: string
  linkedin_verified: boolean
  email_guess: string
  email_pattern: string
  email_confidence: 'high' | 'medium' | 'low'
  role_in_deal: string
  outreach_message: string
}

interface Signal {
  id: string
  signal_type: string
  title: string
  summary: string
  source_name: string
  source_url: string
  source_verified: boolean
  signal_date: string
  is_new: boolean
}

interface GTMBrief {
  executive_summary: string
  business_model: string
  gtm_motion: string
  pain_points: Array<{ title: string; description: string; severity: string }>
  tech_stack: Array<{ category: string; tool: string; confidence: string }>
  buying_signals: Array<{ signal: string; source: string; source_url: string }>
  discovery_questions: string[]
  outreach_angles: Array<{ title: string; description: string }>
  cold_email: string
  linkedin_message: string
  call_script: string
  objections: Array<{ objection: string; counter: string }>
}

interface Prospect {
  id: string
  company_name: string
  domain: string
  industry: string
  size: string
  stage: string
  hq: string
  linkedin_url: string
  description: string
  priority_score: number
  last_researched_at: string
  contacts: Contact[]
  signals: Signal[]
  gtm_briefs: GTMBrief[]
}

interface Profile {
  id: string
  name: string
  email: string
  product_description: string
  target_industries: string[]
  notify_daily: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const SIGNAL_COLORS: Record<string, string> = {
  funding: '#16a34a', hiring: '#2563eb', product_launch: '#9333ea',
  leadership_change: '#ea580c', expansion: '#0891b2', partnership: '#65a30d',
  press: '#6b7280', financial: '#b45309', competitive: '#dc2626', other: '#6b6b80',
}

const SIGNAL_LABELS: Record<string, string> = {
  funding: 'Funding', hiring: 'Hiring', product_launch: 'Product Launch',
  leadership_change: 'Leadership', expansion: 'Expansion', partnership: 'Partnership',
  press: 'Press', financial: 'Financial', competitive: 'Competitive', other: 'Signal',
}

const ROLE_COLORS: Record<string, string> = {
  champion: '#16a34a', blocker: '#dc2626', influencer: '#2563eb', evaluator: '#b45309',
}

const CONFIDENCE_COLORS = { high: '#16a34a', medium: '#b45309', low: '#dc2626' }

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded"
      style={{ background: color + '20', color }}>
      {text}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="text-xs px-3 py-1 rounded font-medium transition-all"
      style={{ background: copied ? '#16a34a20' : '#1a1a24', color: copied ? '#16a34a' : '#6b6b80', border: '1px solid #2a2a38' }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [selected, setSelected] = useState<Prospect | null>(null)
  const [activeTab, setActiveTab] = useState<'brief' | 'contacts' | 'signals' | 'outreach'>('brief')
  const [searchInput, setSearchInput] = useState('')
  const [researching, setResearching] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [loadingProspects, setLoadingProspects] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load profile from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('gtm_profile')
    if (!stored) { router.push('/setup'); return }
    setProfile(JSON.parse(stored))
  }, [router])

  // Load prospects
  const loadProspects = useCallback(async () => {
    if (!profile) return
    setLoadingProspects(true)
    const res = await fetch(`/api/prospects?profile_id=${profile.id}`)
    const data = await res.json()
    setProspects(data.prospects || [])
    setLoadingProspects(false)
  }, [profile])

  useEffect(() => { if (profile) loadProspects() }, [profile, loadProspects])

  // Research a new company
  const runResearch = async () => {
    if (!searchInput.trim() || !profile) return
    setResearching(true)
    setError(null)
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: searchInput.trim(), profile_id: profile.id }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSearchInput('')
      await loadProspects()
      // Auto-select the new prospect
      if (data.prospect_id) {
        const updated = await fetch(`/api/prospects?profile_id=${profile.id}`)
        const updatedData = await updated.json()
        const all: Prospect[] = updatedData.prospects || []
        setProspects(all)
        const newOne = all.find(p => p.id === data.prospect_id)
        if (newOne) setSelected(newOne)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Research failed')
    } finally {
      setResearching(false)
    }
  }

  // Manual refresh all signals
  const refreshAll = async () => {
    setRefreshingAll(true)
    try {
      await fetch('/api/cron/daily-refresh', {
        headers: { authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || 'manual'}` }
      })
      await loadProspects()
    } finally {
      setRefreshingAll(false)
    }
  }

  const removeProspect = async (id: string) => {
    await fetch(`/api/prospects?id=${id}`, { method: 'DELETE' })
    setProspects(p => p.filter(x => x.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const newSignalCount = prospects.reduce((acc, p) => acc + (p.signals?.filter(s => s.is_new).length || 0), 0)
  const brief = selected?.gtm_briefs?.[0]

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0f' }}>

      {/* ── SIDEBAR ── */}
      <div className="w-72 flex flex-col flex-shrink-0" style={{ background: '#0d0d14', borderRight: '1px solid #1a1a24' }}>

        {/* Logo */}
        <div className="p-5 flex items-center justify-between" style={{ borderBottom: '1px solid #1a1a24' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: '#6c63ff' }}>
              <span className="text-white text-xs font-bold">G</span>
            </div>
            <span className="font-display font-bold text-white text-base">GTM Intel</span>
          </div>
          {newSignalCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#6c63ff', color: 'white' }}>
              {newSignalCount}
            </span>
          )}
        </div>

        {/* Profile pill */}
        {profile && (
          <div className="mx-4 mt-4 p-3 rounded-lg" style={{ background: '#1a1a24' }}>
            <p className="text-xs font-semibold text-white truncate">{profile.name}</p>
            <p className="text-xs mt-0.5 truncate" style={{ color: '#6b6b80' }}>{profile.product_description.slice(0, 60)}...</p>
          </div>
        )}

        {/* Search input */}
        <div className="p-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Research a company..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runResearch()}
              className="w-full pl-3 pr-10 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
            />
            <button
              onClick={runResearch}
              disabled={researching || !searchInput.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center transition-all"
              style={{ background: '#6c63ff', opacity: (!searchInput.trim() || researching) ? 0.5 : 1 }}
            >
              {researching
                ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                : <span className="text-white text-xs">→</span>
              }
            </button>
          </div>
          {error && <p className="text-xs mt-2" style={{ color: '#ff6584' }}>{error}</p>}
        </div>

        {/* Prospect list */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {loadingProspects ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#2a2a38', borderTopColor: '#6c63ff' }} />
            </div>
          ) : prospects.length === 0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-xs" style={{ color: '#6b6b80' }}>No prospects yet. Search for a company above to get started.</p>
            </div>
          ) : (
            prospects.map(p => {
              const newSigs = p.signals?.filter(s => s.is_new).length || 0
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p); setActiveTab('brief') }}
                  className="w-full text-left p-3 rounded-lg mb-1 transition-all group"
                  style={{
                    background: selected?.id === p.id ? '#6c63ff15' : 'transparent',
                    border: `1px solid ${selected?.id === p.id ? '#6c63ff40' : 'transparent'}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{p.company_name}</p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: '#6b6b80' }}>{p.industry} · {p.stage}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {newSigs > 0 && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#6c63ff', color: 'white', fontSize: '10px' }}>
                          {newSigs}
                        </span>
                      )}
                      <span className="text-xs font-bold" style={{ color: p.priority_score >= 8 ? '#16a34a' : p.priority_score >= 6 ? '#b45309' : '#6b6b80' }}>
                        {p.priority_score}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 space-y-2" style={{ borderTop: '1px solid #1a1a24' }}>
          <button
            onClick={refreshAll}
            disabled={refreshingAll || prospects.length === 0}
            className="w-full py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2"
            style={{ background: '#1a1a24', color: '#6b6b80', border: '1px solid #2a2a38' }}
          >
            {refreshingAll ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : '↻'}
            Refresh all signals
          </button>
          <button
            onClick={() => { localStorage.clear(); router.push('/setup') }}
            className="w-full py-2 rounded-lg text-xs font-medium"
            style={{ background: 'transparent', color: '#6b6b80' }}
          >
            ← Switch profile
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={{ background: '#6c63ff20' }}>
              <span className="text-3xl">🔍</span>
            </div>
            <h2 className="font-display text-2xl font-bold text-white mb-3">
              {researching ? 'Researching...' : 'Select or search a prospect'}
            </h2>
            {researching ? (
              <div className="space-y-2 text-sm" style={{ color: '#6b6b80' }}>
                <p>Running live research across verified sources...</p>
                <p>Finding contacts, signals, and outreach angles</p>
                <div className="flex justify-center mt-4">
                  <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#2a2a38', borderTopColor: '#6c63ff' }} />
                </div>
              </div>
            ) : (
              <p className="text-sm max-w-sm" style={{ color: '#6b6b80' }}>
                Type a company name in the search box and hit enter. We&apos;ll research the company, find contacts with LinkedIn profiles, surface buying signals, and generate personalized outreach — all from verified sources.
              </p>
            )}
          </div>
        ) : (
          <div className="p-6 max-w-4xl">

            {/* Company header */}
            <div className="mb-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="font-display text-2xl font-bold text-white">{selected.company_name}</h1>
                    <span className="text-lg font-bold" style={{ color: selected.priority_score >= 8 ? '#16a34a' : '#b45309' }}>
                      {selected.priority_score}/10
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {selected.industry && <Badge text={selected.industry} color="#6c63ff" />}
                    {selected.stage && <Badge text={selected.stage} color="#b45309" />}
                    {selected.size && <Badge text={selected.size} color="#16a34a" />}
                    {selected.hq && <Badge text={selected.hq} color="#0891b2" />}
                  </div>
                  {selected.linkedin_url && (
                    <a href={selected.linkedin_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{ background: '#0077b520', color: '#0077b5', border: '1px solid #0077b530' }}>
                      <span>in</span> Company LinkedIn ↗
                    </a>
                  )}
                </div>
                <button onClick={() => removeProspect(selected.id)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: '#dc262620', color: '#dc2626', border: '1px solid #dc262630' }}>
                  Remove
                </button>
              </div>
              {selected.description && (
                <p className="text-sm mt-3" style={{ color: '#9ca3af' }}>{selected.description}</p>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 p-1 rounded-lg" style={{ background: '#1a1a24' }}>
              {(['brief', 'contacts', 'signals', 'outreach'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className="flex-1 py-2 rounded-md text-xs font-semibold capitalize transition-all"
                  style={{
                    background: activeTab === tab ? '#6c63ff' : 'transparent',
                    color: activeTab === tab ? 'white' : '#6b6b80',
                  }}>
                  {tab}
                  {tab === 'signals' && selected.signals?.filter(s => s.is_new).length > 0 && (
                    <span className="ml-1 text-xs font-bold px-1 rounded-full" style={{ background: 'white', color: '#6c63ff' }}>
                      {selected.signals.filter(s => s.is_new).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── TAB: BRIEF ── */}
            {activeTab === 'brief' && brief && (
              <div className="space-y-5 animate-in">
                <Section title="Executive Summary">
                  <p className="text-sm leading-relaxed" style={{ color: '#c0c0d4' }}>{brief.executive_summary}</p>
                </Section>
                <Section title="Pain Points">
                  <div className="space-y-3">
                    {brief.pain_points?.map((p, i) => (
                      <div key={i} className="p-4 rounded-lg" style={{ background: '#1a1a24' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-white">{p.title}</span>
                          <Badge text={p.severity} color={p.severity === 'high' ? '#dc2626' : p.severity === 'medium' ? '#b45309' : '#6b6b80'} />
                        </div>
                        <p className="text-xs" style={{ color: '#9ca3af' }}>{p.description}</p>
                      </div>
                    ))}
                  </div>
                </Section>
                <Section title="Tech Stack (Assumed)">
                  <div className="grid grid-cols-2 gap-2">
                    {brief.tech_stack?.map((t, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: '#1a1a24' }}>
                        <div>
                          <p className="text-xs font-mono" style={{ color: '#6b6b80' }}>{t.category}</p>
                          <p className="text-sm font-medium text-white">{t.tool}</p>
                        </div>
                        <Badge text={t.confidence} color={t.confidence === 'high' ? '#16a34a' : '#b45309'} />
                      </div>
                    ))}
                  </div>
                </Section>
                <Section title="Discovery Questions">
                  <ol className="space-y-2">
                    {brief.discovery_questions?.map((q, i) => (
                      <li key={i} className="flex gap-3 text-sm" style={{ color: '#c0c0d4' }}>
                        <span className="font-mono text-xs mt-0.5 flex-shrink-0" style={{ color: '#6c63ff' }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {q}
                      </li>
                    ))}
                  </ol>
                </Section>
              </div>
            )}

            {/* ── TAB: CONTACTS ── */}
            {activeTab === 'contacts' && (
              <div className="space-y-4 animate-in">
                {(!selected.contacts || selected.contacts.length === 0) ? (
                  <p className="text-sm" style={{ color: '#6b6b80' }}>No contacts found for this prospect.</p>
                ) : selected.contacts.map(c => (
                  <div key={c.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid #2a2a38' }}>
                    <div className="flex items-center justify-between p-4" style={{ background: '#111118' }}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                          style={{ background: '#6c63ff' }}>
                          {c.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-semibold text-white text-sm">{c.name}</p>
                          <p className="text-xs" style={{ color: '#9ca3af' }}>{c.title}</p>
                        </div>
                      </div>
                      {c.role_in_deal && (
                        <Badge text={c.role_in_deal} color={ROLE_COLORS[c.role_in_deal] || '#6b6b80'} />
                      )}
                    </div>
                    <div className="p-4 space-y-3" style={{ background: '#13131c' }}>
                      {/* LinkedIn */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: '#6b6b80' }}>LinkedIn</p>
                          {c.linkedin_url ? (
                            <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                              className="text-xs font-medium" style={{ color: '#0077b5' }}>
                              {c.linkedin_url.replace('https://www.linkedin.com/in/', 'linkedin.com/in/')} ↗
                            </a>
                          ) : <p className="text-xs" style={{ color: '#6b6b80' }}>Not found</p>}
                        </div>
                        {c.linkedin_verified
                          ? <Badge text="✓ Verified" color="#16a34a" />
                          : <Badge text="⚠ Verify first" color="#b45309" />
                        }
                      </div>
                      {/* Email */}
                      <div className="rounded-lg p-3" style={{ background: '#1a1a24' }}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-mono uppercase tracking-wider" style={{ color: '#6b6b80' }}>Email (guessed)</p>
                          <Badge
                            text={`${c.email_confidence} confidence`}
                            color={CONFIDENCE_COLORS[c.email_confidence] || '#6b6b80'}
                          />
                        </div>
                        <p className="text-sm font-mono text-white mb-1">{c.email_guess}</p>
                        <p className="text-xs" style={{ color: '#6b6b80' }}>
                          Pattern: {c.email_pattern} · Verify at{' '}
                          <a href="https://email-checker.net" target="_blank" rel="noreferrer" style={{ color: '#6c63ff' }}>
                            email-checker.net
                          </a>
                        </p>
                        <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: '#2a2a38' }}>
                          <div className="h-full rounded-full" style={{
                            width: c.email_confidence === 'high' ? '85%' : c.email_confidence === 'medium' ? '55%' : '28%',
                            background: CONFIDENCE_COLORS[c.email_confidence] || '#6b6b80'
                          }} />
                        </div>
                        <p className="text-xs mt-1" style={{ color: '#6b6b80' }}>
                          ⚠ Pattern-guessed · Not verified · May bounce
                        </p>
                      </div>
                      {/* Outreach */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-mono uppercase tracking-wider" style={{ color: '#6b6b80' }}>Personalized outreach</p>
                          <CopyButton text={c.outreach_message} />
                        </div>
                        <div className="rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap" style={{ background: '#1a1a24', color: '#c0c0d4' }}>
                          {c.outreach_message}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── TAB: SIGNALS ── */}
            {activeTab === 'signals' && (
              <div className="space-y-3 animate-in">
                {(!selected.signals || selected.signals.length === 0) ? (
                  <p className="text-sm" style={{ color: '#6b6b80' }}>No signals yet. Run a refresh to check for new news.</p>
                ) : [...selected.signals].sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0)).map(s => (
                  <div key={s.id} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${s.is_new ? '#6c63ff40' : '#2a2a38'}` }}>
                    <div className="flex items-start gap-3 p-4">
                      <Badge text={SIGNAL_LABELS[s.signal_type] || s.signal_type} color={SIGNAL_COLORS[s.signal_type] || '#6b6b80'} />
                      {s.is_new && <Badge text="NEW" color="#6c63ff" />}
                      {s.source_verified && <Badge text="✓ Verified source" color="#16a34a" />}
                    </div>
                    <div className="px-4 pb-4">
                      <p className="text-sm font-semibold text-white mb-1">{s.title}</p>
                      <p className="text-sm mb-3" style={{ color: '#9ca3af' }}>{s.summary}</p>
                      <div className="flex items-center gap-3">
                        {s.source_url ? (
                          <a href={s.source_url} target="_blank" rel="noreferrer"
                            className="text-xs font-medium" style={{ color: '#6c63ff' }}>
                            {s.source_name} ↗
                          </a>
                        ) : (
                          <span className="text-xs" style={{ color: '#6b6b80' }}>{s.source_name}</span>
                        )}
                        {s.signal_date && <span className="text-xs" style={{ color: '#6b6b80' }}>{s.signal_date}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── TAB: OUTREACH ── */}
            {activeTab === 'outreach' && brief && (
              <div className="space-y-5 animate-in">
                <Section title="Cold Email">
                  <div className="flex justify-end mb-2"><CopyButton text={brief.cold_email} /></div>
                  <div className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap" style={{ background: '#1a1a24', color: '#c0c0d4' }}>
                    {brief.cold_email}
                  </div>
                </Section>
                <Section title="LinkedIn Message">
                  <div className="flex justify-end mb-2"><CopyButton text={brief.linkedin_message} /></div>
                  <div className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap" style={{ background: '#1a1a24', color: '#c0c0d4' }}>
                    {brief.linkedin_message}
                  </div>
                </Section>
                <Section title="Call Opening Script">
                  <div className="flex justify-end mb-2"><CopyButton text={brief.call_script} /></div>
                  <div className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap" style={{ background: '#1a1a24', color: '#c0c0d4' }}>
                    {brief.call_script}
                  </div>
                </Section>
                <Section title="Objection Handling">
                  <div className="space-y-3">
                    {brief.objections?.map((o, i) => (
                      <div key={i} className="rounded-lg overflow-hidden" style={{ border: '1px solid #2a2a38' }}>
                        <div className="p-3" style={{ background: '#1a1a24' }}>
                          <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: '#dc2626' }}>Objection</p>
                          <p className="text-sm" style={{ color: '#e8e8f0' }}>{o.objection}</p>
                        </div>
                        <div className="p-3" style={{ background: '#13131c' }}>
                          <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: '#16a34a' }}>Counter</p>
                          <p className="text-sm" style={{ color: '#9ca3af' }}>{o.counter}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
                <Section title="Outreach Angles">
                  <div className="grid grid-cols-2 gap-3">
                    {brief.outreach_angles?.map((a, i) => (
                      <div key={i} className="p-4 rounded-lg" style={{ background: '#1a1a24' }}>
                        <p className="text-sm font-semibold text-white mb-1">{a.title}</p>
                        <p className="text-xs" style={{ color: '#9ca3af' }}>{a.description}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #2a2a38' }}>
      <div className="px-4 py-3" style={{ background: '#111118', borderBottom: '1px solid #1a1a24' }}>
        <p className="text-xs font-mono uppercase tracking-widest font-semibold" style={{ color: '#6b6b80' }}>{title}</p>
      </div>
      <div className="p-4" style={{ background: '#13131c' }}>{children}</div>
    </div>
  )
}
