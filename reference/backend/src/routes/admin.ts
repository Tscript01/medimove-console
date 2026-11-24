import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requireAnyPermission, requirePermission } from '../middleware/authorize'
import { BOOKING_READ_PERMISSIONS, PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import { adminCreateHospitalSchema, adminUpdateHospitalSchema, updateUserRoleSchema } from '../validation/admin.schemas'
import {
  activateUserController,
  getOperationalReportController,
  getUserController,
  listAdminBookingsController,
  listAuditLogsController,
  listUsersController,
  suspendUserController,
  updateUserRoleController
} from '../controllers/adminController'
import {
  activateHospitalController,
  createHospitalController,
  getAdminHospitalController,
  listAdminHospitalsController,
  suspendHospitalController,
  updateHospitalController
} from '../controllers/adminHospitalController'
import {
  createServiceAreaController,
  createStateController,
  deleteServiceAreaController,
  listServiceAreasController,
  listStatesAdminController,
  updateServiceAreaController,
  updateStateController
} from '../controllers/serviceAreaController'
import {
  createServiceAreaSchema,
  createStateSchema,
  updateServiceAreaSchema,
  updateStateSchema
} from '../validation/location.schemas'
import {
  activateProviderController,
  getProviderController,
  listProvidersController,
  suspendProviderController,
  verifyProviderController
} from '../controllers/providerController'
import { verifyAmbulanceController } from '../controllers/ambulanceController'
import { reviewDocumentController, verifyCrewController } from '../controllers/crewController'
import { providerDecisionSchema, reasonSchema } from '../validation/provider.schemas'
import { reviewDocumentSchema } from '../validation/crew.schemas'

const router = Router()

// User administration
router.get('/admin/users', authenticateToken, requirePermission(PERMISSIONS.ADMIN_USERS_READ), listUsersController)
router.patch(
  '/admin/users/:id/role',
  authenticateToken,
  requirePermission(PERMISSIONS.ADMIN_ROLES_ASSIGN),
  validateBody(updateUserRoleSchema),
  updateUserRoleController
)
router.get('/admin/users/:id', authenticateToken, requirePermission(PERMISSIONS.ADMIN_USERS_READ), getUserController)
router.post(
  '/admin/users/:id/suspend',
  authenticateToken,
  requirePermission(PERMISSIONS.ADMIN_USERS_MANAGE),
  suspendUserController
)
router.post(
  '/admin/users/:id/activate',
  authenticateToken,
  requirePermission(PERMISSIONS.ADMIN_USERS_MANAGE),
  activateUserController
)

// Audit trail (read-only, append-only: there is no way to mutate a record)
router.get('/admin/audit-logs', authenticateToken, requirePermission(PERMISSIONS.ADMIN_AUDIT_READ), listAuditLogsController)

// Operational reports (aggregate counts only — never an individual's data)
router.get(
  '/admin/reports/overview',
  authenticateToken,
  requirePermission(PERMISSIONS.ADMIN_REPORTS_READ),
  getOperationalReportController
)

// Booking oversight (platform-wide or state-scoped, paginated)
router.get(
  '/admin/bookings',
  authenticateToken,
  requireAnyPermission(...BOOKING_READ_PERMISSIONS),
  listAdminBookingsController
)

// Hospital administration (platform-wide or state-scoped)
router.get(
  '/admin/hospitals',
  authenticateToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  listAdminHospitalsController
)
router.post(
  '/admin/hospitals',
  authenticateToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  validateBody(adminCreateHospitalSchema),
  createHospitalController
)
router.get(
  '/admin/hospitals/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  getAdminHospitalController
)
router.patch(
  '/admin/hospitals/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  validateBody(adminUpdateHospitalSchema),
  updateHospitalController
)
router.post(
  '/admin/hospitals/:id/suspend',
  authenticateToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  suspendHospitalController
)
router.post(
  '/admin/hospitals/:id/activate',
  authenticateToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  activateHospitalController
)

// States (platform-level reference data)
router.get('/admin/states', authenticateToken, requirePermission(PERMISSIONS.STATE_MANAGE), listStatesAdminController)
router.post(
  '/admin/states',
  authenticateToken,
  requirePermission(PERMISSIONS.STATE_MANAGE),
  validateBody(createStateSchema),
  createStateController
)
router.patch(
  '/admin/states/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.STATE_MANAGE),
  validateBody(updateStateSchema),
  updateStateController
)

// Service areas (state admins are limited to their own state by the controller)
router.get(
  '/admin/service-areas',
  authenticateToken,
  requirePermission(PERMISSIONS.SERVICE_AREA_MANAGE),
  listServiceAreasController
)
router.post(
  '/admin/service-areas',
  authenticateToken,
  requirePermission(PERMISSIONS.SERVICE_AREA_MANAGE),
  validateBody(createServiceAreaSchema),
  createServiceAreaController
)
router.patch(
  '/admin/service-areas/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.SERVICE_AREA_MANAGE),
  validateBody(updateServiceAreaSchema),
  updateServiceAreaController
)
router.delete(
  '/admin/service-areas/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.SERVICE_AREA_MANAGE),
  deleteServiceAreaController
)

// Providers: verification, activation and suspension (state-scoped in the controller)
router.get('/admin/providers', authenticateToken, requirePermission(PERMISSIONS.PROVIDER_READ_STATE), listProvidersController)
router.get('/admin/providers/:id', authenticateToken, requirePermission(PERMISSIONS.PROVIDER_READ_STATE), getProviderController)
router.post(
  '/admin/providers/:id/verify',
  authenticateToken,
  requirePermission(PERMISSIONS.PROVIDER_VERIFY),
  validateBody(providerDecisionSchema),
  verifyProviderController
)
router.post(
  '/admin/providers/:id/activate',
  authenticateToken,
  requirePermission(PERMISSIONS.PROVIDER_MANAGE),
  activateProviderController
)
router.post(
  '/admin/providers/:id/suspend',
  authenticateToken,
  requirePermission(PERMISSIONS.PROVIDER_MANAGE),
  validateBody(reasonSchema),
  suspendProviderController
)

// Ambulance verification (state-scoped in the controller)
router.post(
  '/admin/ambulances/:id/verify',
  authenticateToken,
  requirePermission(PERMISSIONS.AMBULANCE_VERIFY),
  validateBody(providerDecisionSchema),
  verifyAmbulanceController
)

// Crew verification and document review (state-scoped in the controller)
router.post(
  '/admin/crew/:id/verify',
  authenticateToken,
  requirePermission(PERMISSIONS.CREW_VERIFY),
  validateBody(providerDecisionSchema),
  verifyCrewController
)
router.post(
  '/admin/crew-documents/:id/review',
  authenticateToken,
  requirePermission(PERMISSIONS.DOCUMENT_REVIEW),
  validateBody(reviewDocumentSchema),
  reviewDocumentController
)

export default router
