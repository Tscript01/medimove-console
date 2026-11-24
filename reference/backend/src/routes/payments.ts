import { Router } from 'express'
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { validateBody } from '../middleware/validate'
import { PERMISSIONS } from '../auth/permissions'
import {
  cancelPayment,
  collectCash,
  getPayment,
  getPaymentReceipt,
  initializePaymentController,
  listPayments,
  payWithWallet,
  paymentCallback,
  paymentHistory,
  paymentWebhook,
  refundPaymentController,
  retryPayment,
  verifyPayment
} from '../controllers/paymentController'
import {
  cashPaymentSchema,
  initializePaymentSchema,
  refundPaymentSchema,
  retryPaymentSchema,
  verifyPaymentSchema
} from '../validation/payment.schemas'

const router = Router()

// --- Initialization / settlement -------------------------------------------

// POST /api/payments/initialize (Authenticated)
router.post(
  '/payments/initialize',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_INITIATE),
  validateBody(initializePaymentSchema),
  initializePaymentController
)

// POST /api/payments/pay-with-wallet (Authenticated)
router.post(
  '/payments/pay-with-wallet',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_INITIATE),
  payWithWallet
)

// POST /api/payments/cash — a crew records cash collected in person
router.post(
  '/payments/cash',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_COLLECT_CASH),
  validateBody(cashPaymentSchema),
  collectCash
)

// POST /api/payments/retry (Authenticated)
router.post(
  '/payments/retry',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_RETRY_OWN),
  validateBody(retryPaymentSchema),
  retryPayment
)

// POST /api/payments/verify — verify with the provider and settle. Auth is
// optional so the legacy checkout redirect keeps working, but a signed-in caller
// is ownership-checked and the body's `userId` is never trusted.
router.post('/payments/verify', optionalAuthenticateToken, validateBody(verifyPaymentSchema), verifyPayment)

// POST /api/payments/cancel — called by the Interswitch checkout flow
router.post('/payments/cancel', cancelPayment)

// --- Provider callback -----------------------------------------------------

// POST /api/payments/webhook — server-to-server callback (idempotent, verified)
router.post('/payments/webhook', paymentWebhook)

// GET /api/payments/callback — browser redirect target from checkout
router.get('/payments/callback', paymentCallback)

// --- Reads -----------------------------------------------------------------

// GET /api/payments/history (Authenticated)
router.get(
  '/payments/history',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_READ_OWN),
  paymentHistory
)

// GET /api/admin/payments (state/platform admin)
router.get('/admin/payments', authenticateToken, requirePermission(PERMISSIONS.PAYMENT_READ_ALL), listPayments)

// GET /api/payments/:id (Authenticated, own)
router.get('/payments/:id', authenticateToken, requirePermission(PERMISSIONS.PAYMENT_READ_OWN), getPayment)

// GET /api/payments/:id/receipt (Authenticated, own)
router.get(
  '/payments/:id/receipt',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_READ_OWN),
  getPaymentReceipt
)

// --- Refunds ---------------------------------------------------------------

// POST /api/payments/:id/refund (state/platform admin)
router.post(
  '/payments/:id/refund',
  authenticateToken,
  requirePermission(PERMISSIONS.PAYMENT_REFUND),
  validateBody(refundPaymentSchema),
  refundPaymentController
)

export default router
