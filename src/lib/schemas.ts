import { z } from 'zod'

export const ItemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  size: z.string().min(1, 'Size is required'),
  material: z.enum(['vinyl', 'fabric', 'foam-board', 'acrylic', 'other']),
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
  _hp: z.string().optional(),
})

export type SubmitInput = z.infer<typeof SubmitSchema>
export type ItemInput = z.infer<typeof ItemSchema>

export const JobPatchNotifySchema = z.object({
  notify_client: z.boolean(),
})

export type JobPatchNotifyInput = z.infer<typeof JobPatchNotifySchema>
