import { NextRequest, NextResponse } from 'next/server'
import { signUploadPath } from '@/lib/file-tokens'
import { MAX_FILE_BYTES, MAX_FILE_MB, UPLOAD_BATCH } from '@/lib/limits'

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
  'image/vnd.dxf',               // DXF (CNC cut files)
  'application/dxf',
  'image/x-dxf',
  'application/octet-stream',    // fallback for AI/EPS/SVG from some browsers
  '',                            // browsers that don't know the extension send no type at all
]
// Allowed upload extensions — keep in sync with ALLOWED_TYPES.
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'pdf', 'ai', 'eps', 'svg', 'dxf']

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
    if (!Array.isArray(files) || files.length === 0 || files.length > UPLOAD_BATCH) {
      return NextResponse.json({ error: 'Invalid files array' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  for (const f of files) {
    if (!Number.isSafeInteger(f.size) || f.size < 0) {
      return NextResponse.json({ error: `${f.name}: invalid file size` }, { status: 400 })
    }
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${f.name} is over the ${MAX_FILE_MB} MB limit. Share a WeTransfer or Google Drive link in the notes instead.` }, { status: 400 })
    }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_TYPES.includes(f.type) || !ALLOWED_EXTS.includes(ext)) {
      return NextResponse.json({ error: `${f.name}: file type not supported (use JPG, PNG, PDF, AI, EPS, SVG or DXF)` }, { status: 400 })
    }
  }

  const results: { path: string; signedUrl: string }[] = []
  for (const f of files) {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? 'bin'
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    // Sign the exact type the browser will send (they all send `type || octet-stream`).
    results.push({ path, signedUrl: signUploadPath(path, f.type || 'application/octet-stream', f.size) })
  }

  return NextResponse.json({ uploads: results })
}
