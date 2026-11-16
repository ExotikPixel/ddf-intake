import { NextRequest, NextResponse } from 'next/server'
import { verifyUploadToken } from '@/lib/file-tokens'
import { writeStream, TooLargeError, MAX_UPLOAD_BYTES } from '@/lib/file-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Receives the browser's PUT of a file to the URL returned by /api/upload-url.
// The token fixes the key, content type and maximum size.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const claims = verifyUploadToken(token)
  if (!claims) return NextResponse.json({ error: 'Upload link expired — please try again.' }, { status: 403 })

  const type = (req.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
  if (type !== claims.type) return NextResponse.json({ error: 'File type mismatch' }, { status: 400 })

  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > claims.size) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }
  if (!req.body) return NextResponse.json({ error: 'Empty upload' }, { status: 400 })

  try {
    await writeStream(claims.key, req.body, Math.min(claims.size, MAX_UPLOAD_BYTES))
  } catch (e) {
    if (e instanceof TooLargeError) return NextResponse.json({ error: 'File too large' }, { status: 413 })
    console.error('[upload] write failed:', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
  return new NextResponse(null, { status: 200 })
}
