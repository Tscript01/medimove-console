import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { listSavings } from '../controllers/savingsController'

const router = Router()

// GET /api/savings (Authenticated)
router.get('/savings', authenticateToken, requirePermission(PERMISSIONS.SAVINGS_READ_OWN), listSavings)

export default router
