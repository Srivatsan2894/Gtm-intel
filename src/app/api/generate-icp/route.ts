import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { product_description } = await req.json()
    if (!product_description) return NextResponse.json({ error: 'product_description required' }, { status: 400 })

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const groqKey = process.env.GROQ_API_KEY

    const prompt = `A sales rep describes what they sell: "${product_description}"

Based on this, generate their Ideal Customer Profile (ICP).

Return ONLY this JSON:
{
  "industries": ["B2B SaaS", "AI / ML", "Sales Tech"],
  "sizes": ["201–500 (Mid)", "501–1000 (Growth)"],
  "icp_notes": "Focus on companies that are [specific criteria based on what they sell]. Prioritize companies [buying signals]. Avoid [exclusions].",
  "search_keywords": ["keyword1", "keyword2", "keyword3"]
}

Industries must be chosen from: B2B SaaS, Fintech, HR Tech, MarTech, DevTools, AI / ML, Cybersecurity, HealthTech, E-commerce, EdTech, RevOps, Sales Tech, Customer Success, Legal Tech, PropTech
Sizes must be chosen from: 1–50 (Startup), 51–200 (Small), 201–500 (Mid), 501–1000 (Growth), 1000+ (Enterprise)`

    let raw = ''

    if (anthropicKey && anthropicKey !== 'placeholder_add_later') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await res.json()
      raw = data.content?.[0]?.text || ''
    } else if (groqKey) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0.1,
        }),
      })
      const data = await res.json()
      raw = data.choices?.[0]?.message?.content || ''
    }

    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) return NextResponse.json({ error: 'Failed to generate ICP' }, { status: 500 })

    const icp = JSON.parse(match[0])
    return NextResponse.json(icp)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
