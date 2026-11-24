import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { env } from '../config/env'
import { Role, type AuthUser } from '../auth/permissions'
import { loadBookingForUser } from '../utils/access'
import { haversineDistanceKm, roundKm } from '../utils/geo'
import { ACTIVE_TRIP_STATUSES, loadAssignedTrip, requireCrewProfile } from './tripService'
import type { RequesterLocationInput, TripLocationInput } from '../validation/trip.schemas'

/**
 * Trip tracking.
 *
 * There is no background worker and no Socket.IO transport in this codebase, so
 * tracking is **polling-based**: a client asks for a booking's tracking view and
 * gets the last known fix plus everything needed to decide whether it is live.
 *
 * Two invariants are load-bearing:
 *
 *  1. A crew fix is only ever accepted from the crew member who owns the trip,
 *     and only while the trip is live. The server — never the client — stamps
 *     the time, so a device clock cannot make an old point look fresh.
 *  2. A stale fix is never presented as live. `isLive` is derived from the
 *     server-recorded time and `TRACKING_STALE_AFTER_SECONDS`; a stale point is
 *     returned as the last-known position with `isLive: false`.
 *  3. A requester fix (moving pickup) is a separate stream. It is written
 *     without a vehicle/crew identity and never feeds the ambulance ETA. Only
 *     the booking requester and the crew member who accepted the booking may
 *     see it.
 *
 * Reads are authorised by `loadBookingForUser`, so a patient sees only their own
 * booking, a crew only their provider's, and an operator only their scope.
 */

/**
 * Statuses in which a moving pickup makes operational sense: a crew member has
 * accepted the booking and the patient is not yet on board.
 */
export const MOVING_PICKUP_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] as const

export type TrackingWaypoint = {
  kind: 'PICKUP' | 'DESTINATION'
  address: string | null
  lat: number
  lng: number
}

/** The next meaningful point for the current status (null once the trip ends). */
export function nextWaypoint(booking: Record<string, any>): TrackingWaypoint | null {
  const pickup: TrackingWaypoint = {
    kind: 'PICKUP',
    address: booking.pickupAddress ?? null,
    lat: booking.pickupLat,
    lng: booking.pickupLng
  }
  const destination: TrackingWaypoint = {
    kind: 'DESTINATION',
    address: booking.destAddress ?? null,
    lat: booking.destLat,
    lng: booking.destLng
  }
  switch (booking.status) {
    case 'ACCEPTED':
    case 'EN_ROUTE':
      return pickup
    case 'ARRIVED':
    case 'PATIENT_ON_BOARD':
    case 'AT_HOSPITAL':
      return destination
    default:
      return null
  }
}

/**
 * Records a crew GPS fix for their own live trip. The newest row is the last
 * known position; the vehicle's `currentLocation*` columns are refreshed in the
 * same transaction so dispatch matching sees the same point.
 */
export async function recordTripLocation(actor: AuthUser, bookingId: string, input: TripLocationInput) {
  const booking = await loadAssignedTrip(actor, bookingId)
  if (!ACTIVE_TRIP_STATUSES.includes(booking.status)) {
    throw new AppError(409, 'Location can only be reported for a live trip.', {
      code: 'TRIP_NOT_ACTIVE',
      status: booking.status
    })
  }

  const profile = await requireCrewProfile(actor)
  const ambulanceId = booking.assignedAmbulanceId ?? profile.assignedAmbulanceId ?? null
  const now = new Date()

  return prisma.$transaction(async (tx: any) => {
    const location = await tx.tripLocation.create({
      data: {
        bookingId,
        ambulanceId,
        crewProfileId: profile.id,
        recordedById: actor.userId,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters ?? null,
        speedKph: input.speedKph ?? null,
        headingDeg: input.headingDeg ?? null,
        source: input.source ?? 'GPS',
        recordedAt: now
      }
    })

    if (ambulanceId) {
      await tx.ambulance.update({
        where: { id: ambulanceId },
        data: {
          currentLatitude: input.latitude,
          currentLongitude: input.longitude,
          currentLocationUpdatedAt: now
        }
      })
    }

    return location
  })
}

/**
 * Records the booking requester's moving position for a rendezvous with their
 * assigned crew. This is deliberately not `recordTripLocation`: only the booking
 * owner may call it, it is only available before pickup, and no ambulance or
 * crew identity is attached. The fix is append-only and server-stamped, so the
 * tracking view can show its real age without trusting the device clock.
 */
export async function recordRequesterLocation(
  actor: AuthUser,
  bookingId: string,
  input: RequesterLocationInput
) {
  const booking = await loadBookingForUser(actor, bookingId)

  // The permission gate allows only patients at the route, but assert ownership
  // here too so a future route change cannot turn this into a location leak.
  if (booking.userId !== actor.userId) {
    throw new AppError(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
  }
  if (!MOVING_PICKUP_STATUSES.includes(booking.status as any) || !booking.acceptedById) {
    throw new AppError(409, 'Moving pickup location can only be shared while an ambulance is on the way.', {
      code: 'MOVING_PICKUP_NOT_ACTIVE',
      status: booking.status
    })
  }

  return prisma.tripLocation.create({
    data: {
      bookingId,
      ambulanceId: null,
      crewProfileId: null,
      recordedById: actor.userId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters ?? null,
      speedKph: input.speedKph ?? null,
      headingDeg: input.headingDeg ?? null,
      source: input.source ?? 'GPS',
      recordedAt: new Date()
    }
  })
}

export interface BookingTracking {
  booking: Record<string, any>
  status: string
  /** Raw last-known crew/vehicle fix (never a requester fix), or null. */
  lastKnown: Record<string, any> | null
  /** Where the last-known point came from. */
  lastKnownSource: 'TRIP' | 'AMBULANCE' | null
  /** Last requester fix for moving pickup, visible only to requester + assigned crew. */
  requesterLocation: Record<string, any> | null
  staleAfterSeconds: number
  nextWaypoint: TrackingWaypoint | null
  distanceRemainingKm: number | null
  etaMinutes: number | null
  etaAt: string | null
  /** Newest first; raw rows (serialize with `toTripLocation`). */
  recentLocations: Record<string, any>[]
  now: Date
}

/**
 * The authorised tracking view for one booking. Falls back to the assigned
 * vehicle's last-known fix when the trip has no tracked points yet, so a client
 * always has *something* to render — clearly marked stale if it is old.
 */
export async function getBookingTracking(
  actor: AuthUser,
  bookingId: string,
  now: Date = new Date()
): Promise<BookingTracking> {
  const booking = await loadBookingForUser(actor, bookingId)

  // Crew fixes always carry a crew profile. Requester fixes deliberately do not,
  // so filtering here keeps the ambulance marker, ETA and history independent
  // of the moving-pickup stream.
  const recent = await prisma.tripLocation.findMany({
    where: { bookingId: booking.id, crewProfileId: { not: null } },
    orderBy: { recordedAt: 'desc' },
    take: env.TRACKING_HISTORY_LIMIT
  })

  const canSeeRequesterLocation =
    MOVING_PICKUP_STATUSES.includes(booking.status as any) &&
    (booking.userId === actor.userId ||
      (actor.role === Role.CREW && booking.acceptedById === actor.userId))

  const requesterLocation = canSeeRequesterLocation
    ? await prisma.tripLocation.findFirst({
        where: {
          bookingId: booking.id,
          ambulanceId: null,
          crewProfileId: null,
          recordedById: booking.userId
        },
        orderBy: { recordedAt: 'desc' }
      })
    : null

  let lastKnown: Record<string, any> | null = recent[0] ?? null
  let lastKnownSource: 'TRIP' | 'AMBULANCE' | null = lastKnown ? 'TRIP' : null

  if (!lastKnown && booking.assignedAmbulanceId) {
    const ambulance = await prisma.ambulance.findUnique({ where: { id: booking.assignedAmbulanceId } })
    if (ambulance && ambulance.currentLatitude != null && ambulance.currentLongitude != null) {
      lastKnown = {
        id: null,
        bookingId: booking.id,
        ambulanceId: ambulance.id,
        crewProfileId: null,
        latitude: ambulance.currentLatitude,
        longitude: ambulance.currentLongitude,
        accuracyMeters: null,
        speedKph: null,
        headingDeg: null,
        source: 'GPS',
        recordedAt: ambulance.currentLocationUpdatedAt ?? null
      }
      lastKnownSource = 'AMBULANCE'
    }
  }

  const waypoint = nextWaypoint(booking)
  let distanceRemainingKm: number | null = null
  let etaMinutes: number | null = null
  let etaAt: string | null = null
  if (lastKnown && waypoint) {
    distanceRemainingKm = roundKm(
      haversineDistanceKm(lastKnown.latitude, lastKnown.longitude, waypoint.lat, waypoint.lng)
    )
    etaMinutes = Math.max(0, Math.round((distanceRemainingKm / env.TRACKING_ETA_SPEED_KPH) * 60))
    etaAt = new Date(now.getTime() + etaMinutes * 60_000).toISOString()
  }

  return {
    booking,
    status: booking.status,
    lastKnown,
    lastKnownSource,
    requesterLocation,
    staleAfterSeconds: env.TRACKING_STALE_AFTER_SECONDS,
    nextWaypoint: waypoint,
    distanceRemainingKm,
    etaMinutes,
    etaAt,
    recentLocations: recent,
    now
  }
}
