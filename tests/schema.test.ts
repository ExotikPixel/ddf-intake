import { describe, it, expect, beforeAll } from 'vitest'
import { hasDb, applySchema, resetTables, rawSql } from './helpers/db'

describe.skipIf(!hasDb)('db/schema.sql', () => {
  beforeAll(() => applySchema())

  it('is idempotent (applies twice without error)', () => {
    expect(() => applySchema()).not.toThrow()
  })

  it('seeds the ddf tenant with branding', async () => {
    const sql = rawSql()
    const [row] = await sql`
      select t.slug, s.brand_color, s.reply_to_email
      from tenants t join tenant_settings s on s.tenant_id = t.id where t.slug = 'ddf'`
    await sql.end()
    expect(row).toEqual({ slug: 'ddf', brand_color: '#b8955a', reply_to_email: 'hello@ddfevents.ca' })
  })

  it('starts job ids at 1,000,000 and defaults tenant_id + notify_client', async () => {
    await resetTables()
    const sql = rawSql()
    const [row] = await sql`
      insert into jobs (reference_number, submission_id, client_name, company_name, contact_email, date_required)
      values ('DDF-SCHEMA-1', gen_random_uuid(), 'A', 'B', 'a@b.co', '2030-01-01')
      returning id::int as id, tenant_id is not null as has_tenant, notify_client, status`
    await sql.end()
    expect(row).toEqual({ id: 1000000, has_tenant: true, notify_client: false, status: 'pending' })
  })

  it('rejects a non-normalized admin email', async () => {
    const sql = rawSql()
    await expect(sql`insert into admin_users (email, password_hash) values ('Tony@X.com', 'h')`).rejects.toThrow()
    await sql.end()
  })
})
