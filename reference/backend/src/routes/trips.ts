import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import {
  reportNoShowSchema,
  tripLocationSchema,
  updateTripStatusSchema
} from '../validation/trip.schemas'
import {
  getCrewTripController,
  listCrewTripsController,
  recordTripLocationController,
  reportNoShowController,
  updateTripStatusController
} from '../controllers/tripController'

/**
 * Crew trip surface. Every route is scoped to the caller's *own* accepted trip
 * (`acceptedById`) inside `services/tripService`, so a crew member can never
 * drive a provider-mate's trip even within the same provider.
 */

const router = Router()

const canReadOwnTrip = requirePermission(PERMISSIONS.TRIP_READ_OWN)
const canUpdateTrip = requirePermission(PERMISSIONS.TRIP_UPDATE)
const canTrack = requirePermission(PERMISSIONS.TRACKING_UPDATE)

// GET /api/crew/me/trips — assigned trips (active by default)
router.get('/crew/me/trips', authenticateToken, canReadOwnTrip, listCrewTripsController)

// GET /api/crew/me/trips/:id — one assigned trip
router.get('/crew/me/trips/:id', authenticateToken, canReadOwnTrip, getCrewTripController)

// PATCH /api/crew/me/trips/:id/status — advance en route → arrived → on board → hospital → completed
router.patch(
  '/crew/me/trips/:id/status',
  authenticateToken,
  canUpdateTrip,
  validateBody(updateTripStatusSchema),
  updateTripStatusController
)

// POST /api/crew/me/trips/:id/location — record a GPS fix for the live trip
router.post(
  '/crew/me/trips/:id/location',
  authenticateToken,
  canTrack,
  validateBody(tripLocationSchema),
  recordTripLocationController
)

// POST /api/crew/me/trips/:id/no-show — report the patient was not present
router.post(
  '/crew/me/trips/:id/no-show',
  authenticateToken,
  canUpdateTrip,
  validateBody(reportNoShowSchema),
  reportNoShowController
)

export default router
