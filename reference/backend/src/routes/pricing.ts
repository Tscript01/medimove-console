import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import {
  createPricingConfigController,
  estimateFareController,
  getPricingConfigController,
  listPricingConfigsController,
  setPricingConfigActiveController,
  updatePricingConfigController
} from '../controllers/pricingController'
import {
  createPricingConfigSchema,
  estimateFareSchema,
  setPricingActiveSchema,
  updatePricingConfigSchema
} from '../validation/pricing.schemas'

const router = Router()

// Fare estimation for signed-in requesters. Takes locations only — never an
// amount — and returns the server-computed fare breakdown.
router.post(
  '/pricing/estimate',
  authenticateToken,
  requirePermission(PERMISSIONS.PRICING_ESTIMATE),
  validateBody(estimateFareSchema),
  estimateFareController
)

// Pricing rule management. State administrators are restricted to their own
// state by the service; platform-wide and provider-specific rules are reserved
// for the platform administrator.
router.get('/admin/pricing', authenticateToken, requirePermission(PERMISSIONS.PRICING_READ), listPricingConfigsController)
router.post(
  '/admin/pricing',
  authenticateToken,
  requirePermission(PERMISSIONS.PRICING_MANAGE),
  validateBody(createPricingConfigSchema),
  createPricingConfigController
)
router.get(
  '/admin/pricing/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.PRICING_READ),
  getPricingConfigController
)
router.patch(
  '/admin/pricing/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.PRICING_MANAGE),
  validateBody(updatePricingConfigSchema),
  updatePricingConfigController
)
router.patch(
  '/admin/pricing/:id/status',
  authenticateToken,
  requirePermission(PERMISSIONS.PRICING_MANAGE),
  validateBody(setPricingActiveSchema),
  setPricingConfigActiveController
)

export default router
