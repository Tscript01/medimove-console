import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { Role, type AuthUser } from '../auth/permissions'
import { applyBookingTransition, transitionBooking } from './bookingService'
import { notifyBookingStatusChange } from './notificationService'
import type { ListTripsQuery, ReportNoShowInput, UpdateTripStatusInput } from '../validation/trip.schemas'

/**
 * Crew trip operations.
 *
 * The emergency state machine (`services/bookingService`) remains the only route
 * between statuses; this service adds the *crew* constraints on top of it:
 *
 *  1. A crew member only ever acts on a booking they personally accepted
 *     (`acceptedById`), so provider-mates cannot drive someone else's trip.
 *  2. Every transition still goes through `applyBookingTransition`, which
 *     authorises the move and stamps the matching trip-event timestamp.
 *  3. A no-show is a `FAILED` move from `ARRIVED` with a mandatory reason, and is
 *     additionally recorded on the booking (`noShowAt`/`noShowReason`).
 */

/** Statuses in which a trip is live and a crew may still report location. */
export const ACTIVE_TRIP_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PATIENT_ON_BOARD', 'AT_HOSPITAL'] as const

function forbidden(message: string, code: string): AppError {
  return new AppError(403, message, { code })
}

/** Loads the caller's own crew profile or fails closed. */
export async function requireCrewProfile(actor: AuthUser): Promise<Record<string, any>> {
  if (actor.role !== Role.CREW) {
    throw forbidden('Only a crew member can access trip operations.', 'FORBIDDEN')
  }
  const profile = await prisma.crewProfile.findUnique({ where: { userId: actor.userId } })
  if (!profile) {
    throw forbidden('Only an active crew member can access trip operations.', 'CREW_PROFILE_REQUIRED')
  }
  return profile
}

/**
 * Loads a booking and asserts it is the caller's own accepted trip. A booking
 * that is not theirs is reported as 404 so its existence is never leaked.
 */
export async function loadAssignedTrip(actor: AuthUser, bookingId: string): Promise<Record<string, any>> {
  await requireCrewProfile(actor)
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking || booking.acceptedById !== actor.userId) {
    throw new AppError(404, 'Trip not found.', { code: 'TRIP_NOT_FOUND' })
  }
  return booking
}

/**
 * The crew member's assigned trips. Active trips are returned by default; pass
 * `active=false` to include terminal ones, or `status=...` for a single status.
 */
export async function listCrewTrips(actor: AuthUser, query: ListTripsQuery = {}) {
  await requireCrewProfile(actor)

  const where: Record<string, unknown> = { acceptedById: actor.userId }
  if (query.status) {
    where.status = query.status
  } else if (query.active !== 'false') {
    where.status = { in: [...ACTIVE_TRIP_STATUSES] }
  }

  return prisma.booking.findMany({
    where,
    orderBy: [{ acceptedAt: 'desc' }, { createdAt: 'desc' }],
    take: 100
  })
}

/** A single assigned trip (404 when it is not the caller's). */
export async function getCrewTrip(actor: AuthUser, bookingId: string) {
  return loadAssignedTrip(actor, bookingId)
}

/**
 * Advances the caller's own trip. The move is validated and timestamped by the
 * shared state machine, so the crew surface can never invent a transition.
 */
export async function updateTripStatus(actor: AuthUser, bookingId: string, input: UpdateTripStatusInput) {
  await loadAssignedTrip(actor, bookingId)
  return transitionBooking(actor, bookingId, { status: input.status, reason: input.reason })
}

/**
 * Reports the patient was not present at the pickup point. Only valid after the
 * crew has arrived; the booking is failed with the mandatory reason and the
 * no-show is recorded explicitly.
 */
export async function reportNoShow(actor: AuthUser, bookingId: string, input: ReportNoShowInput) {
  const booking = await loadAssignedTrip(actor, bookingId)
  if (booking.status !== 'ARRIVED') {
    throw new AppError(409, 'A no-show can only be reported after arriving at the pickup point.', {
      code: 'NO_SHOW_REQUIRES_ARRIVED',
      status: booking.status
    })
  }

  const now = new Date()
  const failed = await prisma.$transaction(async (tx: any) => {
    await applyBookingTransition(tx, actor, bookingId, { to: 'FAILED', reason: input.reason })
    await tx.booking.update({
      where: { id: bookingId },
      data: { noShowAt: now, noShowReason: input.reason }
    })
    return tx.booking.findUnique({ where: { id: bookingId } })
  })

  // Notify after the no-show has committed (best-effort; never blocks the trip).
  await notifyBookingStatusChange(failed, 'FAILED')
  return failed
}
