'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const INDUSTRIES = [
  'B2B SaaS','Fintech','HR Tech','MarTech','DevTools',
  'AI / ML','Cybersecurity','HealthTech','E-commerce','EdTech',
  'RevOps','Sales Tech','Customer Success','Legal Tech','PropTech',
]
const COMPANY_SIZES = ['1–50 (Startup)','51–200 (Small)','201–500 (Mid)','501–1000 (Growth)','1000+ (Enterprise)']

const STEPS = [
  { id: 1, label: 'About you' },
  { id: 2, label: 'What you sell' },
  { id: 3, label: 'Preferences' },
]

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [form, setForm] = useState({
    name: '', email: '', company_name: '', product_description: '',
    target_industries: [] as string[], target_company_sizes: [] as string[],
    icp_notes: '', notify_daily: true,
  })

  const toggle = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]

  const handleSubmit = async () => {
    setLoading(true)
    setLoadingMsg('Creating your sales profile...')
    try {
      // Save profile
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.profile) throw new Error('Failed to save profile')

      localStorage.setItem('gtm_profile_id', data.profile.id)
      localStorage.setItem('gtm_profile', JSON.stringify(data.profile))

      // Phase 1: discover company names only (fast)
      setLoadingMsg('Finding your best-fit accounts...')
      const discoverRes = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: data.profile.id }),
      })
      const discoverData = await discoverRes.json()
      const companies = discoverData.companies || []

      // Phase 2: research each company individually
      for (let i = 0; i < companies.length; i++) {
        const c = companies[i]
        if (c.status === 'existing') continue
        setLoadingMsg(`Researching ${c.name} (${i + 1}/${companies.length})...`)
        try {
          await fetch('/api/research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company_name: c.name, profile_id: data.profile.id, prospect_id: c.prospect_id }),
          })
        } catch (e) { console.error(`Failed to research ${c.name}`, e) }
      }

      setLoadingMsg('Ready! Taking you to your dashboard...')
      await new Promise(r => setTimeout(r, 500))
      router.push('/dashboard')
    } catch (e) {
      console.error(e)
      const profileId = localStorage.getItem('gtm_profile_id')
      if (profileId) router.push('/dashboard')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0f' }}>
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 border-2 rounded-full mx-auto mb-6 animate-spin"
            style={{ borderColor: '#2a2a38', borderTopColor: '#6c63ff' }} />
          <h2 className="font-display text-xl font-bold text-white mb-2">{loadingMsg}</h2>
          <p className="text-sm" style={{ color: '#6b6b80' }}>
            Researching companies, finding contacts, and surfacing buying signals...
          </p>
          <div className="mt-6 space-y-2">
            {['Identifying best-fit accounts', 'Running GTM research', 'Finding key contacts', 'Validating LinkedIn profiles', 'Surfacing buying signals'].map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-left px-4 py-2 rounded-lg"
                style={{ background: '#1a1a24' }}>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#6c63ff' }} />
                <span className="text-xs" style={{ color: '#9ca3af' }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0a0a0f' }}>
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#6c63ff' }}>
              <span className="text-white text-sm font-bold">G</span>
            </div>
            <span className="font-display font-bold text-xl text-white">GTM Intel</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-2">Set up your workspace</h1>
          <p className="text-sm" style={{ color: '#6b6b80' }}>We'll find and research your best-fit accounts automatically.</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{ background: step >= s.id ? '#6c63ff' : '#1a1a24', color: step >= s.id ? 'white' : '#6b6b80' }}>
                  {step > s.id ? '✓' : s.id}
                </div>
                <span className="text-xs hidden sm:block" style={{ color: step === s.id ? '#e8e8f0' : '#6b6b80' }}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-px mx-2" style={{ background: step > s.id ? '#6c63ff' : '#2a2a38' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div className="animate-in space-y-4">
            <h2 className="font-display text-xl font-bold text-white mb-4">About you</h2>
            {[
              { label: 'Your name', key: 'name', placeholder: 'e.g. Sri' },
              { label: 'Work email', key: 'email', placeholder: 'you@company.com' },
              { label: 'Your company', key: 'company_name', placeholder: 'e.g. Salesforce' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>{f.label}</label>
                <input type={f.key === 'email' ? 'email' : 'text'} placeholder={f.placeholder}
                  value={form[f.key as keyof typeof form] as string}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                  style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }} />
              </div>
            ))}
            <button onClick={() => setStep(2)} disabled={!form.name || !form.email}
              className="w-full mt-2 py-3 rounded-lg font-semibold text-sm transition-all"
              style={{ background: '#6c63ff', color: 'white', opacity: (!form.name || !form.email) ? 0.5 : 1 }}>
              Continue →
            </button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="animate-in space-y-4">
            <h2 className="font-display text-xl font-bold text-white mb-4">What do you sell?</h2>
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Product description</label>
              <textarea rows={4} placeholder="e.g. I sell a revenue intelligence platform that helps enterprise sales teams improve forecast accuracy..."
                value={form.product_description}
                onChange={e => setForm({ ...form, product_description: e.target.value })}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none resize-none"
                style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }} />
              <p className="text-xs mt-1" style={{ color: '#6b6b80' }}>Be specific — this tailors every research brief and outreach message.</p>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Target industries</label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map(ind => (
                  <button key={ind} onClick={() => setForm({ ...form, target_industries: toggle(form.target_industries, ind) })}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: form.target_industries.includes(ind) ? '#6c63ff' : 'transparent',
                      border: `1px solid ${form.target_industries.includes(ind) ? '#6c63ff' : '#2a2a38'}`,
                      color: form.target_industries.includes(ind) ? 'white' : '#6b6b80',
                    }}>{ind}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setStep(1)} className="px-6 py-3 rounded-lg text-sm" style={{ background: '#1a1a24', color: '#6b6b80' }}>← Back</button>
              <button onClick={() => setStep(3)} disabled={!form.product_description || !form.target_industries.length}
                className="flex-1 py-3 rounded-lg font-semibold text-sm"
                style={{ background: '#6c63ff', color: 'white', opacity: (!form.product_description || !form.target_industries.length) ? 0.5 : 1 }}>
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="animate-in space-y-4">
            <h2 className="font-display text-xl font-bold text-white mb-4">Target account preferences</h2>
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Company sizes</label>
              <div className="flex flex-wrap gap-2">
                {COMPANY_SIZES.map(size => (
                  <button key={size} onClick={() => setForm({ ...form, target_company_sizes: toggle(form.target_company_sizes, size) })}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: form.target_company_sizes.includes(size) ? '#6c63ff' : 'transparent',
                      border: `1px solid ${form.target_company_sizes.includes(size) ? '#6c63ff' : '#2a2a38'}`,
                      color: form.target_company_sizes.includes(size) ? 'white' : '#6b6b80',
                    }}>{size}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>ICP notes (optional)</label>
              <textarea rows={3} placeholder="e.g. Focus on companies raising Series B+, hiring RevOps, using Salesforce..."
                value={form.icp_notes}
                onChange={e => setForm({ ...form, icp_notes: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }} />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: '#1a1a24', border: '1px solid #2a2a38' }}>
              <div>
                <p className="font-medium text-white text-sm">Daily email digest</p>
                <p className="text-xs mt-0.5" style={{ color: '#6b6b80' }}>New signals every morning at 7am</p>
              </div>
              <button onClick={() => setForm({ ...form, notify_daily: !form.notify_daily })}
                className="w-12 h-6 rounded-full transition-all relative flex-shrink-0"
                style={{ background: form.notify_daily ? '#6c63ff' : '#2a2a38' }}>
                <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all"
                  style={{ left: form.notify_daily ? '26px' : '2px' }} />
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="px-6 py-3 rounded-lg text-sm" style={{ background: '#1a1a24', color: '#6b6b80' }}>← Back</button>
              <button onClick={handleSubmit}
                className="flex-1 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                style={{ background: '#6c63ff', color: 'white' }}>
                🚀 Find my accounts →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
