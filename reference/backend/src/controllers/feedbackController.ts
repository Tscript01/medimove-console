import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { paginationMeta, parsePagination } from '../utils/pagination'
import { toFeedback } from '../utils/serializers'
import { loadFeedbackForUser } from '../utils/access'
import { createFeedback, getBookingFeedback, listFeedback } from '../services/feedbackService'
import { listFeedbackQuerySchema } from '../validation/feedback.schemas'
import type { CreateFeedbackInput } from '../validation/feedback.schemas'

/**
 * Feedback HTTP handlers. Business rules (ownership, ratable status, one per
 * trip) live in `services/feedbackService`; handlers only translate HTTP.
 */

// POST /api/bookings/:id/feedback (requester only)
export const createFeedbackController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as CreateFeedbackInput
  const feedback = await createFeedback(actor, String(req.params.id ?? ''), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'feedback.create',
    resourceType: 'Feedback',
    resourceId: feedback.id,
    metadata: { bookingId: feedback.bookingId, rating: feedback.rating },
    ...requestMeta(req)
  })

  res.status(201).json({ success: true, feedback: toFeedback(feedback) })
}

// GET /api/feedback (scoped to the caller)
export const listFeedbackController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const query = parseOrThrow(listFeedbackQuerySchema, req.query, 'query')
  const window = parsePagination(query)

  const { items, total } = await listFeedback(actor, query, window)
  res.json({
    success: true,
    feedback: items.map(toFeedback),
    pagination: paginationMeta(total, window)
  })
}

// GET /api/feedback/:id (scope enforced)
export const getFeedbackController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const feedback = await loadFeedbackForUser(actor, String(req.params.id ?? ''))
  res.json({ success: true, feedback: toFeedback(feedback) })
}

// GET /api/bookings/:id/feedback (scope enforced)
export const getBookingFeedbackController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const rows = await getBookingFeedback(actor, String(req.params.id ?? ''))
  res.json({ success: true, feedback: rows.map(toFeedback) })
}
