import 'server-only'

const TOPIC = process.env.NTFY_TOPIC_URL

interface NtfyOpts {
  title?: string
  message: string
  tags?: string                    // comma-separated emoji shortcodes, e.g. "inbox_tray"
  priority?: 1 | 2 | 3 | 4 | 5
  clickUrl?: string
}

// Best-effort phone push via ntfy. No-op if NTFY_TOPIC_URL is unset, and never
// throws — a notification failure must not break the request that triggered it.
export async function sendNtfy(opts: NtfyOpts): Promise<void> {
  if (!TOPIC) return
  // ntfy header values must be latin-1; strip non-ASCII from title/tags (body is UTF-8 and fine).
  const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, '').trim()
  try {
    await fetch(TOPIC, {
      method: 'POST',
      headers: {
        ...(opts.title ? { Title: ascii(opts.title) } : {}),
        ...(opts.tags ? { Tags: ascii(opts.tags) } : {}),
        ...(opts.priority ? { Priority: String(opts.priority) } : {}),
        ...(opts.clickUrl ? { Click: opts.clickUrl } : {}),
      },
      body: opts.message,
    })
  } catch (e) {
    console.error('[ntfy] send failed:', e)
  }
}
