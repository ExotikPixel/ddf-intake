// Cloudflare Worker in front of jobs.ddfpixel.com. Every request goes to the
// shop PC through the tunnel; if the PC is unreachable (reboot, power, internet),
// clients get a friendly page instead of a Cloudflare error.
const ORIGIN_DOWN = new Set([502, 521, 522, 523, 524, 530])

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const res = await fetch(request)
      return ORIGIN_DOWN.has(res.status) ? offline(request) : res
    } catch {
      return offline(request)
    }
  },
}

function offline(request: Request): Response {
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '300' }
  if (new URL(request.url).pathname.startsWith('/api/')) {
    return Response.json(
      { error: 'offline', message: 'Our job system is offline for a moment. Please try again shortly.' },
      { status: 503, headers },
    )
  }
  return new Response(PAGE, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DDF x Pixel — back shortly</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f3ee;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f1f1f}
  .card{background:#fff;border:1px solid #e3ded6;max-width:440px;margin:24px;padding:40px 32px;text-align:center}
  .brand{font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#b8955a;font-size:14px;margin-bottom:18px}
  h1{font-size:22px;margin:0 0 10px} p{color:#555;line-height:1.6;font-size:15px;margin:0 0 10px}
  a{color:#b8955a;font-weight:700;text-decoration:none}
</style></head>
<body><div class="card">
  <div class="brand">DDF x Pixel</div>
  <h1>We’ll be right back</h1>
  <p>Our job and proof system is offline for a moment. Your files and approvals are safe.</p>
  <p>Please try again in a few minutes, or email <a href="mailto:hello@ddfevents.ca">hello@ddfevents.ca</a>.</p>
</div></body></html>`
