'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ────────────────────────────────────────────────────────────────────
interface Contact {
  id: string; name: string; title: string; department: string
  linkedin_url: string; linkedin_verified: boolean
  email_guess: string; email_pattern: string; email_confidence: 'high'|'medium'|'low'
  role_in_deal: string; outreach_message: string
}
interface Signal {
  id: string; signal_type: string; title: string; summary: string
  source_name: string; source_url: string; source_verified: boolean
  signal_date: string; is_new: boolean
}
interface GTMScoop {
  type: string; headline: string; detail: string
  why_it_matters: string; source: string; source_url: string; date: string
}
interface GTMScoop {
  type: string; headline: string; detail: string
  why_it_matters: string; source: string; source_url: string; date: string
}
interface JobSignal {
  title: string; tools_mentioned: string[]; signals: string[]; url: string
}
interface GTMBrief {
  executive_summary: string; business_model: string; gtm_motion: string
  gtm_scoops: GTMScoop[]
  pain_points: Array<{title: string; description: string; severity: string}>
  tech_stack: Array<{category: string; tool: string; confidence: string; verified?: boolean; source?: string}>
  buying_signals: Array<{signal: string; why_it_matters?: string; source: string; source_url: string; date?: string}>
  discovery_questions: string[]
  outreach_angles: Array<{title: string; description: string}>
  cold_email: string; linkedin_message: string; call_script: string
  objections: Array<{objection: string; counter: string}>
}
interface Prospect {
  id: string; company_name: string; domain: string; industry: string
  size: string; stage: string; hq: string; linkedin_url: string
  description: string; priority_score: number; last_researched_at: string
  pipeline_stage: string; notes: string
  contacts: Contact[]; signals: Signal[]; gtm_briefs: GTMBrief[]
}
interface Profile {
  id: string; name: string; email: string
  product_description: string; target_industries: string[]
}

// ── Constants ────────────────────────────────────────────────────────────────
const SIGNAL_COLORS: Record<string,string> = {
  funding:'#16a34a',hiring:'#2563eb',product_launch:'#9333ea',
  leadership_change:'#ea580c',expansion:'#0891b2',partnership:'#65a30d',
  press:'#6b7280',financial:'#b45309',competitive:'#dc2626',other:'#6b6b80',
}
const SIGNAL_LABELS: Record<string,string> = {
  funding:'💰 Funding',hiring:'🧑‍💼 Hiring',product_launch:'🚀 Launch',
  leadership_change:'👤 Leadership',expansion:'📈 Expansion',partnership:'🤝 Partnership',
  press:'📰 Press',financial:'💹 Financial',competitive:'⚔️ Competitive',other:'📌 Signal',
}
const ROLE_COLORS: Record<string,string> = {
  champion:'#16a34a',blocker:'#dc2626',influencer:'#2563eb',evaluator:'#b45309',
}
const CONF_COLORS = {high:'#16a34a',medium:'#b45309',low:'#dc2626'}
const STAGE_CONFIG: Record<string, {label: string; color: string}> = {
  researched:      {label: 'Researched',      color: '#6b6b80'},
  contacted:       {label: 'Contacted',        color: '#2563eb'},
  in_conversation: {label: 'In Conversation',  color: '#9333ea'},
  proposal:        {label: 'Proposal Sent',    color: '#b45309'},
  won:             {label: 'Won',              color: '#16a34a'},
  lost:            {label: 'Lost',             color: '#dc2626'},
  paused:          {label: 'Paused',           color: '#6b6b80'},
}

// ── Small components ─────────────────────────────────────────────────────────
function Badge({text,color}:{text:string;color:string}) {
  return <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded"
    style={{background:color+'20',color}}>{text}</span>
}
function CopyBtn({text}:{text:string}) {
  const [c,setC]=useState(false)
  return <button onClick={()=>{navigator.clipboard.writeText(text);setC(true);setTimeout(()=>setC(false),2000)}}
    className="text-xs px-2.5 py-1 rounded font-medium transition-all"
    style={{background:c?'#16a34a20':'#1a1a24',color:c?'#16a34a':'#6b6b80',border:'1px solid #2a2a38'}}>
    {c?'✓':'Copy'}
  </button>
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile|null>(null)
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [selected, setSelected] = useState<Prospect|null>(null)
  const [activeTab, setActiveTab] = useState<'scoops'|'techstack'|'contacts'|'outreach'>('scoops')
  const [searchInput, setSearchInput] = useState('')
  const [researching, setResearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [sortCol, setSortCol] = useState<'priority_score'|'company_name'|'signals'>('priority_score')

  useEffect(() => {
    const stored = localStorage.getItem('gtm_profile')
    if (!stored) { router.push('/setup'); return }
    setProfile(JSON.parse(stored))
  }, [router])

  const loadProspects = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const res = await fetch(`/api/prospects?profile_id=${profile.id}`)
    const data = await res.json()
    setProspects(data.prospects || [])
    setLoading(false)
  }, [profile])

  useEffect(() => { if (profile) loadProspects() }, [profile, loadProspects])

  const runResearch = async () => {
    if (!searchInput.trim() || !profile) return
    setResearching(true); setError(null)
    try {
      const res = await fetch('/api/research', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({company_name: searchInput.trim(), profile_id: profile.id}),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSearchInput('')
      await loadProspects()
      if (data.prospect_id) {
        const r2 = await fetch(`/api/prospects?profile_id=${profile.id}`)
        const d2 = await r2.json()
        const all: Prospect[] = d2.prospects || []
        setProspects(all)
        const found = all.find(p => p.id === data.prospect_id)
        if (found) setSelected(found)
      }
    } catch(e) { setError(e instanceof Error ? e.message : 'Research failed') }
    finally { setResearching(false) }
  }

  const removeProspect = async (id: string) => {
    await fetch(`/api/prospects?id=${id}`, {method:'DELETE'})
    setProspects(p => p.filter(x => x.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const updateProspect = async (id: string, updates: {pipeline_stage?: string; notes?: string}) => {
    await fetch('/api/prospects/update', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id, ...updates}),
    })
    setProspects(prev => prev.map(p => p.id === id ? {...p, ...updates} : p))
    if (selected?.id === id) setSelected(prev => prev ? {...prev, ...updates} : null)
  }

  const exportCSV = () => { if (profile) window.open(`/api/export?profile_id=${profile.id}`, '_blank') }

  const sorted = [...prospects].sort((a,b) => {
    if (sortCol === 'priority_score') return b.priority_score - a.priority_score
    if (sortCol === 'signals') return (b.signals?.length||0) - (a.signals?.length||0)
    return a.company_name.localeCompare(b.company_name)
  })

  const newSignals = prospects.reduce((acc,p) => acc + (p.signals?.filter(s=>s.is_new).length||0), 0)
  const brief = selected?.gtm_briefs?.[0]

  return (
    <div className="min-h-screen" style={{background:'#0a0a0f'}}>

      {/* ── TOP NAV ── */}
      <div className="flex items-center justify-between px-6 py-3 sticky top-0 z-10"
        style={{background:'#0d0d14',borderBottom:'1px solid #1a1a24'}}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{background:'#6c63ff'}}>
            <span className="text-white text-xs font-bold">G</span>
          </div>
          <span className="font-display font-bold text-white">GTM Intel</span>
          {newSignals > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:'#6c63ff',color:'white'}}>
              {newSignals} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {profile && <span className="text-xs hidden sm:block" style={{color:'#6b6b80'}}>Hi {profile.name}</span>}
          <div className="flex items-center gap-2">
            <input type="text" placeholder="Search a company..."
              value={searchInput} onChange={e=>setSearchInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&runResearch()}
              className="px-3 py-1.5 rounded-lg text-sm outline-none w-48"
              style={{background:'#1a1a24',border:'1px solid #2a2a38',color:'#e8e8f0'}} />
            <button onClick={runResearch} disabled={researching||!searchInput.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
              style={{background:'#6c63ff',color:'white',opacity:(!searchInput.trim()||researching)?0.5:1}}>
              {researching ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"/> : '+ Research'}
            </button>
          </div>
          <button onClick={exportCSV}
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{background:'#1a1a24',color:'#6b6b80',border:'1px solid #2a2a38'}}>
            ↓ Export
          </button>
          <button onClick={()=>{localStorage.clear();router.push('/setup')}}
            className="text-xs px-2 py-1.5 rounded-lg" style={{color:'#6b6b80'}}>
            ← Profile
          </button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-49px)]">

        {/* ── TABLE PANEL ── */}
        <div className={`flex flex-col ${selected ? 'w-[420px] flex-shrink-0' : 'flex-1'} overflow-hidden`}
          style={{borderRight: selected ? '1px solid #1a1a24' : 'none'}}>

          {/* Table header */}
          <div className="px-4 py-3 flex items-center justify-between flex-shrink-0"
            style={{borderBottom:'1px solid #1a1a24'}}>
            <div className="flex items-center gap-3">
              <h2 className="font-display font-bold text-white text-sm">Target Accounts</h2>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{background:'#1a1a24',color:'#6b6b80'}}>{prospects.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{color:'#6b6b80'}}>Sort:</span>
              {(['priority_score','company_name','signals'] as const).map(col => (
                <button key={col} onClick={()=>setSortCol(col)}
                  className="text-xs px-2 py-1 rounded transition-all capitalize"
                  style={{
                    background: sortCol===col ? '#6c63ff20' : 'transparent',
                    color: sortCol===col ? '#6c63ff' : '#6b6b80',
                    border: `1px solid ${sortCol===col ? '#6c63ff40' : 'transparent'}`,
                  }}>
                  {col === 'priority_score' ? 'Score' : col === 'company_name' ? 'Name' : 'Signals'}
                </button>
              ))}
            </div>
          </div>

          {/* Column headers */}
          {!selected && (
            <div className="grid px-4 py-2 text-xs font-mono uppercase tracking-wider flex-shrink-0"
              style={{gridTemplateColumns:'1.4fr 130px 100px 80px 60px 60px 60px 80px',color:'#6b6b80',borderBottom:'1px solid #1a1a24',background:'#0d0d14'}}>
              <span>Company</span>
              <span>Website</span>
              <span>Industry</span>
              <span>Stage</span>
              <span>Score</span>
              <span>Signals</span>
              <span>Contacts</span>
              <span>Researched</span>
            </div>
          )}

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3">
                <div className="w-5 h-5 border-2 rounded-full animate-spin"
                  style={{borderColor:'#2a2a38',borderTopColor:'#6c63ff'}}/>
                <p className="text-xs" style={{color:'#6b6b80'}}>Loading accounts...</p>
              </div>
            ) : prospects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center px-6">
                <p className="text-2xl mb-3">🎯</p>
                <p className="text-sm font-medium text-white mb-1">No accounts yet</p>
                <p className="text-xs" style={{color:'#6b6b80'}}>Search for a company above or wait for auto-discovery to complete.</p>
              </div>
            ) : sorted.map(p => {
              const newSigs = p.signals?.filter(s=>s.is_new).length || 0
              const isSelected = selected?.id === p.id
              if (selected) {
                // Compact list view when detail panel is open
                return (
                  <button key={p.id} onClick={()=>{setSelected(p);setActiveTab('brief')}}
                    className="w-full text-left px-4 py-3 transition-all flex items-center justify-between gap-2"
                    style={{
                      background: isSelected ? '#6c63ff15' : 'transparent',
                      borderBottom: '1px solid #1a1a24',
                      borderLeft: `2px solid ${isSelected ? '#6c63ff' : 'transparent'}`,
                    }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{p.company_name}</p>
                      <p className="text-xs truncate" style={{color:'#6b6b80'}}>{p.industry} · {p.stage}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {newSigs > 0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                        style={{background:'#6c63ff',color:'white',fontSize:'10px'}}>{newSigs}</span>}
                      <span className="text-xs font-bold"
                        style={{color:p.priority_score>=8?'#16a34a':p.priority_score>=6?'#b45309':'#6b6b80'}}>
                        {p.priority_score}
                      </span>
                    </div>
                  </button>
                )
              }
              // Full table row
              return (
                <button key={p.id} onClick={()=>{setSelected(p);setActiveTab('brief')}}
                  className="w-full text-left grid px-4 py-3 transition-all hover:bg-white/5 group"
                  style={{
                    gridTemplateColumns:'1fr 100px 80px 60px 60px 60px 80px',
                    borderBottom:'1px solid #1a1a24',
                    background: isSelected ? '#6c63ff08' : 'transparent',
                  }}>
                  <div className="min-w-0 pr-4">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate">{p.company_name}</p>
                      {newSigs > 0 && <span className="text-xs font-bold px-1.5 rounded-full flex-shrink-0"
                        style={{background:'#6c63ff',color:'white',fontSize:'10px'}}>{newSigs} new</span>}
                    </div>
                    <p className="text-xs truncate mt-0.5" style={{color:'#6b6b80'}}>{p.description?.slice(0,60)}...</p>
                  </div>
                  <div className="self-center min-w-0 pr-2">
                    {p.domain ? (
                      <a href={`https://${p.domain}`} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs font-medium truncate flex items-center gap-1 hover:underline"
                        style={{color:'#6c63ff'}}>
                        🌐 {p.domain}
                      </a>
                    ) : <span className="text-xs" style={{color:'#6b6b80'}}>—</span>}
                  </div>
                  <div className="self-center">
                    <span className="text-xs px-2 py-0.5 rounded font-medium"
                      style={{background:'#6c63ff15',color:'#6c63ff'}}>{p.industry?.split('/')[0]?.trim() || '—'}</span>
                  </div>
                  <div className="self-center">
                    <span className="text-xs" style={{color:'#9ca3af'}}>{p.stage || '—'}</span>
                  </div>
<div className="self-center">
                    <span className="text-sm font-bold"
                      style={{color:p.priority_score>=8?'#16a34a':p.priority_score>=6?'#b45309':'#6b6b80'}}>
                      {p.priority_score}/10
                    </span>
                  </div>
                  <div className="self-center">
                    <span className="text-sm" style={{color:'#9ca3af'}}>{p.signals?.length || 0}</span>
                  </div>
                  <div className="self-center">
                    <span className="text-sm" style={{color:'#9ca3af'}}>{p.contacts?.length || 0}</span>
                  </div>
                  <div className="self-center">
                    <span className="text-xs" style={{color:'#6b6b80'}}>
                      {p.last_researched_at ? new Date(p.last_researched_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── DETAIL PANEL ── */}
        {selected && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-6 max-w-3xl">

              {/* Company header */}
              <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
                <div>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h1 className="font-display text-2xl font-bold text-white">{selected.company_name}</h1>
                    <span className="text-lg font-bold"
                      style={{color:selected.priority_score>=8?'#16a34a':'#b45309'}}>
                      {selected.priority_score}/10
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {selected.industry && <Badge text={selected.industry} color="#6c63ff"/>}
                    {selected.stage && <Badge text={selected.stage} color="#b45309"/>}
                    {selected.size && <Badge text={selected.size} color="#16a34a"/>}
                    {selected.hq && <Badge text={`📍 ${selected.hq}`} color="#0891b2"/>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {selected.linkedin_url && (
                      <a href={selected.linkedin_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                        style={{background:'#0077b520',color:'#0077b5',border:'1px solid #0077b530'}}>
                        in Company LinkedIn ↗
                      </a>
                    )}
                    {selected.domain && (
                      <a href={`https://${selected.domain}`} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                        style={{background:'#1a1a24',color:'#9ca3af',border:'1px solid #2a2a38'}}>
                        🌐 {selected.domain} ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={()=>setSelected(null)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{background:'#1a1a24',color:'#6b6b80',border:'1px solid #2a2a38'}}>
                    ✕ Close
                  </button>
                  <button onClick={()=>removeProspect(selected.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{background:'#dc262620',color:'#dc2626',border:'1px solid #dc262630'}}>
                    Remove
                  </button>
                </div>
              </div>

              {selected.description && (
                <p className="text-sm mb-5" style={{color:'#9ca3af'}}>{selected.description}</p>
              )}

              {/* Notes */}
              <div className="mb-4">
                <textarea
                  placeholder="Account notes, meeting context, blockers, next steps..."
                  value={selected.notes || ''}
                  onChange={e => updateProspect(selected.id, {notes: e.target.value})}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none"
                  style={{background:'#1a1a24',border:'1px solid #2a2a38',color:'#c0c0d4'}}
                />
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mb-5 p-1 rounded-lg" style={{background:'#1a1a24'}}>
                {(['scoops','techstack','contacts','outreach'] as const).map(tab => (
                  <button key={tab} onClick={()=>setActiveTab(tab)}
                    className="flex-1 py-2 rounded-md text-xs font-semibold capitalize transition-all"
                    style={{background:activeTab===tab?'#6c63ff':'transparent',color:activeTab===tab?'white':'#6b6b80'}}>
                    {tab === 'techstack' ? 'Tech Stack' : tab === 'scoops' ? 'Scoops' : tab.charAt(0).toUpperCase()+tab.slice(1)}
                      <span className="ml-1 text-xs font-bold px-1 rounded-full" style={{background:'white',color:'#6c63ff'}}>
                        {selected.signals.filter(s=>s.is_new).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* SCOOPS TAB */}
              {activeTab==='scoops' && (
                <div className="space-y-3 animate-in">
                  {!selected.signals || selected.signals.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-2xl mb-3">📡</p>
                      <p className="text-sm font-medium text-white mb-1">No scoops yet</p>
                      <p className="text-xs" style={{color:'#6b6b80'}}>Research this company to pull live scoops from TechCrunch, Crunchbase, and funding news.</p>
                    </div>
                  ) : selected.signals.map((s, i) => {
                    const typeColors: Record<string,string> = {
                      funding:'#16a34a', acquisition:'#9333ea', layoff:'#dc2626',
                      leadership_change:'#ea580c', hiring_spike:'#2563eb',
                      product_launch:'#9333ea', expansion:'#0891b2',
                      partnership:'#65a30d', press:'#6b7280', other:'#6b6b80'
                    }
                    const typeLabels: Record<string,string> = {
                      funding:'💰 Funding', acquisition:'🤝 Acquisition', layoff:'⚠️ Layoff',
                      leadership_change:'👤 Leadership', hiring_spike:'🧑‍💼 Hiring',
                      product_launch:'🚀 Product Launch', expansion:'📈 Expansion',
                      partnership:'🤝 Partnership', press:'📰 Press', other:'📌 Signal'
                    }
                    const color = typeColors[s.signal_type] || '#6b6b80'
                    return (
                      <div key={s.id || i} className="rounded-xl overflow-hidden"
                        style={{border:`1px solid ${color}30`}}>
                        <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2"
                          style={{background:`${color}10`, borderBottom:`1px solid ${color}20`}}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge text={typeLabels[s.signal_type]||s.signal_type} color={color}/>
                            {s.is_new && <Badge text="NEW" color="#6c63ff"/>}
                            {s.signal_date && <span className="text-xs font-mono" style={{color:'#6b6b80'}}>{s.signal_date}</span>}
                          </div>
                          {s.source_name && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs" style={{color:'#6b6b80'}}>via</span>
                              {s.source_url
                                ? <a href={s.source_url} target="_blank" rel="noreferrer"
                                    className="text-xs font-semibold hover:underline" style={{color:'#6c63ff'}}>
                                    {s.source_name} ↗
                                  </a>
                                : <span className="text-xs font-semibold" style={{color:'#6b6b80'}}>{s.source_name}</span>
                              }
                            </div>
                          )}
                        </div>
                        <div className="p-4" style={{background:'#13131c'}}>
                          <p className="text-sm font-bold text-white mb-2">{s.title}</p>
                          <p className="text-sm mb-3 leading-relaxed" style={{color:'#c0c0d4'}}>{s.summary}</p>
                          {s.source_url && (
                            <a href={s.source_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
                              style={{background:'#1a1a24', color:'#6c63ff', border:'1px solid #2a2a38'}}>
                              📰 Read full article ↗
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}


              
{/* CONTACTS TAB */}
              {activeTab==='contacts' && (
                <div className="space-y-4 animate-in">
                  {(!selected.contacts || selected.contacts.length===0) ? (
                    <p className="text-sm" style={{color:'#6b6b80'}}>No contacts found.</p>
                  ) : selected.contacts.map(c => (
                    <div key={c.id} className="rounded-xl overflow-hidden" style={{border:'1px solid #2a2a38'}}>
                      <div className="flex items-center justify-between p-4" style={{background:'#111118'}}>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                            style={{background:'#6c63ff'}}>
                            {c.name.split(' ').map(n=>n[0]).join('').slice(0,2)}
                          </div>
                          <div>
                            <p className="font-semibold text-white text-sm">{c.name}</p>
                            <p className="text-xs" style={{color:'#9ca3af'}}>{c.title}</p>
                          </div>
                        </div>
                        {c.role_in_deal && <Badge text={c.role_in_deal} color={ROLE_COLORS[c.role_in_deal]||'#6b6b80'}/>}
                      </div>
                      <div className="p-4 space-y-3" style={{background:'#13131c'}}>
                        {/* LinkedIn — only show if verified or medium confidence */}
                        {c.linkedin_url && (
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{color:'#6b6b80'}}>LinkedIn</p>
                              <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                                className="text-xs font-medium truncate block" style={{color:'#0077b5'}}>
                                {c.linkedin_url.replace('https://www.linkedin.com/in/','linkedin.com/in/')} ↗
                              </a>
                            </div>
                            {c.linkedin_verified
                              ? <Badge text="✓ Verified" color="#16a34a"/>
                              : <Badge text="⚠ Unconfirmed" color="#b45309"/>}
                          </div>
                        )}
                        {!c.linkedin_url && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{background:'#1a1a24'}}>
                            <span className="text-xs" style={{color:'#6b6b80'}}>LinkedIn not verified — search manually on</span>
                            <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name + ' ' + (selected?.company_name||''))}`}
                              target="_blank" rel="noreferrer" className="text-xs font-medium" style={{color:'#0077b5'}}>
                              LinkedIn ↗
                            </a>
                          </div>
                        )}
                        {/* Email */}
                        <div className="rounded-lg p-3" style={{background:'#1a1a24'}}>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-mono uppercase tracking-wider" style={{color:'#6b6b80'}}>Email (guessed)</p>
                            <Badge text={`${c.email_confidence} confidence`}
                              color={CONF_COLORS[c.email_confidence]||'#6b6b80'}/>
                          </div>
                          <p className="text-sm font-mono text-white mb-1">{c.email_guess}</p>
                          <div className="h-1 rounded-full overflow-hidden mb-1" style={{background:'#2a2a38'}}>
                            <div className="h-full rounded-full" style={{
                              width:c.email_confidence==='high'?'85%':c.email_confidence==='medium'?'55%':'28%',
                              background:CONF_COLORS[c.email_confidence]||'#6b6b80'
                            }}/>
                          </div>
                          <p className="text-xs" style={{color:'#6b6b80'}}>
                            Pattern: {c.email_pattern} · Verify at{' '}
                            <a href="https://email-checker.net" target="_blank" rel="noreferrer" style={{color:'#6c63ff'}}>
                              email-checker.net
                            </a>
                          </p>
                          <p className="text-xs mt-1" style={{color:'#6b6b80'}}>⚠ Pattern-guessed · Not verified · May bounce</p>
                        </div>
                        {/* Outreach */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-mono uppercase tracking-wider" style={{color:'#6b6b80'}}>Outreach</p>
                            <CopyBtn text={c.outreach_message}/>
                          </div>
                          <div className="rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap"
                            style={{background:'#1a1a24',color:'#c0c0d4'}}>{c.outreach_message}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              
              {/* TECHSTACK TAB */}
              {activeTab==='techstack' && (
                <div className="animate-in">
                  {brief?.tech_stack && brief.tech_stack.length > 0 ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs" style={{color:'#6b6b80'}}>
                          {brief.tech_stack.some((t: {verified?: boolean}) => t.verified)
                            ? '✓ Verified via OpenExplorer / BuiltWith'
                            : '⚠ Inferred from job postings'}
                        </p>
                        <a href={`https://openexplorer.tech/?domain=${selected.domain}`}
                          target="_blank" rel="noreferrer"
                          className="text-xs px-3 py-1.5 rounded-lg font-medium"
                          style={{background:'#6c63ff20',color:'#6c63ff',border:'1px solid #6c63ff30'}}>
                          🔍 View full stack on OpenExplorer ↗
                        </a>
                      </div>
                      {(() => {
                        const grouped: Record<string, Array<{tool:string;verified?:boolean;source?:string}>> = {}
                        brief.tech_stack.forEach((t: {category:string;tool:string;verified?:boolean;source?:string}) => {
                          if (!grouped[t.category]) grouped[t.category] = []
                          grouped[t.category].push(t)
                        })
                        return Object.entries(grouped).map(([cat, tools]) => (
                          <div key={cat} className="rounded-xl overflow-hidden" style={{border:'1px solid #2a2a38'}}>
                            <div className="px-4 py-2.5" style={{background:'#111118',borderBottom:'1px solid #1a1a24'}}>
                              <p className="text-xs font-mono uppercase tracking-wider font-semibold" style={{color:'#6b6b80'}}>{cat}</p>
                            </div>
                            <div className="p-3 flex flex-wrap gap-2" style={{background:'#13131c'}}>
                              {tools.map((t, i) => (
                                <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                                  style={{background:'#1a1a24',border:'1px solid #2a2a38'}}>
                                  <span className="text-sm font-medium text-white">{t.tool}</span>
                                  {t.verified
                                    ? <span className="text-xs" style={{color:'#16a34a'}}>✓</span>
                                    : <span className="text-xs" style={{color:'#b45309'}}>~</span>
                                  }
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-2xl mb-3">🔧</p>
                      <p className="text-sm font-medium text-white mb-2">No tech stack data yet</p>
                      <p className="text-xs mb-4" style={{color:'#6b6b80'}}>
                        Re-research this company to scan their website for active technologies.
                      </p>
                      <a href={`https://openexplorer.tech/?domain=${selected.domain}`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                        style={{background:'#6c63ff',color:'white'}}>
                        🔍 Check on OpenExplorer ↗
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* OUTREACH TAB */}
              {activeTab==='outreach' && brief && (
                <div className="space-y-4 animate-in">
                  {[
                    {title:'Cold Email', content: brief.cold_email},
                    {title:'LinkedIn Message', content: brief.linkedin_message},
                    {title:'Call Opening Script', content: brief.call_script},
                  ].map(({title, content}) => (
                    <Section key={title} title={title}>
                      <div className="flex justify-end mb-2"><CopyBtn text={content}/></div>
                      <div className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap"
                        style={{background:'#1a1a24',color:'#c0c0d4'}}>{content}</div>
                    </Section>
                  ))}
                  <Section title="Objection Handling">
                    <div className="space-y-3">
                      {brief.objections?.map((o,i) => (
                        <div key={i} className="rounded-lg overflow-hidden" style={{border:'1px solid #2a2a38'}}>
                          <div className="p-3" style={{background:'#1a1a24'}}>
                            <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{color:'#dc2626'}}>Objection</p>
                            <p className="text-sm" style={{color:'#e8e8f0'}}>{o.objection}</p>
                          </div>
                          <div className="p-3" style={{background:'#13131c'}}>
                            <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{color:'#16a34a'}}>Counter</p>
                            <p className="text-sm" style={{color:'#9ca3af'}}>{o.counter}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Empty state when no prospect selected */}
        {!selected && prospects.length > 0 && (
          <div className="hidden">
          </div>
        )}

      </div>
      {error && (
        <div className="fixed bottom-4 right-4 px-4 py-3 rounded-lg text-sm"
          style={{background:'#dc262620',color:'#dc2626',border:'1px solid #dc262630'}}>
          ⚠ {error}
        </div>
      )}
    </div>
  )
}

function Section({title,children}:{title:string;children:React.ReactNode}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{border:'1px solid #2a2a38'}}>
      <div className="px-4 py-3" style={{background:'#111118',borderBottom:'1px solid #1a1a24'}}>
        <p className="text-xs font-mono uppercase tracking-widest font-semibold" style={{color:'#6b6b80'}}>{title}</p>
      </div>
      <div className="p-4" style={{background:'#13131c'}}>{children}</div>
    </div>
  )
}
