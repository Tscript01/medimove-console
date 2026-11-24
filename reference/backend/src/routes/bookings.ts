import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission, requireAnyPermission } from '../middleware/authorize'
import { BOOKING_READ_PERMISSIONS, PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import { cancelBookingSchema, createBookingSchema, updateBookingStatusSchema } from '../validation/booking.schemas'
import {
  cancelBooking,
  createBooking,
  getBooking,
  getBookingHistoryController,
  listBookings,
  updateBookingStatus
} from '../controllers/bookingController'

const router = Router()

// Any role that can read bookings may hit the scoped collection/read endpoints;
// the controller narrows the result set to the caller's data scope.
const CAN_READ_BOOKINGS = BOOKING_READ_PERMISSIONS

// POST /api/bookings (Authenticated — requires booking:create)
router.post(
  '/bookings',
  authenticateToken,
  requirePermission(PERMISSIONS.BOOKING_CREATE),
  validateBody(createBookingSchema),
  createBooking
)

// GET /api/bookings (Authenticated — scoped to the caller's role)
router.get('/bookings', authenticateToken, requireAnyPermission(...CAN_READ_BOOKINGS), listBookings)

// GET /api/bookings/:id (Authenticated — ownership/scope enforced in the controller)
router.get('/bookings/:id', authenticateToken, requireAnyPermission(...CAN_READ_BOOKINGS), getBooking)

// GET /api/bookings/:id/history (Authenticated — append-only status trail)
router.get(
  '/bookings/:id/history',
  authenticateToken,
  requireAnyPermission(...CAN_READ_BOOKINGS),
  getBookingHistoryController
)

// PATCH /api/bookings/:id/status (Authenticated — booking:update:status + scope)
router.patch(
  '/bookings/:id/status',
  authenticateToken,
  requirePermission(PERMISSIONS.BOOKING_UPDATE_STATUS),
  validateBody(updateBookingStatusSchema),
  updateBookingStatus
)

// POST /api/bookings/:id/cancel (Authenticated — requester cancels own, or operator)
router.post(
  '/bookings/:id/cancel',
  authenticateToken,
  requireAnyPermission(PERMISSIONS.BOOKING_CANCEL_OWN, PERMISSIONS.BOOKING_UPDATE_STATUS),
  validateBody(cancelBookingSchema),
  cancelBooking
)

export default router
