import 'server-only'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

export interface AdminUserRow { id: number; email: string; password_hash: string; session_version: number }

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
  const rows = await db()<AdminUserRow[]>`select id, email, password_hash, session_version from admin_users where email = ${norm(email)}`
  return rows[0] ?? null
}

/** True only if the admin still exists AND the session's version matches (a password reset bumps it). */
export async function adminSessionValid(id: number, sessionVersion: number): Promise<boolean> {
  return (await db()`select 1 from admin_users where id = ${id} and session_version = ${sessionVersion}`).length === 1
}

export async function touchAdminLogin(id: number): Promise<void> {
  await db()`update admin_users set last_login_at = now() where id = ${id}`
}

export async function upsertAdmin(email: string, password: string): Promise<number> {
  const [row] = await db()<{ id: number }[]>`
    insert into admin_users (email, password_hash) values (${norm(email)}, ${await hashPassword(password)})
    on conflict (email) do update set password_hash = excluded.password_hash,
      session_version = admin_users.session_version + 1
    returning id`
  return row.id
}
