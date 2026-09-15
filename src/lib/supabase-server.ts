import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role client — SERVER ONLY. Never import this in client components.
//
// Created lazily on first use rather than at import time: `next build`
// evaluates route modules while collecting page data, and an environment
// without Supabase vars (Vercel Preview builds, CI) used to crash the whole
// build with "supabaseUrl is required" even though every route is dynamic and
// never runs at build time. Missing env now fails only when a request actually
// needs the database.
let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing')
  }
  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  return client
}

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const real = getClient()
    const value = Reflect.get(real, prop, receiver)
    return typeof value === 'function' ? value.bind(real) : value
  },
})
