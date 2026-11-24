import { z } from 'zod'
import { paginationQueryFields } from '../utils/pagination'

/**
 * Feedback request validation.
 *
 * A rating is a bounded integer (1–5) and the comment is free text. The booking
 * is taken from the path and the author from the session, so neither is ever
 * client-supplied here.
 */

export const createFeedbackSchema = z.object({
  rating: z
    .number()
    .int('Rating must be a whole number.')
    .min(1, 'Rating must be between 1 and 5.')
    .max(5, 'Rating must be between 1 and 5.'),
  comment: z.string().trim().max(1000, 'A comment may be at most 1000 characters.').optional()
})

export const listFeedbackQuerySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  bookingId: z.string().trim().min(1).optional(),
  ...paginationQueryFields
})

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>
export type ListFeedbackQuery = z.infer<typeof listFeedbackQuerySchema>
