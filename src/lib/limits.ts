// Upload and brief limits (spec A1c). One place, shared by the intake form, the
// portal "Add to job" form, the zod schemas and /api/upload-url.
export const MAX_PIECES = 30            // pieces per brief, and per "Add to job"
export const MAX_FILES = 10             // job-level files per brief / add
export const MAX_ITEM_FILES = 8         // reference photos or final files per piece
export const MAX_FILE_MB = 95           // Cloudflare's free plan caps one upload at 100 MB
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
export const UPLOAD_BATCH = 10          // files per /api/upload-url request
