import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import { validateBody } from '../middleware/validate'
import {
  contactPartySchema,
  createDispatchSchema,
  escalateBookingSchema,
  manualAssignSchema,
  rejectOfferSchema,
  retryDispatchSchema
} from '../validation/dispatch.schemas'
import {
  acceptOffer,
  contactPartyController,
  escalateBookingController,
  getCandidates,
  getDispatchBookingDetailController,
  listAvailableAmbulancesController,
  listBookingOffersController,
  listDispatchBookingsController,
  listMyOffersController,
  manualAssign,
  rejectOffer,
  retryDispatchController,
  startDispatch
} from '../controllers/dispatchController'

const router = Router()

const canManage = requirePermission(PERMISSIONS.DISPATCH_MANAGE)
const canRespond = requirePermission(PERMISSIONS.DISPATCH_RESPOND)
const canReadOwn = requirePermission(PERMISSIONS.DISPATCH_READ_OWN)
const canContact = requirePermission(PERMISSIONS.DISPATCH_CONTACT)

// --- Dispatcher surface (recommend, offer, retry, assign) -------------------

// GET /api/dispatch/bookings  (incoming requests / operational queue)
router.get('/dispatch/bookings', authenticateToken, canManage, listDispatchBookingsController)

// GET /api/dispatch/ambulances  (available vehicles + crew)
router.get('/dispatch/ambulances', authenticateToken, canManage, listAvailableAmbulancesController)

// GET /api/dispatch/bookings/:id  (consolidated booking + trip history + ETA)
router.get('/dispatch/bookings/:id', authenticateToken, canManage, getDispatchBookingDetailController)

// POST /api/dispatch/bookings/:id/escalate  (escalate for manual assignment)
router.post(
  '/dispatch/bookings/:id/escalate',
  authenticateToken,
  canManage,
  validateBody(escalateBookingSchema),
  escalateBookingController
)

// POST /api/dispatch/bookings/:id/contact  (approved-channel contact)
router.post(
  '/dispatch/bookings/:id/contact',
  authenticateToken,
  canContact,
  validateBody(contactPartySchema),
  contactPartyController
)

// GET /api/bookings/:id/dispatch/candidates
router.get('/bookings/:id/dispatch/candidates', authenticateToken, canManage, getCandidates)

// POST /api/bookings/:id/dispatch
router.post('/bookings/:id/dispatch', authenticateToken, canManage, validateBody(createDispatchSchema), startDispatch)

// POST /api/bookings/:id/dispatch/retry
router.post(
  '/bookings/:id/dispatch/retry',
  authenticateToken,
  canManage,
  validateBody(retryDispatchSchema),
  retryDispatchController
)

// GET /api/bookings/:id/offers
router.get('/bookings/:id/offers', authenticateToken, canManage, listBookingOffersController)

// POST /api/bookings/:id/assign  (manual assign / reassign override)
router.post('/bookings/:id/assign', authenticateToken, canManage, validateBody(manualAssignSchema), manualAssign)

// --- Crew surface (view, accept, reject) ------------------------------------

// GET /api/dispatch/offers/me
router.get('/dispatch/offers/me', authenticateToken, canReadOwn, listMyOffersController)

// POST /api/dispatch/offers/:id/accept
router.post('/dispatch/offers/:id/accept', authenticateToken, canRespond, acceptOffer)

// POST /api/dispatch/offers/:id/reject
router.post(
  '/dispatch/offers/:id/reject',
  authenticateToken,
  canRespond,
  validateBody(rejectOfferSchema),
  rejectOffer
)

export default router
