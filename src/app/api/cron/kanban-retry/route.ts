import { NextResponse } from 'next/server'
import { drainKanbanQueue } from '@/lib/kanban-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Daily safety net for the self-healing Kanban sync (see kanban-sync.ts):
// retries every job stuck in kanban_sync_queue, pings on recoveries, and
// alarms on jobs that still can't reach Command Centre. Invoked by the
// Vercel cron in vercel.json; Vercel authenticates it with CRON_SECRET.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await drainKanbanQueue({ limit: 20 })
  return NextResponse.json(summary)
}
