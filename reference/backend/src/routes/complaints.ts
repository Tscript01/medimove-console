import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requireAnyPermission, requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import { createComplaintSchema, updateComplaintStatusSchema } from '../validation/complaint.schemas'
import {
  createComplaintController,
  getComplaintController,
  listComplaintsController,
  updateComplaintStatusController
} from '../controllers/complaintController'

/**
 * Complaints. Anyone signed in may raise one and read their own; state/platform
 * operators can read those in scope and manage their status. Scope is always
 * applied from the session, never the request.
 */

const router = Router()

const CAN_READ_COMPLAINTS = [PERMISSIONS.COMPLAINT_READ_OWN, PERMISSIONS.COMPLAINT_READ_ALL] as const

// POST /api/complaints — raise a complaint
router.post(
  '/complaints',
  authenticateToken,
  requirePermission(PERMISSIONS.COMPLAINT_CREATE_OWN),
  validateBody(createComplaintSchema),
  createComplaintController
)

// GET /api/complaints — own (or scoped) complaints, paginated
router.get('/complaints', authenticateToken, requireAnyPermission(...CAN_READ_COMPLAINTS), listComplaintsController)

// GET /api/complaints/:id — one complaint + handling trail (scope enforced)
router.get(
  '/complaints/:id',
  authenticateToken,
  requireAnyPermission(...CAN_READ_COMPLAINTS),
  getComplaintController
)

// PATCH /api/complaints/:id/status — manage the handling status (audited)
router.patch(
  '/complaints/:id/status',
  authenticateToken,
  requirePermission(PERMISSIONS.COMPLAINT_MANAGE),
  validateBody(updateComplaintStatusSchema),
  updateComplaintStatusController
)

export default router
