'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

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
interface TechItem {
  category: string; tool: string; confidence: string; verified?: boolean; source?: string
}
interface GTMBrief {
  executive_summary: string; business_model: string
  pain_points: Array<{title:string;description:string;severity:string}>
  tech_stack: TechItem[]
  discovery_questions: string[]
  outreach_angles: Array<{title:string;description:string}>
  cold_email: string; linkedin_message: string; call_script: string
  objections: Array<{objection:string;counter:string}>
}
interface Prospect {
  id: string; company_name: string; domain: string; industry: string
  size: string; stage: string; hq: string; linkedin_url: string
  description: string; priority_score: number; last_researched_at: string
  contacts: Contact[]; signals: Signal[]; gtm_briefs: GTMBrief[]
}
interface Profile {
  id: string; name: string; email: string
  product_description: string; target_industries: string[]
}

const SIGNAL_COLORS: Record<string,string> = {
  funding:'#16a34a', acquisition:'#9333ea', layoff:'#dc2626',
  leadership_change:'#ea580c', hiring_spike:'#2563eb', hiring:'#2563eb',
  product_launch:'#9333ea', expansion:'#0891b2', partnership:'#65a30d',
  press:'#6b7280', financial:'#b45309', competitive:'#dc2626', other:'#6b6b80',
}
const SIGNAL_LABELS: Record<string,string> = {
  funding:'💰 Funding', acquisition:'🤝 Acquisition', layoff:'⚠️ Layoff',
  leadership_change:'👤 Leadership', hiring_spike:'🧑‍💼 Hiring', hiring:'🧑‍💼 Hiring',
  product_launch:'🚀 Product Launch', expansion:'📈 Expansion',
  partnership:'🤝 Partnership', press:'📰 Press', other:'📌 Signal',
}
const ROLE_COLORS: Record<string,string> = {
  champion:'#16a34a', blocker:'#dc2626', influencer:'#2563eb', evaluator:'#b45309',
}
const CONF_COLORS = {high:'#16a34a', medium:'#b45309', low:'#dc2626'}

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
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({company_name:searchInput.trim(), profile_id:profile.id}),
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
        if (found) { setSelected(found); setActiveTab('scoops') }
      }
    } catch(e) { setError(e instanceof Error ? e.message : 'Research failed') }
    finally { setResearching(false) }
  }

  const removeProspect = async (id: string) => {
    await fetch(`/api/prospects?id=${id}`, {method:'DELETE'})
    setProspects(p => p.filter(x => x.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const sorted = [...prospects].sort((a,b) => {
    if (sortCol==='priority_score') return b.priority_score - a.priority_score
    if (sortCol==='signals') return (b.signals?.length||0)-(a.signals?.length||0)
    return a.company_name.localeCompare(b.company_name)
  })

  const newSignals = prospects.reduce((acc,p)=>acc+(p.signals?.filter(s=>s.is_new).length||0),0)
  const brief = selected?.gtm_briefs?.[0]

  return (
    <div className="flex h-screen overflow-hidden" style={{background:'#0a0a0f'}}>

      {/* SIDEBAR */}
      <div className={`flex flex-col flex-shrink-0 ${selected?'w-72':'w-80'}`}
        style={{background:'#0d0d14',borderRight:'1px solid #1a1a24'}}>

        {/* Logo + search */}
        <div className="p-4" style={{borderBottom:'1px solid #1a1a24'}}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{background:'#6c63ff'}}>
                <span className="text-white text-xs font-bold">G</span>
              </div>
              <span className="font-display font-bold text-white">GTM Intel</span>
            </div>
            {newSignals > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:'#6c63ff',color:'white'}}>
                {newSignals} new
              </span>
            )}
          </div>
          {profile && (
            <div className="p-2.5 rounded-lg mb-3" style={{background:'#1a1a24'}}>
              <p className="text-xs font-semibold text-white truncate">{profile.name}</p>
              <p className="text-xs mt-0.5 truncate" style={{color:'#6b6b80'}}>{profile.product_description.slice(0,55)}...</p>
            </div>
          )}
          <div className="relative">
            <input type="text" placeholder="Research a company..."
              value={searchInput} onChange={e=>setSearchInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&runResearch()}
              className="w-full pl-3 pr-10 py-2.5 rounded-lg text-sm outline-none"
              style={{background:'#1a1a24',border:'1px solid #2a2a38',color:'#e8e8f0'}} />
            <button onClick={runResearch} disabled={researching||!searchInput.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center"
              style={{background:'#6c63ff',opacity:(!searchInput.trim()||researching)?0.5:1}}>
              {researching
                ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"/>
                : <span className="text-white text-xs">→</span>}
            </button>
          </div>
          {error && <p className="text-xs mt-2" style={{color:'#ff6584'}}>{error}</p>}
        </div>

        {/* Sort */}
        <div className="flex gap-1 px-4 py-2" style={{borderBottom:'1px solid #1a1a24'}}>
          {(['priority_score','company_name','signals'] as const).map(col => (
            <button key={col} onClick={()=>setSortCol(col)}
              className="flex-1 text-xs py-1 rounded transition-all"
              style={{
                background:sortCol===col?'#6c63ff20':'transparent',
                color:sortCol===col?'#6c63ff':'#6b6b80',
                border:`1px solid ${sortCol===col?'#6c63ff40':'transparent'}`,
              }}>
              {col==='priority_score'?'Score':col==='company_name'?'Name':'Signals'}
            </button>
          ))}
        </div>

        {/* Prospect list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{borderColor:'#2a2a38',borderTopColor:'#6c63ff'}}/>
            </div>
          ) : prospects.length===0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-xs" style={{color:'#6b6b80'}}>No accounts yet. Search above or go through setup to auto-discover.</p>
            </div>
          ) : sorted.map(p => {
            const newSigs = p.signals?.filter(s=>s.is_new).length||0
            const isSelected = selected?.id===p.id
            return (
              <button key={p.id} onClick={()=>{setSelected(p);setActiveTab('scoops')}}
                className="w-full text-left px-4 py-3 transition-all"
                style={{
                  background:isSelected?'#6c63ff15':'transparent',
                  borderBottom:'1px solid #1a1a24',
                  borderLeft:`2px solid ${isSelected?'#6c63ff':'transparent'}`,
                }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{p.company_name}</p>
                    <p className="text-xs mt-0.5 truncate" style={{color:'#6b6b80'}}>{p.industry||'—'} · {p.stage||'—'}</p>
                    {p.domain && (
                      <p className="text-xs mt-0.5 truncate" style={{color:'#6c63ff'}}>🌐 {p.domain}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {newSigs>0 && <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{background:'#6c63ff',color:'white',fontSize:'10px'}}>{newSigs}</span>}
                    <span className="text-xs font-bold" style={{color:p.priority_score>=8?'#16a34a':p.priority_score>=6?'#b45309':'#6b6b80'}}>
                      {p.priority_score}/10
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="p-4 space-y-2" style={{borderTop:'1px solid #1a1a24'}}>
          <button onClick={loadProspects}
            className="w-full py-2 rounded-lg text-xs font-medium"
            style={{background:'#1a1a24',color:'#6b6b80',border:'1px solid #2a2a38'}}>
            ↻ Refresh
          </button>
          <button onClick={()=>{localStorage.clear();router.push('/setup')}}
            className="w-full py-2 rounded-lg text-xs" style={{color:'#6b6b80'}}>
            ← Switch profile
          </button>
        </div>
      </div>

      {/* MAIN PANEL */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={{background:'#6c63ff20'}}>
              <span className="text-3xl">🎯</span>
            </div>
            <h2 className="font-display text-2xl font-bold text-white mb-3">
              {researching ? 'Researching...' : 'Select or search a company'}
            </h2>
            <p className="text-sm max-w-sm" style={{color:'#6b6b80'}}>
              {researching
                ? 'Running live research — pulling scoops, tech stack, contacts and outreach...'
                : 'Search for any company to get GTM scoops, verified tech stack, contacts, and personalized outreach.'}
            </p>
            {researching && <div className="w-6 h-6 border-2 rounded-full animate-spin mt-4" style={{borderColor:'#2a2a38',borderTopColor:'#6c63ff'}}/>}
          </div>
        ) : (
          <div className="p-6 max-w-4xl">

            {/* Company header */}
            <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
              <div>
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="font-display text-2xl font-bold text-white">{selected.company_name}</h1>
                  <span className="text-lg font-bold" style={{color:selected.priority_score>=8?'#16a34a':'#b45309'}}>
                    {selected.priority_score}/10
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {selected.industry && <Badge text={selected.industry} color="#6c63ff"/>}
                  {selected.stage && <Badge text={selected.stage} color="#b45309"/>}
                  {selected.size && <Badge text={selected.size} color="#16a34a"/>}
                  {selected.hq && <Badge text={`📍 ${selected.hq}`} color="#0891b2"/>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.linkedin_url && (
                    <a href={selected.linkedin_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{background:'#0077b520',color:'#0077b5',border:'1px solid #0077b530'}}>
                      in LinkedIn ↗
                    </a>
                  )}
                  {selected.domain && (
                    <a href={`https://${selected.domain}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{background:'#1a1a24',color:'#9ca3af',border:'1px solid #2a2a38'}}>
                      🌐 {selected.domain} ↗
                    </a>
                  )}
                  {selected.domain && (
                    <a href={`https://openexplorer.tech/?domain=${selected.domain}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg"
                      style={{background:'#6c63ff20',color:'#6c63ff',border:'1px solid #6c63ff30'}}>
                      🔍 Tech Stack ↗
                    </a>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setSelected(null)}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={{background:'#1a1a24',color:'#6b6b80',border:'1px solid #2a2a38'}}>✕</button>
                <button onClick={()=>removeProspect(selected.id)}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={{background:'#dc262620',color:'#dc2626',border:'1px solid #dc262630'}}>Remove</button>
              </div>
            </div>

            {selected.description && (
              <p className="text-sm mb-5" style={{color:'#9ca3af'}}>{selected.description}</p>
            )}

            {/* Tabs */}
            <div className="flex gap-1 mb-5 p-1 rounded-lg" style={{background:'#1a1a24'}}>
              {(['scoops','techstack','contacts','outreach'] as const).map(tab => (
                <button key={tab} onClick={()=>setActiveTab(tab)}
                  className="flex-1 py-2 rounded-md text-xs font-semibold capitalize transition-all"
                  style={{background:activeTab===tab?'#6c63ff':'transparent',color:activeTab===tab?'white':'#6b6b80'}}>
                  {tab==='techstack'?'Tech Stack':tab.charAt(0).toUpperCase()+tab.slice(1)}
                  {tab==='scoops' && (selected.signals?.length||0)>0 && (
                    <span className="ml-1 text-xs font-bold px-1 rounded-full" style={{background:activeTab===tab?'rgba(255,255,255,0.3)':'#6c63ff',color:'white'}}>
                      {selected.signals.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* SCOOPS TAB */}
            {activeTab==='scoops' && (
              <div className="space-y-3 animate-in">
                {!selected.signals || selected.signals.length===0 ? (
                  <div className="text-center py-10">
                    <p className="text-2xl mb-3">📡</p>
                    <p className="text-sm font-medium text-white mb-1">No scoops yet</p>
                    <p className="text-xs" style={{color:'#6b6b80'}}>Research this company to pull live funding, hiring, product launch and leadership signals.</p>
                  </div>
                ) : selected.signals.map((s,i) => {
                  const color = SIGNAL_COLORS[s.signal_type]||'#6b6b80'
                  return (
                    <div key={s.id||i} className="rounded-xl overflow-hidden" style={{border:`1px solid ${color}30`}}>
                      <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2"
                        style={{background:`${color}10`,borderBottom:`1px solid ${color}20`}}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge text={SIGNAL_LABELS[s.signal_type]||s.signal_type} color={color}/>
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
                            style={{background:'#1a1a24',color:'#6c63ff',border:'1px solid #2a2a38'}}>
                            📰 Read full article ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* TECHSTACK TAB */}
            {activeTab==='techstack' && (
              <div className="animate-in">
                {brief?.tech_stack && brief.tech_stack.length>0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs" style={{color:'#6b6b80'}}>
                        {brief.tech_stack.some(t=>t.verified) ? '✓ Verified via OpenExplorer / BuiltWith' : '⚠ Inferred from job postings'}
                      </p>
                      {selected.domain && (
                        <a href={`https://openexplorer.tech/?domain=${selected.domain}`} target="_blank" rel="noreferrer"
                          className="text-xs px-3 py-1.5 rounded-lg font-medium"
                          style={{background:'#6c63ff20',color:'#6c63ff',border:'1px solid #6c63ff30'}}>
                          🔍 Full stack on OpenExplorer ↗
                        </a>
                      )}
                    </div>
                    {(() => {
                      const grouped: Record<string,TechItem[]> = {}
                      brief.tech_stack.forEach(t => {
                        if (!grouped[t.category]) grouped[t.category] = []
                        grouped[t.category].push(t)
                      })
                      return Object.entries(grouped).map(([cat,tools]) => (
                        <div key={cat} className="rounded-xl overflow-hidden" style={{border:'1px solid #2a2a38'}}>
                          <div className="px-4 py-2.5" style={{background:'#111118',borderBottom:'1px solid #1a1a24'}}>
                            <p className="text-xs font-mono uppercase tracking-wider font-semibold" style={{color:'#6b6b80'}}>{cat}</p>
                          </div>
                          <div className="p-3 flex flex-wrap gap-2" style={{background:'#13131c'}}>
                            {tools.map((t,i) => (
                              <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                                style={{background:'#1a1a24',border:'1px solid #2a2a38'}}>
                                <span className="text-sm font-medium text-white">{t.tool}</span>
                                {t.verified
                                  ? <span className="text-xs" style={{color:'#16a34a'}}>✓</span>
                                  : <span className="text-xs" style={{color:'#b45309'}}>~</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <p className="text-2xl mb-3">🔧</p>
                    <p className="text-sm font-medium text-white mb-2">No tech stack data yet</p>
                    <p className="text-xs mb-4" style={{color:'#6b6b80'}}>Re-research this company to scan their website.</p>
                    {selected.domain && (
                      <a href={`https://openexplorer.tech/?domain=${selected.domain}`} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                        style={{background:'#6c63ff',color:'white'}}>
                        🔍 Check on OpenExplorer ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* CONTACTS TAB */}
            {activeTab==='contacts' && (
              <div className="space-y-4 animate-in">
                {!selected.contacts||selected.contacts.length===0 ? (
                  <p className="text-sm" style={{color:'#6b6b80'}}>No contacts found. Re-research to find key stakeholders.</p>
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
                      {c.linkedin_url ? (
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{color:'#6b6b80'}}>LinkedIn</p>
                            <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                              className="text-xs font-medium truncate block" style={{color:'#0077b5'}}>
                              {c.linkedin_url.replace('https://www.linkedin.com/in/','linkedin.com/in/')} ↗
                            </a>
                          </div>
                          {c.linkedin_verified ? <Badge text="✓ Verified" color="#16a34a"/> : <Badge text="⚠ Unconfirmed" color="#b45309"/>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{background:'#1a1a24'}}>
                          <span className="text-xs" style={{color:'#6b6b80'}}>LinkedIn not verified — search on</span>
                          <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name+' '+selected.company_name)}`}
                            target="_blank" rel="noreferrer" className="text-xs font-medium" style={{color:'#0077b5'}}>LinkedIn ↗</a>
                        </div>
                      )}
                      <div className="rounded-lg p-3" style={{background:'#1a1a24'}}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-mono uppercase tracking-wider" style={{color:'#6b6b80'}}>Email (guessed)</p>
                          <Badge text={`${c.email_confidence} confidence`} color={CONF_COLORS[c.email_confidence]||'#6b6b80'}/>
                        </div>
                        <p className="text-sm font-mono text-white mb-1">{c.email_guess}</p>
                        <div className="h-1 rounded-full overflow-hidden mb-1" style={{background:'#2a2a38'}}>
                          <div className="h-full rounded-full" style={{width:c.email_confidence==='high'?'85%':c.email_confidence==='medium'?'55%':'28%',background:CONF_COLORS[c.email_confidence]||'#6b6b80'}}/>
                        </div>
                        <p className="text-xs" style={{color:'#6b6b80'}}>
                          ⚠ Pattern-guessed · Verify at <a href="https://email-checker.net" target="_blank" rel="noreferrer" style={{color:'#6c63ff'}}>email-checker.net</a>
                        </p>
                      </div>
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

            {/* OUTREACH TAB */}
            {activeTab==='outreach' && brief && (
              <div className="space-y-4 animate-in">
                {[
                  {title:'Cold Email', content:brief.cold_email},
                  {title:'LinkedIn Message', content:brief.linkedin_message},
                  {title:'Call Opening Script', content:brief.call_script},
                ].map(({title,content}) => content ? (
                  <Section key={title} title={title}>
                    <div className="flex justify-end mb-2"><CopyBtn text={content}/></div>
                    <div className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap"
                      style={{background:'#1a1a24',color:'#c0c0d4'}}>{content}</div>
                  </Section>
                ) : null)}
                {brief.pain_points?.length > 0 && (
                  <Section title="Pain Points">
                    <div className="space-y-2">
                      {brief.pain_points.map((p,i) => (
                        <div key={i} className="p-3 rounded-lg" style={{background:'#1a1a24'}}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-white">{p.title}</span>
                            <Badge text={p.severity} color={p.severity==='high'?'#dc2626':p.severity==='medium'?'#b45309':'#6b6b80'}/>
                          </div>
                          <p className="text-xs" style={{color:'#9ca3af'}}>{p.description}</p>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
                {brief.discovery_questions?.length > 0 && (
                  <Section title="Discovery Questions">
                    <ol className="space-y-2">
                      {brief.discovery_questions.map((q,i) => (
                        <li key={i} className="flex gap-3 text-sm" style={{color:'#c0c0d4'}}>
                          <span className="font-mono text-xs mt-0.5 flex-shrink-0" style={{color:'#6c63ff'}}>{String(i+1).padStart(2,'0')}</span>
                          {q}
                        </li>
                      ))}
                    </ol>
                  </Section>
                )}
                {brief.objections?.length > 0 && (
                  <Section title="Objection Handling">
                    <div className="space-y-3">
                      {brief.objections.map((o,i) => (
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
                )}
              </div>
            )}

          </div>
        )}
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 px-4 py-3 rounded-lg text-sm z-50"
          style={{background:'#dc262620',color:'#dc2626',border:'1px solid #dc262630'}}>
          ⚠ {error}
        </div>
      )}
    </div>
  )
}
