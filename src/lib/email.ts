import { Resend } from 'resend'

function getResend() {
  if (!process.env.RESEND_API_KEY) return null
  return new Resend(process.env.RESEND_API_KEY)
}

interface DigestSignal {
  company: string; signal_type: string; title: string
  summary: string; source_name: string; source_url: string; signal_date: string
}
interface DigestData {
  repName: string; repEmail: string; salesDescription: string
  date: string; aiSummary: string; signals: DigestSignal[]; appUrl: string
}

export function buildDigestHTML(data: DigestData): string { return '' }

export async function sendDigestEmail(data: DigestData) {
  const resend = getResend()
  if (!resend) { console.log('Resend not configured — skipping'); return null }
  const { data: result, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'GTM Intel <digest@gtmintel.app>',
    to: data.repEmail,
    subject: `${data.signals.length} new signals — ${data.date}`,
    html: `<p>Hi ${data.repName}, you have ${data.signals.length} new signals.</p>`,
  })
  if (error) throw new Error(`Email failed: ${error.message}`)
  return result
}
