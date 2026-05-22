import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
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

  const { paths } = await req.json() as { paths: string[] }
  if (!paths || !Array.isArray(paths)) {
    return NextResponse.json({ error: 'Invalid paths' }, { status: 400 })
  }

  // Generate signed URLs valid for 1 hour
  const urls: { path: string; url: string; name: string }[] = []
  for (const path of paths) {
    const { data } = await supabaseAdmin.storage
      .from('job-files')
      .createSignedUrl(path, 60 * 60)
    if (data?.signedUrl) {
      urls.push({
        path,
        url: data.signedUrl,
        name: path.split('/').pop() ?? path,
      })
    }
  }

  return NextResponse.json({ urls })
}
