import type { Metadata } from 'next'
import { Oswald, Montserrat } from 'next/font/google'
import './globals.css'

const oswald = Oswald({
  subsets: ['latin'],
  variable: '--font-heading',
  weight: ['400', '600', '700'],
})

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Submit a Job Brief — Pixel Production',
  description: 'Submit your print job brief to DDF Pixel Production. All jobs submitted here only.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${montserrat.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
