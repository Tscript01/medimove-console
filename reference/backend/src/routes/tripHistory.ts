import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requireAnyPermission } from '../middleware/authorize'
import { BOOKING_READ_PERMISSIONS } from '../auth/permissions'
import { getTripDetailController, listTripHistoryController } from '../controllers/tripHistoryController'

/**
 * Consolidated, patient-facing trip history. Rows are always scoped to the
 * caller's booking scope, and any attached payment/feedback/complaint data is
 * filtered to the caller as well.
 */

const router = Router()

const CAN_READ_BOOKINGS = BOOKING_READ_PERMISSIONS

// GET /api/trips/history — scoped, paginated trip history (booking + payment + rating + complaints)
router.get('/trips/history', authenticateToken, requireAnyPermission(...CAN_READ_BOOKINGS), listTripHistoryController)

// GET /api/trips/:id — consolidated trip detail (events, payment, receipt, feedback, complaints)
router.get('/trips/:id', authenticateToken, requireAnyPermission(...CAN_READ_BOOKINGS), getTripDetailController)

export default router
