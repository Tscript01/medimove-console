import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toBooking, toTripLocation } from '../utils/serializers'
import { getCrewTrip, listCrewTrips, reportNoShow, updateTripStatus } from '../services/tripService'
import { recordTripLocation } from '../services/trackingService'
import { listTripsQuerySchema } from '../validation/trip.schemas'
import type { ReportNoShowInput, TripLocationInput, UpdateTripStatusInput } from '../validation/trip.schemas'

/**
 * Crew trip-operation handlers. The crew constraints (own accepted trip, live
 * status) and the state machine live in `services/tripService`; handlers only
 * translate HTTP to/from it and record the audit trail. No patient data is
 * written to the audit metadata.
 */

function tripIdParam(req: { params: Record<string, unknown> }): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Trip id is required.', { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

// GET /api/crew/me/trips (trip:read:own) — the crew's assigned trips
export const listCrewTripsController: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listTripsQuerySchema, req.query, 'query')
  const trips = await listCrewTrips(currentUser(req), query)
  res.json({ success: true, trips: trips.map((trip: Record<string, any>) => toBooking(trip)) })
}

// GET /api/crew/me/trips/:id (trip:read:own) — one assigned trip
export const getCrewTripController: RequestHandler = async (req, res) => {
  const trip = await getCrewTrip(currentUser(req), tripIdParam(req))
  res.json({ success: true, trip: toBooking(trip) })
}

// PATCH /api/crew/me/trips/:id/status (trip:update) — advance the trip
export const updateTripStatusController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as UpdateTripStatusInput
  const booking = await updateTripStatus(actor, tripIdParam(req), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'trip.status.update',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { to: input.status, reason: input.reason ?? null },
    ...requestMeta(req)
  })

  res.json({ success: true, trip: toBooking(booking) })
}

// POST /api/crew/me/trips/:id/location (tracking:update) — record a GPS fix
export const recordTripLocationController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as TripLocationInput
  const location = await recordTripLocation(actor, tripIdParam(req), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'trip.location.record',
    resourceType: 'Booking',
    resourceId: tripIdParam(req),
    metadata: { source: location.source ?? 'GPS' },
    ...requestMeta(req)
  })

  res.status(201).json({ success: true, location: toTripLocation(location) })
}

// POST /api/crew/me/trips/:id/no-show (trip:update) — patient not present
export const reportNoShowController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as ReportNoShowInput
  const booking = await reportNoShow(actor, tripIdParam(req), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'trip.no_show.report',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { reason: input.reason },
    ...requestMeta(req)
  })

  res.json({ success: true, trip: toBooking(booking) })
}
