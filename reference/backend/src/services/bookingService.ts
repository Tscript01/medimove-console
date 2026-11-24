import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { Role, type AuthUser } from '../auth/permissions'
import { loadBookingForUser } from '../utils/access'
import { assertInCoverage } from './coverageService'
import { isCrewDispatchable, isProviderDispatchable } from './dispatchEligibility'
import { geocodingService } from './geocodingService'
import { haversineDistanceKm, roundKm } from '../utils/geo'
import { computeFareForBooking } from './pricingService'
import { notifyBookingReceived, notifyBookingStatusChange } from './notificationService'
import type { CreateBookingInput, UpdateBookingStatusInput } from '../validation/booking.schemas'
import { BOOKING_STATUS_VALUES } from '../validation/booking.schemas'

/**
 * Emergency booking lifecycle.
 *
 * Two rules are load-bearing and enforced here, not in controllers:
 *  1. A booking is only ever *dispatched* once a crew has accepted it. The
 *     `ACCEPTED` transition always resolves and records the accepting crew.
 *  2. Every status change is written to an append-only history with the actor,
 *     timestamp and reason.
 */

export type BookingStatus = (typeof BOOKING_STATUS_VALUES)[number]

/** Statuses from which the booking counts as "dispatched" to the requester. */
export const DISPATCHED_STATUSES: readonly BookingStatus[] = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'PATIENT_ON_BOARD',
  'AT_HOSPITAL',
  'COMPLETED'
]

const TERMINAL_STATUSES: readonly BookingStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED']

/**
 * The milestone timestamp column stamped when a booking moves into a status.
 * Kept here (next to the state machine) so every route into a status — crew
 * trip ops, dispatch accept, operator transition — records the same timeline.
 */
const STATUS_TIMESTAMP_FIELD: Partial<Record<BookingStatus, string>> = {
  EN_ROUTE: 'enRouteAt',
  ARRIVED: 'arrivedAt',
  PATIENT_ON_BOARD: 'patientOnBoardAt',
  AT_HOSPITAL: 'atHospitalAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt',
  FAILED: 'failedAt'
}

/** Roles that act on behalf of the platform / a provider. */
const OPERATORS = [Role.DISPATCHER, Role.PROVIDER_ADMIN, Role.STATE_ADMIN, Role.PLATFORM_ADMIN] as const
const REQUESTER_OR_OPERATOR = [Role.PATIENT, ...OPERATORS] as const

/**
 * The controlled state machine. `BOOKING_TRANSITIONS[from][to]` lists the roles
 * permitted to make that move. A move that is not listed is rejected outright;
 * the same map therefore expresses both *validity* and *authorization*.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, Partial<Record<BookingStatus, readonly Role[]>>> = {
  REQUESTED: {
    OFFERED: OPERATORS,
    CANCELLED: REQUESTER_OR_OPERATOR,
    FAILED: OPERATORS
  },
  OFFERED: {
    ACCEPTED: [Role.CREW, ...OPERATORS],
    // An offer can be withdrawn (timeout / retry) without failing the booking.
    REQUESTED: OPERATORS,
    CANCELLED: REQUESTER_OR_OPERATOR,
    FAILED: OPERATORS
  },
  ACCEPTED: {
    EN_ROUTE: [Role.CREW, ...OPERATORS],
    CANCELLED: REQUESTER_OR_OPERATOR,
    FAILED: OPERATORS
  },
  EN_ROUTE: {
    ARRIVED: [Role.CREW, ...OPERATORS],
    CANCELLED: OPERATORS,
    // A crew may report a breakdown/abort with a reason; the trip did not happen.
    FAILED: [Role.CREW, ...OPERATORS]
  },
  ARRIVED: {
    PATIENT_ON_BOARD: [Role.CREW, ...OPERATORS],
    CANCELLED: OPERATORS,
    // A crew reports a patient no-show (or abort) with a reason from ARRIVED.
    FAILED: [Role.CREW, ...OPERATORS]
  },
  PATIENT_ON_BOARD: {
    AT_HOSPITAL: [Role.CREW, ...OPERATORS],
    FAILED: OPERATORS
  },
  AT_HOSPITAL: {
    COMPLETED: [Role.CREW, ...OPERATORS]
  },
  COMPLETED: {},
  CANCELLED: {},
  FAILED: {}
}

export function allowedTransitions(status: BookingStatus): BookingStatus[] {
  return Object.keys(BOOKING_TRANSITIONS[status] ?? {}) as BookingStatus[]
}

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// --- Fare ------------------------------------------------------------------
// Fare computation is server-authoritative and database-backed; it lives in
// `pricingService` (configurable rules scoped by provider / state / service area
// / vehicle category, with a fallback to the provider's own stored rate).
// Re-exported here so existing importers keep working.
export { computeFareFromConfig, computeFareForBooking, computeLegacyFare } from './pricingService'
export type { FareBreakdown, FareResult } from './pricingService'

// --- Capacity --------------------------------------------------------------

/**
 * A booking may only be accepted against a provider that can actually serve it:
 * the provider must be verified + active and own at least one verified, active
 * vehicle. Availability is re-checked at dispatch time (Stage 8).
 */
async function assertProviderCapacity(provider: {
  id: string
  status?: string | null
  verificationStatus?: string | null
  availableStatus?: boolean | null
}): Promise<void> {
  if (!isProviderDispatchable(provider)) {
    throw new AppError(409, 'The selected provider is not currently accepting bookings.', {
      code: 'PROVIDER_NOT_DISPATCHABLE'
    })
  }
  const vehicles = await prisma.ambulance.count({
    where: { providerId: provider.id, status: 'VERIFIED', isActive: true }
  })
  if (vehicles < 1) {
    throw new AppError(409, 'The selected provider has no available ambulances.', {
      code: 'NO_PROVIDER_CAPACITY'
    })
  }
}

// --- Creation --------------------------------------------------------------

export interface CreateBookingResult {
  booking: Record<string, any>
  /** True when an existing booking was returned for a repeated idempotency key. */
  reused: boolean
}

export async function createBooking(user: AuthUser, input: CreateBookingInput): Promise<CreateBookingResult> {
  const provider = await prisma.ambulanceProvider.findUnique({ where: { id: input.providerId } })
  if (!provider) {
    throw new AppError(404, 'Selected provider not found.', { code: 'PROVIDER_NOT_FOUND' })
  }

  // Idempotency: a retried request with the same key returns the original
  // booking rather than creating a duplicate.
  if (input.idempotencyKey) {
    const existing = await prisma.booking.findFirst({
      where: { userId: user.userId, idempotencyKey: input.idempotencyKey }
    })
    if (existing) return { booking: existing, reused: true }
  }

  // Resolve the destination: explicit coordinates win, otherwise the hospital's
  // own coordinates are used. There is no hardcoded fallback location.
  let destLat = input.destLat
  let destLng = input.destLng
  let destAddress = input.destAddress
  if ((destLat === undefined || destLng === undefined) && input.destinationHospitalId) {
    const hospital = await prisma.hospital.findUnique({ where: { id: input.destinationHospitalId } })
    if (!hospital) throw new AppError(404, 'Destination hospital not found.', { code: 'HOSPITAL_NOT_FOUND' })
    destLat = hospital.lat
    destLng = hospital.lng
    destAddress = destAddress ?? `${hospital.name}, ${hospital.city}`
  }
  if (destLat === undefined || destLng === undefined) {
    throw new AppError(400, 'A destination location is required.', { code: 'VALIDATION_ERROR', field: 'destLat' })
  }

  // Coverage is validated on the backend before the request is accepted.
  const coverage = await assertInCoverage(input.pickupLat, input.pickupLng)

  // Capacity is validated against the provider's verified fleet.
  await assertProviderCapacity(provider)

  const pickupAddress =
    input.pickupAddress ??
    (await geocodingService.reverse(input.pickupLat, input.pickupLng))?.address ??
    `Location (${input.pickupLat.toFixed(4)}, ${input.pickupLng.toFixed(4)})`

  const distanceKm = roundKm(haversineDistanceKm(input.pickupLat, input.pickupLng, destLat, destLng))
  const { estimatedFareKobo, breakdown } = await computeFareForBooking(
    provider,
    {
      stateId: coverage.stateId ?? provider.stateId ?? null,
      serviceAreaId: coverage.serviceAreaId ?? null,
      vehicleCategory: null
    },
    distanceKm
  )

  const isForSelf = input.isForSelf !== false
  const reference = `MM-BOOK-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`

  const booking = await prisma.$transaction(async (tx: any) => {
    const created = await tx.booking.create({
      data: {
        reference,
        userId: user.userId,
        providerId: provider.id,
        pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        landmark: input.landmark ?? null,
        destAddress: destAddress ?? `Location (${destLat.toFixed(4)}, ${destLng.toFixed(4)})`,
        destLat,
        destLng,
        destinationHospitalId: input.destinationHospitalId ?? null,
        isForSelf,
        patientName: input.patientName ?? null,
        patientPhone: input.patientPhone ?? null,
        patientAge: input.patientAge ?? null,
        patientGender: input.patientGender ?? null,
        callbackPhone: input.callbackPhone,
        emergencyCategory: input.emergencyCategory,
        notes: input.notes ?? null,
        requestedAt: new Date(),
        distanceKm,
        estimatedFare: estimatedFareKobo,
        fareBreakdown: breakdown,
        pricingConfigId: breakdown.pricingConfigId,
        status: 'REQUESTED',
        // The operating state is derived from the incident coverage / provider,
        // never from the client.
        stateId: coverage.stateId ?? provider.stateId ?? null,
        idempotencyKey: input.idempotencyKey ?? null
      }
    })

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: created.id,
        fromStatus: null,
        toStatus: 'REQUESTED',
        actorId: user.userId,
        actorRole: user.role,
        reason: 'Emergency request created'
      }
    })

    return created
  })

  // Best-effort, out-of-band acknowledgement. A notification failure can never
  // change (or roll back) the booking that was just created.
  await notifyBookingReceived(booking)

  return { booking, reused: false }
}

// --- Transitions -----------------------------------------------------------

async function resolveAcceptingCrew(
  actor: AuthUser,
  booking: { providerId: string },
  input: UpdateBookingStatusInput
): Promise<Record<string, any>> {
  let profile: Record<string, any> | null
  if (actor.role === Role.CREW) {
    profile = await prisma.crewProfile.findFirst({ where: { userId: actor.userId } })
    if (!profile) {
      throw new AppError(403, 'Only an active crew member can accept a booking.', { code: 'CREW_PROFILE_REQUIRED' })
    }
  } else {
    if (!input.crewProfileId) {
      throw new AppError(400, 'A crewProfileId is required when recording acceptance for a crew member.', {
        code: 'CREW_REQUIRED',
        field: 'crewProfileId'
      })
    }
    profile = await prisma.crewProfile.findUnique({ where: { id: input.crewProfileId } })
    if (!profile) throw new AppError(404, 'Crew profile not found.', { code: 'CREW_NOT_FOUND' })
  }

  if (profile.providerId !== booking.providerId) {
    throw new AppError(403, 'That crew member does not belong to the booking provider.', {
      code: 'CREW_PROVIDER_MISMATCH'
    })
  }
  if (!isCrewDispatchable(profile)) {
    throw new AppError(409, 'Only a verified, active crew member assigned to a vehicle can accept a booking.', {
      code: 'CREW_NOT_DISPATCHABLE'
    })
  }
  return profile
}

/**
 * Applies a validated transition to a booking using the caller's `tx`. The
 * current status is re-read and the write is guarded by `status = from`, so two
 * concurrent actors can never both advance the same booking. Exported so the
 * dispatch engine can record an acceptance in the same transaction as the offer
 * update.
 */
export async function applyBookingTransition(
  tx: any,
  actor: { userId: string; role: Role },
  bookingId: string,
  options: {
    to: BookingStatus
    reason?: string | null
    /** Required when `to` is ACCEPTED: the crew member taking the job. */
    assignment?: { acceptedById: string; assignedAmbulanceId: string | null }
  }
): Promise<Record<string, any>> {
  const current = await tx.booking.findUnique({ where: { id: bookingId } })
  if (!current) throw new AppError(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })

  const from = current.status as BookingStatus
  const to = options.to
  const permitted = BOOKING_TRANSITIONS[from]?.[to]

  if (!permitted) {
    throw new AppError(400, `Cannot change a ${from} booking to ${to}.`, {
      code: 'INVALID_STATUS_TRANSITION',
      from,
      to,
      allowed: allowedTransitions(from)
    })
  }
  if (!permitted.includes(actor.role)) {
    throw new AppError(403, 'You are not allowed to perform this booking transition.', {
      code: 'FORBIDDEN',
      from,
      to,
      role: actor.role
    })
  }
  if (to === 'FAILED' && !options.reason?.trim()) {
    throw new AppError(400, 'A reason is required when failing a booking.', {
      code: 'REASON_REQUIRED',
      field: 'reason'
    })
  }
  if (to === 'CANCELLED' && from !== 'REQUESTED' && actor.role !== Role.PATIENT && !options.reason?.trim()) {
    throw new AppError(400, 'A reason is required when cancelling a booking.', {
      code: 'REASON_REQUIRED',
      field: 'reason'
    })
  }

  const data: Record<string, unknown> = { status: to }
  if (to === 'ACCEPTED') {
    // Dispatch is only ever recorded against a real, eligible crew member.
    if (!options.assignment) {
      throw new AppError(400, 'An accepting crew member is required.', {
        code: 'CREW_REQUIRED',
        field: 'crewProfileId'
      })
    }
    data.acceptedAt = new Date()
    data.acceptedById = options.assignment.acceptedById
    data.assignedAmbulanceId = options.assignment.assignedAmbulanceId ?? null
  }

  // Stamp the trip milestone for this status so the timeline is complete no
  // matter which surface applied the transition.
  const milestoneField = STATUS_TIMESTAMP_FIELD[to]
  if (milestoneField) data[milestoneField] = new Date()

  const guard = await tx.booking.updateMany({ where: { id: bookingId, status: from }, data })
  if (guard.count !== 1) {
    throw new AppError(409, 'The booking was updated by someone else. Please retry.', {
      code: 'CONCURRENT_MODIFICATION'
    })
  }

  await tx.bookingStatusHistory.create({
    data: {
      bookingId,
      fromStatus: from,
      toStatus: to,
      actorId: actor.userId,
      actorRole: actor.role,
      reason: options.reason?.trim() || null
    }
  })

  return tx.booking.findUnique({ where: { id: bookingId } })
}

/**
 * Applies a validated transition atomically (see `applyBookingTransition`). The
 * accepting crew is resolved first for an `ACCEPTED` move.
 */
export async function transitionBooking(
  actor: AuthUser,
  bookingId: string,
  input: UpdateBookingStatusInput
): Promise<Record<string, any>> {
  // Scope check first: an out-of-scope booking is a 404, never a 403.
  await loadBookingForUser(actor, bookingId)

  const to = input.status as BookingStatus

  let assignment: { acceptedById: string; assignedAmbulanceId: string | null } | undefined
  if (to === 'ACCEPTED') {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new AppError(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
    const crew = await resolveAcceptingCrew(actor, booking, input)
    assignment = { acceptedById: crew.userId, assignedAmbulanceId: crew.assignedAmbulanceId ?? null }
  }

  const updated = await prisma.$transaction((tx: any) =>
    applyBookingTransition(tx, actor, bookingId, { to, reason: input.reason ?? null, assignment })
  )

  // Notify after the transition has committed, so a notification can never
  // report (or cause) a change that did not happen.
  await notifyBookingStatusChange(updated, to)
  return updated
}

/** Requester- or operator-initiated cancellation. */
export async function cancelBooking(actor: AuthUser, bookingId: string, reason?: string) {
  return transitionBooking(actor, bookingId, { status: 'CANCELLED', reason })
}

// --- Reads -----------------------------------------------------------------

export async function getBookingHistory(actor: AuthUser, bookingId: string) {
  const booking = await loadBookingForUser(actor, bookingId)
  return prisma.bookingStatusHistory.findMany({
    where: { bookingId: booking.id },
    orderBy: { createdAt: 'asc' }
  })
}
