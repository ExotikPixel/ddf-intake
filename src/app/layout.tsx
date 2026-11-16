import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'
import './ui.css'

// Body + headings. Exposed as --font-geist-sans (Tailwind's font-sans and ui.css use it).
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

// The one script accent word in headings ("Tell us what you're *making.*").
// BP-JulietteEx2 by BlessedPrint (web licence held by the owner), trimmed to
// Latin letters, accents and punctuation to keep it light for phones.
const accent = localFont({
  src: './fonts/bp-juliette-ex2-regular.woff2',
  weight: '400',
  variable: '--font-accent',
  display: 'swap',
  // The file declares huge ascent/descent (2140/3500 per 1000), which pushes
  // the heading's lines apart; give it ordinary line metrics instead.
  declarations: [
    { prop: 'ascent-override', value: '95%' },
    { prop: 'descent-override', value: '30%' },
    { prop: 'line-gap-override', value: '0%' },
  ],
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
