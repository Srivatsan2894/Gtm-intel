import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GTM Intel — Sales Intelligence Platform',
  description: 'AI-powered prospect research, contact discovery, and daily signal alerts for B2B sales teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
