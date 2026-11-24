import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import { geocodeLimiter } from '../middleware/rateLimit'
import {
  checkCoverageController,
  createLocationController,
  deleteLocationController,
  distanceController,
  geocodeSearchController,
  getLocationController,
  listLocationsController,
  listStatesController,
  reverseGeocodeController,
  setPrimaryLocationController,
  updateLocationController
} from '../controllers/locationController'
import { createLocationSchema, updateLocationSchema } from '../validation/location.schemas'

const router = Router()

const canRead = requirePermission(PERMISSIONS.LOCATION_READ_OWN)
const canManage = requirePermission(PERMISSIONS.LOCATION_MANAGE_OWN)

// --- Reference data --------------------------------------------------------
router.get('/states', authenticateToken, requirePermission(PERMISSIONS.SERVICE_AREA_READ), listStatesController)

// --- Distance, coverage and geocoding (server-authoritative) ---------------
router.get('/locations/coverage', authenticateToken, canRead, checkCoverageController)
router.get('/locations/distance', authenticateToken, canRead, distanceController)
router.get('/locations/reverse-geocode', authenticateToken, canRead, geocodeLimiter, reverseGeocodeController)
router.get('/locations/search', authenticateToken, canRead, geocodeLimiter, geocodeSearchController)

// --- Saved / recent locations (owner-scoped) -------------------------------
router.get('/locations', authenticateToken, canRead, listLocationsController)
router.post('/locations', authenticateToken, canManage, validateBody(createLocationSchema), createLocationController)
router.get('/locations/:id', authenticateToken, canRead, getLocationController)
router.patch(
  '/locations/:id',
  authenticateToken,
  canManage,
  validateBody(updateLocationSchema),
  updateLocationController
)
router.delete('/locations/:id', authenticateToken, canManage, deleteLocationController)
router.post('/locations/:id/primary', authenticateToken, canManage, setPrimaryLocationController)

export default router
