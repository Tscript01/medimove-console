import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requireAnyPermission, requirePermission } from '../middleware/authorize'
import { BOOKING_READ_PERMISSIONS, PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import { createFeedbackSchema } from '../validation/feedback.schemas'
import {
  createFeedbackController,
  getBookingFeedbackController,
  getFeedbackController,
  listFeedbackController
} from '../controllers/feedbackController'

/**
 * Trip feedback. A rating can only be created by the booking's requester (the
 * service enforces this); reads are scoped to the caller by role.
 */

const router = Router()

const CAN_READ_FEEDBACK = [
  PERMISSIONS.FEEDBACK_READ_OWN,
  PERMISSIONS.FEEDBACK_READ_PROVIDER,
  PERMISSIONS.FEEDBACK_READ_STATE
] as const

// POST /api/bookings/:id/feedback — rate a trip the caller requested
router.post(
  '/bookings/:id/feedback',
  authenticateToken,
  requirePermission(PERMISSIONS.FEEDBACK_CREATE_OWN),
  validateBody(createFeedbackSchema),
  createFeedbackController
)

// GET /api/bookings/:id/feedback — feedback on a booking the caller can read
router.get(
  '/bookings/:id/feedback',
  authenticateToken,
  requireAnyPermission(...CAN_READ_FEEDBACK, ...BOOKING_READ_PERMISSIONS),
  getBookingFeedbackController
)

// GET /api/feedback — scoped, paginated feedback list
router.get('/feedback', authenticateToken, requireAnyPermission(...CAN_READ_FEEDBACK), listFeedbackController)

// GET /api/feedback/:id — one feedback record (scope enforced)
router.get('/feedback/:id', authenticateToken, requireAnyPermission(...CAN_READ_FEEDBACK), getFeedbackController)

export default router
