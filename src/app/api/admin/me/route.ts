import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if ('unauthorized' in auth) return auth.unauthorized
  return NextResponse.json({ email: auth.user.email })
}
