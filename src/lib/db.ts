import 'server-only'
import postgres from 'postgres'
import { pgTimestampToIso } from '@/lib/pg-time'

// One lazily-created connection pool per server process. Created on first use
// (not at import) so `next build` works without a database.
export function makeSql(url: string) {
  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // Parsers are keyed by Postgres type OID and override the library defaults.
      date: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x, // keep 'YYYY-MM-DD'
      },
      timestamptz: {
        to: 1184,
        from: [1114, 1184],
        serialize: (x: string | Date) => (x instanceof Date ? x.toISOString() : x),
        parse: (x: string) => pgTimestampToIso(x),
      },
      int8: {
        to: 20,
        from: [20],
        serialize: (x: number | bigint) => x.toString(),
        parse: (x: string) => Number(x), // ids stay < 2^53
      },
    },
  })
}

export type Sql = ReturnType<typeof makeSql>

// Cached on globalThis so Next dev hot reloads reuse one pool instead of leaking a new one each time.
const g = globalThis as typeof globalThis & { __ddfSql?: Sql }

export function db(): Sql {
  if (g.__ddfSql) return g.__ddfSql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  g.__ddfSql = makeSql(url)
  return g.__ddfSql
}
