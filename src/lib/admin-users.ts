import 'server-only'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

export interface AdminUserRow { id: number; email: string; password_hash: string }

const COST = 12
const norm = (email: string) => email.trim().toLowerCase()

export const hashPassword = (pw: string) => bcrypt.hash(pw, COST)
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash)

let dummy: Promise<string> | null = null
/** A real bcrypt hash to compare against when the email is unknown (equal timing). */
export function dummyHash(): Promise<string> {
  dummy ??= bcrypt.hash('not-a-real-password-' + Math.random(), COST)
  return dummy
}

export async function findAdminByEmail(email: string): Promise<AdminUserRow | null> {
  const rows = await db()<AdminUserRow[]>`select id, email, password_hash from admin_users where email = ${norm(email)}`
  return rows[0] ?? null
}

export async function adminExists(id: number): Promise<boolean> {
  return (await db()`select 1 from admin_users where id = ${id}`).length === 1
}

export async function touchAdminLogin(id: number): Promise<void> {
  await db()`update admin_users set last_login_at = now() where id = ${id}`
}

export async function upsertAdmin(email: string, password: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`
    insert into admin_users (email, password_hash) values (${norm(email)}, ${await hashPassword(password)})
    on conflict (email) do update set password_hash = excluded.password_hash
    returning id`
  return row.id
}
