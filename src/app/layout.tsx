import type { Metadata } from 'next'
import { Bricolage_Grotesque, Manrope } from 'next/font/google'
import './globals.css'

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-heading',
  weight: ['400', '600', '700', '800'],
})

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Submit a Job Brief — DDF-Pixel',
  description: 'Submit your print job brief to DDF-Pixel. All jobs submitted here only.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${manrope.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
