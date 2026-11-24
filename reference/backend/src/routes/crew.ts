import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import {
  acceptInvitationController,
  getOwnCrewController,
  listOwnDocumentsController,
  setOwnAvailabilityController,
  submitDocumentController,
  updateOwnCrewController
} from '../controllers/crewController'
import {
  acceptInvitationSchema,
  crewAvailabilitySchema,
  submitDocumentSchema,
  updateCrewProfileSchema
} from '../validation/crew.schemas'

const router = Router()

const canReadOwn = requirePermission(PERMISSIONS.CREW_READ_OWN)
const canManageOwn = requirePermission(PERMISSIONS.CREW_SELF_MANAGE)

// Accepting an invitation is available to any signed-in user: the invitation is
// bound to the caller's email, so a leaked token cannot hijack an account.
router.post(
  '/crew/invitations/:token/accept',
  authenticateToken,
  canManageOwn,
  validateBody(acceptInvitationSchema),
  acceptInvitationController
)

// --- Own crew profile & documents ------------------------------------------
router.get('/crew/me', authenticateToken, canReadOwn, getOwnCrewController)
router.patch('/crew/me', authenticateToken, canManageOwn, validateBody(updateCrewProfileSchema), updateOwnCrewController)
router.post('/crew/me/availability', authenticateToken, canManageOwn, validateBody(crewAvailabilitySchema), setOwnAvailabilityController)
router.get('/crew/me/documents', authenticateToken, canReadOwn, listOwnDocumentsController)
router.post('/crew/me/documents', authenticateToken, canManageOwn, validateBody(submitDocumentSchema), submitDocumentController)

export default router
