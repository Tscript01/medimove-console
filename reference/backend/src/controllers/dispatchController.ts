import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import {
  toAvailableAmbulance,
  toBooking,
  toBookingStatusHistory,
  toDispatchBookingSummary,
  toDispatchCandidate,
  toDispatchOffer,
  toTrackingView,
  toTripLocation
} from '../utils/serializers'
import {
  acceptOffer as acceptOfferService,
  contactParty as contactPartyService,
  createDispatchOffers,
  escalateBooking as escalateBookingService,
  getDispatchBookingDetail,
  getDispatchCandidates,
  listAvailableAmbulances,
  listBookingOffers,
  listDispatchBookings,
  listMyOffers,
  manualAssign as manualAssignService,
  rejectOffer as rejectOfferService,
  retryDispatch
} from '../services/dispatchService'
import {
  listDispatchAmbulancesQuerySchema,
  listDispatchBookingsQuerySchema
} from '../validation/dispatch.schemas'
import type {
  ContactPartyInput,
  CreateDispatchInput,
  EscalateBookingInput,
  ManualAssignInput,
  RejectOfferInput,
  RetryDispatchInput
} from '../validation/dispatch.schemas'

/**
 * Dispatch-engine HTTP handlers. All matching, ranking, eligibility and the
 * offer lifecycle live in `services/dispatchService`; handlers translate HTTP
 * to/from it and record the audit trail.
 */

function bookingIdParam(req: { params: Record<string, unknown> }): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Booking id is required.', { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

function offerIdParam(req: { params: Record<string, unknown> }): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Offer id is required.', { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

// GET /api/bookings/:id/dispatch/candidates (dispatch:manage)
export const getCandidates: RequestHandler = async (req, res) => {
  const { booking, candidates } = await getDispatchCandidates(currentUser(req), bookingIdParam(req))
  res.json({
    success: true,
    booking: toBooking(booking),
    candidates: candidates.map(toDispatchCandidate)
  })
}

// POST /api/bookings/:id/dispatch (dispatch:manage)
export const startDispatch: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as CreateDispatchInput
  const { booking, offers, round } = await createDispatchOffers(actor, bookingIdParam(req), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'dispatch.offers.create',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { round, offerCount: offers.length },
    ...requestMeta(req)
  })

  res.status(201).json({
    success: true,
    round,
    booking: toBooking(booking),
    offers: offers.map((offer: Record<string, any>) => toDispatchOffer(offer))
  })
}

// POST /api/bookings/:id/dispatch/retry (dispatch:manage)
export const retryDispatchController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as RetryDispatchInput
  const { booking, offers, round } = await retryDispatch(actor, bookingIdParam(req), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'dispatch.offers.retry',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { round, offerCount: offers.length },
    ...requestMeta(req)
  })

  res.json({
    success: true,
    round,
    booking: toBooking(booking),
    offers: offers.map((offer: Record<string, any>) => toDispatchOffer(offer))
  })
}

// GET /api/bookings/:id/offers (dispatch:manage)
export const listBookingOffersController: RequestHandler = async (req, res) => {
  const offers = await listBookingOffers(currentUser(req), bookingIdParam(req))
  res.json({ success: true, offers: offers.map((offer: Record<string, any>) => toDispatchOffer(offer)) })
}

// POST /api/bookings/:id/assign (dispatch:manage) — manual assign / reassign
export const manualAssign: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as ManualAssignInput
  const booking = await manualAssignService(actor, bookingIdParam(req), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'dispatch.manual.assign',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { crewProfileId: input.crewProfileId, ambulanceId: booking.assignedAmbulanceId ?? null },
    ...requestMeta(req)
  })

  res.json({ success: true, booking: toBooking(booking) })
}

// GET /api/dispatch/offers/me (dispatch:read:own) — the crew's own offers
export const listMyOffersController: RequestHandler = async (req, res) => {
  const offers = await listMyOffers(currentUser(req))
  res.json({ success: true, offers: offers.map((offer: Record<string, any>) => toDispatchOffer(offer)) })
}

// POST /api/dispatch/offers/:id/accept (dispatch:respond)
export const acceptOffer: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const booking = await acceptOfferService(actor, offerIdParam(req))

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'dispatch.offer.accept',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { offerId: offerIdParam(req) },
    ...requestMeta(req)
  })

  res.json({ success: true, booking: toBooking(booking) })
}

// POST /api/dispatch/offers/:id/reject (dispatch:respond)
export const rejectOffer: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as RejectOfferInput
  const offer = await rejectOfferService(actor, offerIdParam(req), input?.reason)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'dispatch.offer.reject',
    resourceType: 'DispatchOffer',
    resourceId: offer.id,
    metadata: { bookingId: offer.bookingId, reason: input?.reason ?? null },
    ...requestMeta(req)
  })

  res.json({ success: true, offer: toDispatchOffer(offer) })
}

// --- Dispatcher operations (Stage 13) --------------------------------------

// GET /api/dispatch/bookings (dispatch:manage) — incoming/operational queue
export const listDispatchBookingsController: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listDispatchBookingsQuerySchema, req.query, 'query')
  const bookings = await listDispatchBookings(currentUser(req), query)
  res.json({ success: true, bookings: bookings.map(toDispatchBookingSummary) })
}

// GET /api/dispatch/ambulances (dispatch:manage) — available vehicles + crew
export const listAvailableAmbulancesController: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listDispatchAmbulancesQuerySchema, req.query, 'query')
  const rows = await listAvailableAmbulances(currentUser(req), query)
  res.json({
    success: true,
    ambulances: rows.map((row: Record<string, any>) =>
      toAvailableAmbulance(row.ambulance, row.provider, row.crew)
    )
  })
}

// GET /api/dispatch/bookings/:id (dispatch:manage) — consolidated history + ETA
export const getDispatchBookingDetailController: RequestHandler = async (req, res) => {
  const { booking, history, offers, tripLocations, tracking } = await getDispatchBookingDetail(
    currentUser(req),
    bookingIdParam(req)
  )
  res.json({
    success: true,
    booking: toDispatchBookingSummary(booking),
    history: history.map(toBookingStatusHistory),
    offers: offers.map((offer: Record<string, any>) => toDispatchOffer(offer)),
    tripLocations: tripLocations.map((fix: Record<string, any>) => toTripLocation(fix)),
    tracking: toTrackingView(tracking)
  })
}

// POST /api/dispatch/bookings/:id/escalate (dispatch:manage)
export const escalateBookingController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as EscalateBookingInput
  const booking = await escalateBookingService(actor, bookingIdParam(req), input ?? {})

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'dispatch.booking.escalate',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { reason: input?.reason ?? null },
    ...requestMeta(req)
  })

  res.json({ success: true, booking: toDispatchBookingSummary(booking) })
}

// POST /api/dispatch/bookings/:id/contact (dispatch:contact)
export const contactPartyController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as ContactPartyInput
  const result = await contactPartyService(actor, bookingIdParam(req), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'dispatch.booking.contact',
    resourceType: 'Booking',
    resourceId: bookingIdParam(req),
    metadata: { recipient: result.recipient, channel: result.channel, template: result.template },
    ...requestMeta(req)
  })

  res.json({ success: true, contact: result })
}
