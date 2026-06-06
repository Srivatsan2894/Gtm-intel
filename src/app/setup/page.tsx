'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const INDUSTRIES = [
  'B2B SaaS','Fintech','HR Tech','MarTech','DevTools',
  'AI / ML','Cybersecurity','HealthTech','E-commerce','EdTech',
  'RevOps','Sales Tech','Customer Success','Legal Tech','PropTech',
]
const COMPANY_SIZES = [
  '1–50 (Startup)','51–200 (Small)','201–500 (Mid)',
  '501–1000 (Growth)','1000+ (Enterprise)',
]

const PRODUCT_EXAMPLES = [
  'AI-powered sales intelligence platform for B2B SaaS teams',
  'Revenue operations software for scaling startups',
  'Customer success platform for SaaS companies',
  'Sales engagement and outreach automation tool',
  'Contract management and CLM software',
  'HR and people management platform',
]

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', company_name: '',
    product_description: '',
    target_industries: [] as string[],
    target_company_sizes: [] as string[],
    icp_notes: '',
    notify_daily: true,
  })

  const toggle = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]

  // AI-assisted ICP generation
  const generateICP = async () => {
    if (!form.product_description.trim()) return
    setAiGenerating(true)
    try {
      const res = await fetch('/api/generate-icp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_description: form.product_description }),
      })
      const data = await res.json()
      if (data.industries) {
        setForm(f => ({
          ...f,
          target_industries: data.industries || f.target_industries,
          target_company_sizes: data.sizes || f.target_company_sizes,
          icp_notes: data.icp_notes || f.icp_notes,
        }))
        setStep(3)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setAiGenerating(false)
    }
  }

  const handleSubmit = async () => {
    setLoading(true)
    setLoadingMsg('Creating your sales profile...')
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.profile) throw new Error('Failed to save profile')

      localStorage.setItem('gtm_profile_id', data.profile.id)
      localStorage.setItem('gtm_profile', JSON.stringify(data.profile))

      // Phase 1: discover companies
      setLoadingMsg('Finding best-fit accounts based on your ICP...')
      const discoverRes = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: data.profile.id }),
      })
      const discoverData = await discoverRes.json()
      const companies = discoverData.companies || []

      // Phase 2: research each
      for (let i = 0; i < companies.length; i++) {
        const c = companies[i]
        if (c.status === 'existing') continue
        setLoadingMsg(`Researching ${c.name} (${i + 1}/${companies.length})...`)
        try {
          await fetch('/api/research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_name: c.name,
              profile_id: data.profile.id,
              prospect_id: c.prospect_id,
            }),
          })
        } catch (e) { console.error(`Failed: ${c.name}`, e) }
        // Small delay between companies to avoid rate limiting
        if (i < companies.length - 1) await new Promise(r => setTimeout(r, 5000))
      }

      setLoadingMsg('Ready!')
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
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 border-2 rounded-full mx-auto mb-6 animate-spin"
            style={{ borderColor: '#2a2a38', borderTopColor: '#6c63ff' }} />
          <h2 className="text-xl font-bold text-white mb-2">{loadingMsg}</h2>
          <p className="text-sm" style={{ color: '#6b6b80' }}>
            Running live research — pulling scoops from TechCrunch, Crunchbase, funding news...
          </p>
          <div className="mt-6 space-y-2">
            {['Finding AI-first companies matching your ICP','Scraping TechCrunch & Crunchbase','Pulling funding & leadership signals','Validating LinkedIn contacts','Generating personalized outreach'].map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 rounded-lg text-left"
                style={{ background: '#1a1a24' }}>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: '#6c63ff' }} />
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
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#6c63ff' }}>
              <span className="text-white text-sm font-bold">G</span>
            </div>
            <span className="font-bold text-xl text-white">GTM Intel</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Set up your workspace</h1>
          <p className="text-sm" style={{ color: '#6b6b80' }}>
            AI will find and research your best-fit accounts automatically.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                  style={{ background: step >= s ? '#6c63ff' : '#1a1a24', color: step >= s ? 'white' : '#6b6b80' }}>
                  {step > s ? '✓' : s}
                </div>
                <span className="text-xs hidden sm:block" style={{ color: step === s ? '#e8e8f0' : '#6b6b80' }}>
                  {['About you', 'What you sell', 'ICP preferences'][i]}
                </span>
              </div>
              {i < 2 && <div className="flex-1 h-px mx-2" style={{ background: step > s ? '#6c63ff' : '#2a2a38' }} />}
            </div>
          ))}
        </div>

        {/* Step 1: About you */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white mb-4">About you</h2>
            {[
              { label: 'Your name', key: 'name', placeholder: 'e.g. John Smith', type: 'text' },
              { label: 'Work email', key: 'email', placeholder: 'you@company.com', type: 'email' },
              { label: 'Your company (optional)', key: 'company_name', placeholder: 'e.g. Acme Inc', type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>{f.label}</label>
                <input
                  type={f.type}
                  placeholder={f.placeholder}
                  value={form[f.key as keyof typeof form] as string}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                  style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
                />
              </div>
            ))}
            <button onClick={() => setStep(2)}
              disabled={!form.name || !form.email}
              className="w-full mt-2 py-3 rounded-lg font-semibold text-sm transition-all"
              style={{ background: '#6c63ff', color: 'white', opacity: (!form.name || !form.email) ? 0.5 : 1 }}>
              Continue →
            </button>
          </div>
        )}

        {/* Step 2: What you sell */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white mb-1">What do you sell?</h2>
            <p className="text-xs mb-4" style={{ color: '#6b6b80' }}>
              Be specific — AI uses this to find companies, generate research briefs, and write outreach.
            </p>

            {/* Quick examples */}
            <div>
              <p className="text-xs font-mono uppercase tracking-wider mb-2" style={{ color: '#6b6b80' }}>Quick examples — click to use</p>
              <div className="flex flex-wrap gap-2">
                {PRODUCT_EXAMPLES.map(ex => (
                  <button key={ex}
                    onClick={() => setForm({ ...form, product_description: ex })}
                    className="text-xs px-3 py-1.5 rounded-full transition-all"
                    style={{
                      background: form.product_description === ex ? '#6c63ff20' : 'transparent',
                      border: `1px solid ${form.product_description === ex ? '#6c63ff' : '#2a2a38'}`,
                      color: form.product_description === ex ? '#6c63ff' : '#6b6b80',
                    }}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Or describe in your own words</label>
              <textarea rows={4}
                placeholder="e.g. I sell an AI-powered GTM intelligence platform that helps B2B sales teams research target accounts faster, find verified contacts, and generate personalized outreach..."
                value={form.product_description}
                onChange={e => setForm({ ...form, product_description: e.target.value })}
                className="w-full px-4 py-3 rounded-lg text-sm outline-none resize-none"
                style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)}
                className="px-6 py-3 rounded-lg text-sm"
                style={{ background: '#1a1a24', color: '#6b6b80' }}>← Back</button>
              <button
                onClick={generateICP}
                disabled={!form.product_description || aiGenerating}
                className="flex-1 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                style={{ background: '#6c63ff', color: 'white', opacity: !form.product_description ? 0.5 : 1 }}>
                {aiGenerating
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> AI generating ICP...</>
                  : '✨ Generate ICP with AI →'}
              </button>
            </div>
            <button onClick={() => setStep(3)}
              className="w-full py-2 text-xs"
              style={{ color: '#6b6b80' }}>
              Set preferences manually instead →
            </button>
          </div>
        )}

        {/* Step 3: ICP preferences */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-white">Target account preferences</h2>
              {form.target_industries.length > 0 && (
                <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#16a34a20', color: '#16a34a' }}>
                  ✓ AI-generated
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Target industries</label>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map(ind => (
                  <button key={ind}
                    onClick={() => setForm({ ...form, target_industries: toggle(form.target_industries, ind) })}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: form.target_industries.includes(ind) ? '#6c63ff' : 'transparent',
                      border: `1px solid ${form.target_industries.includes(ind) ? '#6c63ff' : '#2a2a38'}`,
                      color: form.target_industries.includes(ind) ? 'white' : '#6b6b80',
                    }}>{ind}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Company sizes</label>
              <div className="flex flex-wrap gap-2">
                {COMPANY_SIZES.map(size => (
                  <button key={size}
                    onClick={() => setForm({ ...form, target_company_sizes: toggle(form.target_company_sizes, size) })}
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
              <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>ICP notes</label>
              <textarea rows={3}
                placeholder="e.g. Focus on companies raising Series B+, hiring in sales/RevOps, using Salesforce..."
                value={form.icp_notes}
                onChange={e => setForm({ ...form, icp_notes: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
              />
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl"
              style={{ background: '#1a1a24', border: '1px solid #2a2a38' }}>
              <div>
                <p className="font-medium text-white text-sm">Daily email digest</p>
                <p className="text-xs mt-0.5" style={{ color: '#6b6b80' }}>New signals every morning</p>
              </div>
              <button onClick={() => setForm({ ...form, notify_daily: !form.notify_daily })}
                className="w-12 h-6 rounded-full transition-all relative flex-shrink-0"
                style={{ background: form.notify_daily ? '#6c63ff' : '#2a2a38' }}>
                <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all"
                  style={{ left: form.notify_daily ? '26px' : '2px' }} />
              </button>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(2)}
                className="px-6 py-3 rounded-lg text-sm"
                style={{ background: '#1a1a24', color: '#6b6b80' }}>← Back</button>
              <button onClick={handleSubmit}
                disabled={!form.target_industries.length}
                className="flex-1 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                style={{ background: '#6c63ff', color: 'white', opacity: !form.target_industries.length ? 0.5 : 1 }}>
                🚀 Find my accounts →
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
