'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const INDUSTRIES = [
  'B2B SaaS', 'Fintech', 'HR Tech', 'MarTech', 'DevTools',
  'AI / ML', 'Cybersecurity', 'HealthTech', 'E-commerce', 'EdTech',
  'RevOps', 'Sales Tech', 'Customer Success', 'Legal Tech', 'PropTech',
]

const COMPANY_SIZES = [
  '1–50 (Startup)', '51–200 (Small)', '201–500 (Mid)', '501–1000 (Growth)', '1000+ (Enterprise)'
]

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    company_name: '',
    product_description: '',
    target_industries: [] as string[],
    target_company_sizes: [] as string[],
    icp_notes: '',
    notify_daily: true,
  })

  const toggleItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item]

  const handleSubmit = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.profile) {
        localStorage.setItem('gtm_profile_id', data.profile.id)
        localStorage.setItem('gtm_profile', JSON.stringify(data.profile))
        router.push('/dashboard')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0a0a0f' }}>
      <div className="w-full max-w-xl">

        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#6c63ff' }}>
              <span className="text-white text-sm font-bold">G</span>
            </div>
            <span className="font-display font-bold text-xl text-white">GTM Intel</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-2">Set up your sales profile</h1>
          <p className="text-sm" style={{ color: '#6b6b80' }}>
            Tell us what you sell — we&apos;ll tailor every research brief and signal to your product.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2 mb-8">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex-1 h-1 rounded-full transition-all duration-300"
              style={{ background: s <= step ? '#6c63ff' : '#2a2a38' }} />
          ))}
        </div>

        {/* Step 1 — Who you are */}
        {step === 1 && (
          <div className="animate-in">
            <h2 className="font-display text-xl font-bold text-white mb-6">About you</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Your name</label>
                <input
                  type="text"
                  placeholder="e.g. Sri Vatsanm"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
                  style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Work email</label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                  style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>Your company</label>
                <input
                  type="text"
                  placeholder="e.g. Salesforce, HubSpot"
                  value={form.company_name}
                  onChange={e => setForm({ ...form, company_name: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none"
                  style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
                />
              </div>
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!form.name || !form.email}
              className="w-full mt-6 py-3 rounded-lg font-semibold text-sm transition-all"
              style={{ background: '#6c63ff', color: 'white', opacity: (!form.name || !form.email) ? 0.5 : 1 }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 2 — What you sell */}
        {step === 2 && (
          <div className="animate-in">
            <h2 className="font-display text-xl font-bold text-white mb-6">What do you sell?</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>
                  Product / Service description
                </label>
                <textarea
                  rows={4}
                  placeholder="e.g. I sell a revenue intelligence platform that helps enterprise sales teams improve forecast accuracy and pipeline visibility. It integrates with Salesforce and surfaces AI-driven insights for RevOps and sales leadership..."
                  value={form.product_description}
                  onChange={e => setForm({ ...form, product_description: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none resize-none"
                  style={{ background: '#1a1a24', border: '1px solid #2a2a38', color: '#e8e8f0' }}
                />
                <p className="text-xs mt-1" style={{ color: '#6b6b80' }}>
                  Be specific — this is how we tailor every research brief and outreach message to your product.
                </p>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>
                  Target industries (pick all that apply)
                </label>
                <div className="flex flex-wrap gap-2">
                  {INDUSTRIES.map(ind => (
                    <button
                      key={ind}
                      onClick={() => setForm({ ...form, target_industries: toggleItem(form.target_industries, ind) })}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                      style={{
                        background: form.target_industries.includes(ind) ? '#6c63ff' : 'transparent',
                        border: `1px solid ${form.target_industries.includes(ind) ? '#6c63ff' : '#2a2a38'}`,
                        color: form.target_industries.includes(ind) ? 'white' : '#6b6b80',
                      }}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>
                  Target company sizes
                </label>
                <div className="flex flex-wrap gap-2">
                  {COMPANY_SIZES.map(size => (
                    <button
                      key={size}
                      onClick={() => setForm({ ...form, target_company_sizes: toggleItem(form.target_company_sizes, size) })}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                      style={{
                        background: form.target_company_sizes.includes(size) ? '#6c63ff' : 'transparent',
                        border: `1px solid ${form.target_company_sizes.includes(size) ? '#6c63ff' : '#2a2a38'}`,
                        color: form.target_company_sizes.includes(size) ? 'white' : '#6b6b80',
                      }}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="px-6 py-3 rounded-lg text-sm font-medium" style={{ background: '#1a1a24', color: '#6b6b80' }}>
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!form.product_description || form.target_industries.length === 0}
                className="flex-1 py-3 rounded-lg font-semibold text-sm"
                style={{ background: '#6c63ff', color: 'white', opacity: (!form.product_description || form.target_industries.length === 0) ? 0.5 : 1 }}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Notifications */}
        {step === 3 && (
          <div className="animate-in">
            <h2 className="font-display text-xl font-bold text-white mb-2">Daily digest</h2>
            <p className="text-sm mb-6" style={{ color: '#6b6b80' }}>
              Every morning at 7am, we&apos;ll email you new signals from your tracked accounts.
            </p>
            <div className="rounded-xl p-6 mb-6" style={{ background: '#1a1a24', border: '1px solid #2a2a38' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-medium text-white text-sm">Daily email digest</p>
                  <p className="text-xs mt-1" style={{ color: '#6b6b80' }}>New signals, AI briefing, and outreach cues</p>
                </div>
                <button
                  onClick={() => setForm({ ...form, notify_daily: !form.notify_daily })}
                  className="w-12 h-6 rounded-full transition-all relative"
                  style={{ background: form.notify_daily ? '#6c63ff' : '#2a2a38' }}
                >
                  <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all"
                    style={{ left: form.notify_daily ? '26px' : '2px' }} />
                </button>
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#6b6b80' }}>
                  Additional ICP notes (optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Focus on companies that recently raised Series B+, hiring RevOps roles, or have Salesforce in their tech stack..."
                  value={form.icp_notes}
                  onChange={e => setForm({ ...form, icp_notes: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                  style={{ background: '#0a0a0f', border: '1px solid #2a2a38', color: '#e8e8f0' }}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="px-6 py-3 rounded-lg text-sm font-medium" style={{ background: '#1a1a24', color: '#6b6b80' }}>
                ← Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2"
                style={{ background: '#6c63ff', color: 'white' }}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Setting up...
                  </>
                ) : (
                  'Launch GTM Intel →'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
