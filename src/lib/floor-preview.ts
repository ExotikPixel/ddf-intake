import type { JobItem } from '@/lib/job-types'

// Spec default ⚑4: the "On the floor" perspective preview shows for pieces whose
// name says floor (dance floor wraps, floor decals), unless the admin flagged the
// piece with preview: 'floor' | 'flat' in the job drawer.
// `preview` is added to JobItem by Plan B, so it is declared locally for now.
export function wantsFloorPreview(item: Pick<JobItem, 'name'> & { preview?: 'floor' | 'flat' }): boolean {
  if (item.preview === 'floor') return true
  if (item.preview === 'flat') return false
  return /floor/i.test(item.name)
}
