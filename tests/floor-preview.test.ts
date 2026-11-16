import { describe, it, expect } from 'vitest'
import { wantsFloorPreview } from '@/lib/floor-preview'

describe('wantsFloorPreview', () => {
  it('uses the admin flag first', () => {
    expect(wantsFloorPreview({ name: 'Welcome sign', preview: 'floor' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Monogram dance floor wrap', preview: 'flat' })).toBe(false)
  })
  it('otherwise detects floor pieces by name', () => {
    expect(wantsFloorPreview({ name: 'Monogram dance floor wrap' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Floor decal 16x16' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Nov 19 - Dancefloor' })).toBe(true)
    expect(wantsFloorPreview({ name: 'Welcome sign' })).toBe(false)
    expect(wantsFloorPreview({ name: 'Floral arch' })).toBe(false)
  })
})
