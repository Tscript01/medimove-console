import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requireAnyPermission, requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import { requesterLocationSchema } from '../validation/trip.schemas'
import {
  getBookingTrackingController,
  recordRequesterLocationController
} from '../controllers/trackingController'

/**
 * Booking tracking read (polling). A patient tracks their own booking; a crew
 * member their provider's; an operator their state/provider scope. The scope is
 * enforced by `loadBookingForUser` inside the service, so the permission only
 * gates *who may ask*, never *what they may see*.
 */

const router = Router()

const CAN_READ_TRACKING = [PERMISSIONS.TRACKING_READ_OWN, PERMISSIONS.TRACKING_READ] as const

// GET /api/bookings/:id/tracking
router.get(
  '/bookings/:id/tracking',
  authenticateToken,
  requireAnyPermission(...CAN_READ_TRACKING),
  getBookingTrackingController
)

// POST /api/bookings/:id/tracking/requester-location — moving-pickup rendezvous.
// Only the booking requester may share, and only while their crew is on the way.
router.post(
  '/bookings/:id/tracking/requester-location',
  authenticateToken,
  requirePermission(PERMISSIONS.TRACKING_SHARE_OWN),
  validateBody(requesterLocationSchema),
  recordRequesterLocationController
)

export default router
