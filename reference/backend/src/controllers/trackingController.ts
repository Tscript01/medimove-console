import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { toTrackingView, toTripLocation } from '../utils/serializers'
import { recordAudit } from '../services/auditService'
import { getBookingTracking, recordRequesterLocation } from '../services/trackingService'
import { requestMeta } from '../utils/requestMeta'
import type { RequesterLocationInput } from '../validation/trip.schemas'

/**
 * Tracking read handler.
 *
 * Polling is the transport: the client asks for a booking's tracking view and
 * gets the last known fix plus `isLive`/`eta` metadata. The response is
 * deliberately minimal — no patient details — because it is also readable by a
 * crew member and (state-scoped) operators. Authorisation is enforced by
 * `loadBookingForUser` inside the service.
 */

function bookingIdParam(req: { params: Record<string, unknown> }): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Booking id is required.', { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

// GET /api/bookings/:id/tracking (tracking:read:own or tracking:read)
export const getBookingTrackingController: RequestHandler = async (req, res) => {
  const now = new Date()
  const tracking = await getBookingTracking(currentUser(req), bookingIdParam(req), now)

  res.json({ success: true, tracking: toTrackingView(tracking, { now }) })
}

// POST /api/bookings/:id/tracking/requester-location (tracking:share:own)
// Requester consent is explicit: each POST is a new, server-stamped fix, and the
// client stops sharing simply by stopping the watcher. Coordinates are never
// written to the audit trail.
export const recordRequesterLocationController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const bookingId = bookingIdParam(req)
  const input = req.body as RequesterLocationInput
  const location = await recordRequesterLocation(actor, bookingId, input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'booking.tracking.requester_location.record',
    resourceType: 'Booking',
    resourceId: bookingId,
    metadata: { source: location.source ?? 'GPS' },
    ...requestMeta(req)
  })

  res.status(201).json({ success: true, location: toTripLocation(location, { subject: 'REQUESTER' }) })
}
