import { z } from 'zod'
import { paginationQueryFields } from '../utils/pagination'

/**
 * Complaint request validation.
 *
 * A complaint may reference a booking the caller can already access (checked in
 * the service), but the complainant and the state snapshot are always derived
 * server-side — never trusted from the body.
 */

export const COMPLAINT_CATEGORY_VALUES = [
  'SERVICE_QUALITY',
  'DELAY',
  'STAFF_CONDUCT',
  'BILLING',
  'SAFETY',
  'EQUIPMENT',
  'OTHER'
] as const

export const COMPLAINT_STATUS_VALUES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED'] as const

export const complaintCategorySchema = z.enum(COMPLAINT_CATEGORY_VALUES)
export const complaintStatusSchema = z.enum(COMPLAINT_STATUS_VALUES)

export const createComplaintSchema = z.object({
  category: complaintCategorySchema,
  subject: z.string().trim().min(3, 'A subject is required.').max(150),
  description: z.string().trim().min(10, 'Please describe the issue (at least 10 characters).').max(4000),
  /** Optional reference to a booking the complainant can access. */
  bookingId: z.string().trim().min(1).optional()
})

export const listComplaintsQuerySchema = z.object({
  status: complaintStatusSchema.optional(),
  category: complaintCategorySchema.optional(),
  bookingId: z.string().trim().min(1).optional(),
  ...paginationQueryFields
})

/** A complaint status change. `note`/`resolution` are internal handling text. */
export const updateComplaintStatusSchema = z.object({
  status: complaintStatusSchema,
  note: z.string().trim().max(1000).optional(),
  resolution: z.string().trim().max(2000).optional(),
  assignedToId: z.string().trim().min(1).optional()
})

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>
export type ListComplaintsQuery = z.infer<typeof listComplaintsQuerySchema>
export type UpdateComplaintStatusInput = z.infer<typeof updateComplaintStatusSchema>
export type ComplaintCategoryValue = (typeof COMPLAINT_CATEGORY_VALUES)[number]
export type ComplaintStatusValue = (typeof COMPLAINT_STATUS_VALUES)[number]
