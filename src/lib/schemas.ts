import { z } from 'zod'

export const ItemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  size: z.string().min(1, 'Size is required'),
  material: z.enum(['vinyl', 'fabric', 'foam-board', 'acrylic', 'other']),
  // Optional approval fields — preserved on edit, set by admin (proof) and client (status)
  proof_urls: z.array(z.string()).optional(),
  proof_url: z.string().optional(),
  proof_history: z.array(z.string()).optional(),
  approval_status: z.enum(['pending', 'approved', 'changes_requested']).optional(),
  approved_proof_url: z.string().optional(),
  designs_mode: z.enum(['all', 'pick']).optional(),
  messages: z.array(z.object({
    from: z.enum(['client', 'shop']),
    text: z.string().max(2000),
    at: z.string(),
  })).optional(),
  client_note: z.string().optional(),
  approved_at: z.string().optional(),
})

export const SubmitSchema = z.object({
  clientName: z.string().min(1, 'Client name is required'),
  companyName: z.string().min(1, 'Company name is required'),
  contactEmail: z.string().email('Invalid email address'),
  // ISO date string (YYYY-MM-DD); stored as date type in Postgres
  dateRequired: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  eventName: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(ItemSchema).min(1, 'At least one item is required').max(10),
  filePaths: z.array(z.string()).max(3),
  submissionId: z.string().uuid('Invalid submission ID'),
  // Which workspace this intake belongs to (from the /s/{slug} URL). Optional —
  // the root form omits it and the server falls back to the default tenant.
  tenantSlug: z.string().max(64).optional(),
  _hp: z.string().optional(),
})

export type SubmitInput = z.infer<typeof SubmitSchema>
export type ItemInput = z.infer<typeof ItemSchema>

export const JobPatchNotifySchema = z.object({
  notify_client: z.boolean(),
})

export type JobPatchNotifyInput = z.infer<typeof JobPatchNotifySchema>

// Client design-approval action (one item at a time, by index)
export const ApprovalActionSchema = z.object({
  itemIndex: z.number().int().min(0),
  action: z.enum(['approve', 'request_changes']),
  note: z.string().max(2000).optional(),
  // When the item has several proofs, the path of the one design the client chose.
  selectedProof: z.string().optional(),
})

export type ApprovalActionInput = z.infer<typeof ApprovalActionSchema>
