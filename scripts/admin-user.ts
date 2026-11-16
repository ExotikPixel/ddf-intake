// Manage admin logins.
//   set <email>     — reads the password from stdin (use scripts/admin-set.sh to be prompted)
//   list            — list admins
//   remove <email>  — remove an admin (their cookie stops working immediately)
// Needs DATABASE_URL, e.g. postgres://ddf:<pw>@127.0.0.1:5433/ddf
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

async function main() {
  const [cmd, emailArg] = process.argv.slice(2)
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  const email = (emailArg ?? '').trim().toLowerCase()
  try {
    if (cmd === 'set') {
      if (!email.includes('@')) throw new Error('usage: admin-user.ts set <email>  (password on stdin)')
      const password = await readStdin()
      if (password.length < 12) throw new Error('password must be at least 12 characters')
      const hash = await bcrypt.hash(password, 12)
      await sql`insert into admin_users (email, password_hash) values (${email}, ${hash})
        on conflict (email) do update set password_hash = excluded.password_hash`
      console.log(`✅ admin ${email} saved`)
    } else if (cmd === 'list') {
      const rows = await sql`select id, email, created_at, last_login_at from admin_users order by id`
      console.table(rows)
    } else if (cmd === 'remove') {
      const rows = await sql`delete from admin_users where email = ${email} returning id`
      console.log(rows.length ? `🗑️  removed ${email}` : `no admin ${email}`)
    } else {
      throw new Error('commands: set <email> | list | remove <email>')
    }
  } finally {
    await sql.end()
  }
}

main().catch(e => { console.error(`❌ ${(e as Error).message}`); process.exitCode = 1 })
