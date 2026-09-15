import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
  'application/postscript',      // AI / EPS (Chrome, Firefox)
  'application/illustrator',     // AI (Safari, some Windows setups)
  'image/x-eps',                 // EPS (some browsers)
  'application/x-eps',
  'image/svg+xml',
  'application/octet-stream',    // fallback for AI/EPS/SVG from some browsers
  '',                            // browsers that don't know the extension send no type at all
]
// Mirror of the job-files bucket's allowed_mime_types (Supabase rejects the PUT
// otherwise) — keep both lists in sync when adding a format.
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'pdf', 'ai', 'eps', 'svg']
const MAX_BYTES = 50 * 1024 * 1024

interface FileRequest {
  name: string
  type: string
  size: number
}

export async function POST(req: NextRequest) {
  let files: FileRequest[]
  try {
    const body = await req.json()
    files = body.files
    if (!Array.isArray(files) || files.length === 0 || files.length > 8) {
      return NextResponse.json({ error: 'Invalid files array' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  for (const f of files) {
    if (f.size > MAX_BYTES) {
      return NextResponse.json({ error: `${f.name} exceeds the 50MB limit` }, { status: 400 })
    }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_TYPES.includes(f.type) || !ALLOWED_EXTS.includes(ext)) {
      return NextResponse.json({ error: `${f.name}: file type not supported (use JPG, PNG, PDF, AI, EPS or SVG)` }, { status: 400 })
    }
  }

  const results: { path: string; signedUrl: string }[] = []
  for (const f of files) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? 'bin'
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { data, error } = await supabaseAdmin.storage
      .from('job-files')
      .createSignedUploadUrl(path)

    if (error || !data) {
      return NextResponse.json({ error: 'Could not create upload URL' }, { status: 500 })
    }
    results.push({ path, signedUrl: data.signedUrl })
  }

  return NextResponse.json({ uploads: results })
}
