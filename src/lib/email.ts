import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

interface DigestSignal {
  company: string
  signal_type: string
  title: string
  summary: string
  source_name: string
  source_url: string
  signal_date: string
}

interface DigestData {
  repName: string
  repEmail: string
  salesDescription: string
  date: string
  aiSummary: string
  signals: DigestSignal[]
  appUrl: string
}

function signalTypeLabel(type: string): string {
  const map: Record<string, string> = {
    funding: '💰 Funding',
    hiring: '🧑‍💼 Hiring',
    product_launch: '🚀 Product Launch',
    leadership_change: '👤 Leadership Change',
    expansion: '📈 Expansion',
    partnership: '🤝 Partnership',
    press: '📰 Press',
    financial: '💹 Financial',
    competitive: '⚔️ Competitive',
    other: '📌 Signal',
  }
  return map[type] || '📌 Signal'
}

function signalColor(type: string): string {
  const map: Record<string, string> = {
    funding: '#16a34a',
    hiring: '#2563eb',
    product_launch: '#9333ea',
    leadership_change: '#ea580c',
    expansion: '#0891b2',
    partnership: '#65a30d',
    press: '#6b7280',
    financial: '#b45309',
    competitive: '#dc2626',
    other: '#6b7280',
  }
  return map[type] || '#6b7280'
}

export function buildDigestHTML(data: DigestData): string {
  const groupedByCompany = data.signals.reduce((acc, s) => {
    if (!acc[s.company]) acc[s.company] = []
    acc[s.company].push(s)
    return acc
  }, {} as Record<string, DigestSignal[]>)

  const companySections = Object.entries(groupedByCompany)
    .map(([company, signals]) => `
      <div style="margin-bottom:28px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
        <div style="background:#111827; padding:12px 20px;">
          <h3 style="margin:0; color:#f9fafb; font-size:15px; font-weight:600;">${company}</h3>
          <p style="margin:2px 0 0; color:#9ca3af; font-size:12px;">${signals.length} new signal${signals.length > 1 ? 's' : ''}</p>
        </div>
        ${signals.map(s => `
          <div style="padding:16px 20px; border-top:1px solid #f3f4f6; background:#ffffff;">
            <div style="display:flex; align-items:flex-start; gap:10px;">
              <span style="display:inline-block; background:${signalColor(s.signal_type)}20; color:${signalColor(s.signal_type)}; font-size:11px; font-weight:600; padding:2px 8px; border-radius:4px; white-space:nowrap; margin-top:2px;">${signalTypeLabel(s.signal_type)}</span>
              <div>
                <p style="margin:0 0 6px; font-size:14px; font-weight:600; color:#111827;">${s.title}</p>
                <p style="margin:0 0 8px; font-size:13px; color:#4b5563; line-height:1.6;">${s.summary}</p>
                <p style="margin:0; font-size:11px; color:#9ca3af;">
                  Source: <a href="${s.source_url}" style="color:#6c63ff; text-decoration:none;">${s.source_name}</a>
                  ${s.signal_date ? ` · ${s.signal_date}` : ''}
                </p>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GTM Intel Daily Digest</title>
</head>
<body style="margin:0; padding:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <div style="max-width:640px; margin:0 auto; padding:32px 16px;">

    <!-- Header -->
    <div style="background:#111827; border-radius:12px 12px 0 0; padding:28px 32px; margin-bottom:0;">
      <p style="margin:0 0 4px; font-size:11px; letter-spacing:0.15em; text-transform:uppercase; color:#6c63ff; font-weight:600;">GTM Intel · Daily Digest</p>
      <h1 style="margin:0 0 4px; font-size:22px; font-weight:700; color:#f9fafb;">Your prospect signals for ${data.date}</h1>
      <p style="margin:0; font-size:13px; color:#9ca3af;">Hi ${data.repName} · ${data.signals.length} new signal${data.signals.length > 1 ? 's' : ''} across ${Object.keys(groupedByCompany).length} account${Object.keys(groupedByCompany).length > 1 ? 's' : ''}</p>
    </div>

    <!-- AI Summary -->
    <div style="background:#6c63ff; padding:20px 32px; margin-bottom:24px; border-radius:0 0 0 0;">
      <p style="margin:0 0 6px; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:rgba(255,255,255,0.7); font-weight:600;">AI Briefing</p>
      <p style="margin:0; font-size:14px; color:#ffffff; line-height:1.7;">${data.aiSummary}</p>
    </div>

    <!-- Signals by Company -->
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 16px; font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#6b7280; font-weight:600;">New Signals</p>
      ${companySections}
    </div>

    <!-- CTA -->
    <div style="text-align:center; margin-bottom:32px;">
      <a href="${data.appUrl}/dashboard" style="display:inline-block; background:#6c63ff; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:14px; font-weight:600; letter-spacing:0.02em;">
        Open GTM Intel Dashboard →
      </a>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #e5e7eb; padding-top:20px; text-align:center;">
      <p style="margin:0 0 4px; font-size:12px; color:#9ca3af;">GTM Intel · Sales Intelligence Platform</p>
      <p style="margin:0; font-size:11px; color:#d1d5db;">
        Selling: ${data.salesDescription}
      </p>
      <p style="margin:8px 0 0; font-size:11px; color:#d1d5db;">
        <a href="${data.appUrl}/settings" style="color:#6c63ff; text-decoration:none;">Manage notifications</a>
        &nbsp;·&nbsp;
        <a href="${data.appUrl}/unsubscribe" style="color:#9ca3af; text-decoration:none;">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>
`
}

export async function sendDigestEmail(data: DigestData) {
  const html = buildDigestHTML(data)

  const { data: result, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'GTM Intel <digest@gtmintel.app>',
    to: data.repEmail,
    subject: `${data.signals.length} new signal${data.signals.length > 1 ? 's' : ''} across your accounts — ${data.date}`,
    html,
  })

  if (error) throw new Error(`Email send failed: ${error.message}`)
  return result
}
