import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import {
  applyProviderController,
  createProviderLocationController,
  deleteProviderLocationController,
  getOwnProviderController,
  linkProviderServiceAreaController,
  listProviderLocationsController,
  listProviderServiceAreasController,
  unlinkProviderServiceAreaController,
  updateOwnProviderController,
  updateProviderLocationController
} from '../controllers/providerController'
import {
  createAmbulanceController,
  deleteAmbulanceController,
  getAmbulanceController,
  listAmbulancesController,
  setAmbulanceAvailabilityController,
  updateAmbulanceController,
  updateAmbulanceLocationController
} from '../controllers/ambulanceController'
import {
  assignAmbulanceController,
  deactivateCrewController,
  inviteCrewController,
  listInvitationsController,
  listProviderCrewController,
  reactivateCrewController,
  revokeInvitationController,
  suspendCrewController
} from '../controllers/crewController'
import {
  ambulanceAvailabilitySchema,
  ambulanceLocationSchema,
  applyProviderSchema,
  createAmbulanceSchema,
  linkServiceAreaSchema,
  providerLocationSchema,
  updateAmbulanceSchema,
  updateProviderLocationSchema,
  updateProviderSchema
} from '../validation/provider.schemas'
import { assignAmbulanceSchema, deactivateCrewSchema, inviteCrewSchema } from '../validation/crew.schemas'

const router = Router()

const canReadProvider = requirePermission(PERMISSIONS.PROVIDER_READ_OWN)
const canUpdateProvider = requirePermission(PERMISSIONS.PROVIDER_UPDATE_OWN)
const canManageProviderLocations = requirePermission(PERMISSIONS.PROVIDER_LOCATION_MANAGE)
const canManageProviderServiceAreas = requirePermission(PERMISSIONS.PROVIDER_SERVICE_AREA_MANAGE)
const canReadAmbulances = requirePermission(PERMISSIONS.AMBULANCE_READ_OWN)
const canManageAmbulances = requirePermission(PERMISSIONS.AMBULANCE_MANAGE)
const canReadCrew = requirePermission(PERMISSIONS.CREW_READ_PROVIDER)
const canManageCrew = requirePermission(PERMISSIONS.CREW_MANAGE)

// --- Registration & own profile --------------------------------------------
router.post('/providers/apply', authenticateToken, requirePermission(PERMISSIONS.PROVIDER_APPLY), validateBody(applyProviderSchema), applyProviderController)
router.get('/providers/me', authenticateToken, canReadProvider, getOwnProviderController)
router.patch('/providers/me', authenticateToken, canUpdateProvider, validateBody(updateProviderSchema), updateOwnProviderController)

// --- Operating locations ---------------------------------------------------
router.get('/providers/me/locations', authenticateToken, canReadProvider, listProviderLocationsController)
router.post(
  '/providers/me/locations',
  authenticateToken,
  canManageProviderLocations,
  validateBody(providerLocationSchema),
  createProviderLocationController
)
router.patch(
  '/providers/me/locations/:id',
  authenticateToken,
  canManageProviderLocations,
  validateBody(updateProviderLocationSchema),
  updateProviderLocationController
)
router.delete('/providers/me/locations/:id', authenticateToken, canManageProviderLocations, deleteProviderLocationController)

// --- Service areas ---------------------------------------------------------
router.get('/providers/me/service-areas', authenticateToken, canReadProvider, listProviderServiceAreasController)
router.post(
  '/providers/me/service-areas',
  authenticateToken,
  canManageProviderServiceAreas,
  validateBody(linkServiceAreaSchema),
  linkProviderServiceAreaController
)
router.delete(
  '/providers/me/service-areas/:id',
  authenticateToken,
  canManageProviderServiceAreas,
  unlinkProviderServiceAreaController
)

// --- Ambulances ------------------------------------------------------------
router.get('/providers/me/ambulances', authenticateToken, canReadAmbulances, listAmbulancesController)
router.post('/providers/me/ambulances', authenticateToken, canManageAmbulances, validateBody(createAmbulanceSchema), createAmbulanceController)
router.get('/providers/me/ambulances/:id', authenticateToken, canReadAmbulances, getAmbulanceController)
router.patch(
  '/providers/me/ambulances/:id',
  authenticateToken,
  canManageAmbulances,
  validateBody(updateAmbulanceSchema),
  updateAmbulanceController
)
router.delete('/providers/me/ambulances/:id', authenticateToken, canManageAmbulances, deleteAmbulanceController)
router.post(
  '/providers/me/ambulances/:id/location',
  authenticateToken,
  canManageAmbulances,
  validateBody(ambulanceLocationSchema),
  updateAmbulanceLocationController
)
router.post(
  '/providers/me/ambulances/:id/availability',
  authenticateToken,
  canManageAmbulances,
  validateBody(ambulanceAvailabilitySchema),
  setAmbulanceAvailabilityController
)

// --- Crew management (provider side) ---------------------------------------
router.get('/providers/me/crew/invitations', authenticateToken, canReadCrew, listInvitationsController)
router.post('/providers/me/crew/invitations', authenticateToken, canManageCrew, validateBody(inviteCrewSchema), inviteCrewController)
router.post('/providers/me/crew/invitations/:id/revoke', authenticateToken, canManageCrew, revokeInvitationController)
router.get('/providers/me/crew', authenticateToken, canReadCrew, listProviderCrewController)
router.post('/providers/me/crew/:id/assign', authenticateToken, canManageCrew, validateBody(assignAmbulanceSchema), assignAmbulanceController)
router.post('/providers/me/crew/:id/deactivate', authenticateToken, canManageCrew, validateBody(deactivateCrewSchema), deactivateCrewController)
router.post('/providers/me/crew/:id/suspend', authenticateToken, canManageCrew, validateBody(deactivateCrewSchema), suspendCrewController)
router.post('/providers/me/crew/:id/reactivate', authenticateToken, canManageCrew, reactivateCrewController)

export default router
