import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { fundWallet, getBalance } from '../controllers/walletController'

const router = Router()

// GET /api/wallet/balance (Authenticated)
router.get('/wallet/balance', authenticateToken, requirePermission(PERMISSIONS.WALLET_READ_OWN), getBalance)

// POST /api/wallet/fund (Authenticated)
router.post('/wallet/fund', authenticateToken, requirePermission(PERMISSIONS.WALLET_FUND), fundWallet)

export default router
