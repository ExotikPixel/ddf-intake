import type { Metadata, Viewport } from 'next'
import { Geist, Pinyon_Script } from 'next/font/google'
import './globals.css'
import './ui.css'

// Body + headings. Exposed as --font-geist-sans (Tailwind's font-sans and ui.css use it).
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

// The one script accent word in headings ("Tell us what you're *making.*").
const accent = Pinyon_Script({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-accent',
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
    <html lang="en" className={`${geist.variable} ${accent.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
