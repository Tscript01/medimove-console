import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import {
  authorizeStaffController,
  getHospitalController,
  getOwnCapacityController,
  getOwnHospitalController,
  listHospitalsController,
  listIncomingPatientsController,
  listOwnStaffController,
  listServicesController,
  listSpecialtiesController,
  replaceServicesController,
  replaceSpecialtiesController,
  revokeStaffController,
  updateOwnCapacityController,
  updateOwnHospitalController
} from '../controllers/hospitalController'
import {
  authorizeStaffSchema,
  replaceServicesSchema,
  replaceSpecialtiesSchema,
  updateCapacitySchema,
  updateHospitalSchema
} from '../validation/hospital.schemas'

/**
 * Hospital operations surface.
 *
 * The `/hospitals/me*` routes are always scoped to the caller's own hospital
 * (resolved from the session in `services/hospitalService`), so a hospital can
 * never reach another hospital's profile, staff or alerts. The directory routes
 * are reference data readable by any signed-in user. `/me` routes are declared
 * before `/:id` so they are never captured as an id.
 */

const router = Router()

const canReadProfile = requirePermission(PERMISSIONS.HOSPITAL_PROFILE_READ)
const canManageProfile = requirePermission(PERMISSIONS.HOSPITAL_PROFILE_MANAGE)
const canManageStaff = requirePermission(PERMISSIONS.HOSPITAL_STAFF_MANAGE)

// --- Directory (reference data) ---------------------------------------------

// GET /api/hospitals
router.get('/hospitals', authenticateToken, listHospitalsController)

// --- Own hospital -----------------------------------------------------------

// GET /api/hospitals/me
router.get('/hospitals/me', authenticateToken, canReadProfile, getOwnHospitalController)

// PATCH /api/hospitals/me
router.patch(
  '/hospitals/me',
  authenticateToken,
  canManageProfile,
  validateBody(updateHospitalSchema),
  updateOwnHospitalController
)

// GET /api/hospitals/me/specialties
router.get('/hospitals/me/specialties', authenticateToken, canReadProfile, listSpecialtiesController)

// PUT /api/hospitals/me/specialties
router.put(
  '/hospitals/me/specialties',
  authenticateToken,
  canManageProfile,
  validateBody(replaceSpecialtiesSchema),
  replaceSpecialtiesController
)

// GET /api/hospitals/me/services
router.get('/hospitals/me/services', authenticateToken, canReadProfile, listServicesController)

// PUT /api/hospitals/me/services
router.put(
  '/hospitals/me/services',
  authenticateToken,
  canManageProfile,
  validateBody(replaceServicesSchema),
  replaceServicesController
)

// GET /api/hospitals/me/capacity
router.get('/hospitals/me/capacity', authenticateToken, canReadProfile, getOwnCapacityController)

// PATCH /api/hospitals/me/capacity
router.patch(
  '/hospitals/me/capacity',
  authenticateToken,
  canManageProfile,
  validateBody(updateCapacitySchema),
  updateOwnCapacityController
)

// GET /api/hospitals/me/staff
router.get('/hospitals/me/staff', authenticateToken, canManageStaff, listOwnStaffController)

// POST /api/hospitals/me/staff
router.post(
  '/hospitals/me/staff',
  authenticateToken,
  canManageStaff,
  validateBody(authorizeStaffSchema),
  authorizeStaffController
)

// DELETE /api/hospitals/me/staff/:id
router.delete('/hospitals/me/staff/:id', authenticateToken, canManageStaff, revokeStaffController)

// GET /api/hospitals/me/incoming
router.get(
  '/hospitals/me/incoming',
  authenticateToken,
  requirePermission(PERMISSIONS.BOOKING_READ_HOSPITAL),
  listIncomingPatientsController
)

// --- Single hospital (must come after /me routes) ---------------------------

// GET /api/hospitals/:id
router.get('/hospitals/:id', authenticateToken, getHospitalController)

export default router
