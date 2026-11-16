// While old Supabase jobs are being restored (Phase 2), tell clients why their
// older job or link isn't found. Set LEGACY_RESTORE_NOTICE=0 after the import.
export const LEGACY_NOTICE = 'Jobs submitted before Nov 16, 2026 are being restored — email hello@ddfevents.ca and we’ll help right away.'

export function legacyNoticeOn(): boolean {
  return process.env.LEGACY_RESTORE_NOTICE === '1'
}
