import type { Metadata, Viewport } from 'next'
import { Geist, Instrument_Serif } from 'next/font/google'
import './globals.css'
import './ui.css'

// Body + headings. Exposed as --font-geist-sans (Tailwind's font-sans and ui.css use it).
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

// The one italic accent word in headings ("Tell us what you're *making.*").
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ebe6e1',
}

export const metadata: Metadata = {
  title: 'Send a brief — DDF x Pixel',
  description: 'Send your event or fabrication brief to DDF x Pixel. Quotes, proofs and approvals in one place.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
