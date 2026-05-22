import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  // Verify admin session
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use service role to bypass RLS and fetch ALL jobs
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .select('*')
    .order('submitted_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }

  return NextResponse.json({ jobs: data })
}
