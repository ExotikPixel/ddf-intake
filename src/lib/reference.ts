import { randomBytes } from 'crypto'

export function generateReferenceNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = randomBytes(3).toString('hex').toUpperCase()
  return `DDF-${date}-${suffix}`
}
