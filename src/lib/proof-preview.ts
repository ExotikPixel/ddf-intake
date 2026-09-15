'use client'

// Browser-side preview rendering for print files.
//
// PDFs — and Illustrator .ai files saved "PDF compatible" (Illustrator's
// default) — are rendered to a PNG of page 1 with pdf.js right in the
// uploader's browser, so the shop, the portal and the review page all get a
// real thumbnail without any server-side rendering. EPS (and the rare
// non-PDF-compatible .ai) can't be rendered in a browser; callers must ask
// the uploader for a JPG/PNG preview instead.

import { isImagePath } from '@/lib/job-types'

const PREVIEW_MAX_PX = 1400

/** Does this file need a preview image at all? (images never do) */
export function needsPreview(fileName: string): boolean {
  return !isImagePath(fileName)
}

async function looksLikePdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const text = new TextDecoder('latin1').decode(head)
  return text.includes('%PDF')
}

/**
 * Render page 1 of a PDF / PDF-compatible AI file to a PNG File.
 * Returns null when the file can't be rendered (EPS, corrupt, non-PDF .ai).
 */
export async function renderPrintFilePreview(file: File): Promise<File | null> {
  if (!needsPreview(file.name)) return null
  if (!(await looksLikePdf(file))) return null
  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(PREVIEW_MAX_PX / base.width, PREVIEW_MAX_PX / base.height, 4)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    await doc.cleanup()
    if (!blob) return null
    const stem = file.name.replace(/\.[^.]+$/, '')
    return new File([blob], `${stem}-preview.png`, { type: 'image/png' })
  } catch (e) {
    console.warn('[proof-preview] could not render', file.name, e)
    return null
  }
}

/**
 * Upload a preview PNG through the normal signed-URL flow. Returns its
 * job-files path, or null on failure (the proof still saves — just no thumbnail).
 */
export async function uploadPreviewFile(preview: File): Promise<string | null> {
  try {
    const urlRes = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ name: preview.name, type: preview.type, size: preview.size }] }),
    })
    if (!urlRes.ok) return null
    const { uploads } = await urlRes.json() as { uploads: { path: string; signedUrl: string }[] }
    const put = await fetch(uploads[0].signedUrl, { method: 'PUT', headers: { 'Content-Type': preview.type }, body: preview })
    return put.ok ? uploads[0].path : null
  } catch {
    return null
  }
}
