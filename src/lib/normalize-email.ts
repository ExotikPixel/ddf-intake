// Emails are matched, not just displayed: a client signs in (or looks up their
// job) and we compare their address to the one saved on the brief. Supabase
// Auth hands emails back lowercased, and people type stray caps/spaces on the
// intake form — so every write and every comparison must go through this, or a
// client who typed "John@Company.com" is locked out of their own job.
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

// True when two addresses are the same ignoring case/whitespace.
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeEmail(a)
  return na.length > 0 && na === normalizeEmail(b)
}
