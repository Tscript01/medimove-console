import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { env } from '../config/env'
import { Role, type AuthUser } from '../auth/permissions'
import { bookingScopeFilter, loadBookingForUser } from '../utils/access'
import { logger } from '../utils/logger'
import { haversineDistanceKm, roundKm } from '../utils/geo'
import { isAmbulanceDispatchable, isCrewDispatchable, isProviderDispatchable } from './dispatchEligibility'
import { applyBookingTransition } from './bookingService'
import { dispatchNotifier } from './dispatchNotifier'
import { notifyBookingStatusChange, notifyDispatcherContact } from './notificationService'
import { getBookingTracking } from './trackingService'
import type {
  ContactPartyInput,
  EscalateBookingInput,
  ListDispatchAmbulancesQuery,
  ListDispatchBookingsQuery
} from '../validation/dispatch.schemas'

/**
 * Hybrid dispatch engine.
 *
 * The engine *recommends* the best-ranked eligible crews and *offers* them the
 * job (with a short expiry); a human dispatcher can always override by assigning
 * or reassigning a specific crew. Two invariants are load-bearing:
 *
 *  1. A booking is only ever dispatched when a crew accepts its own still-live
 *     offer, and the acceptance is guarded so two crews can never both win the
 *     same booking.
 *  2. Dispatch never invents eligibility: a candidate must be a verified, active
 *     crew member on a verified, active vehicle belonging to the booking's
 *     verified, active provider, within range of the incident.
 */

/** Statuses in which the booking is already taken and offers must not be sent. */
const DISPATCHABLE_BOOKING_STATUSES = ['REQUESTED', 'OFFERED'] as const
const REASSIGNABLE_BOOKING_STATUSES = ['ACCEPTED', 'EN_ROUTE'] as const
const AVAILABLE = ['AVAILABLE', 'ON_DUTY'] as const

/**
 * Which vehicle categories can serve which emergency category. A mismatch is a
 * ranking penalty, not a hard exclusion, so a remote area with only a basic
 * vehicle still gets a candidate.
 */
const CATEGORY_CAPABILITY: Record<string, readonly string[]> = {
  MEDICAL: ['BASIC_LIFE_SUPPORT', 'ADVANCED_LIFE_SUPPORT', 'PATIENT_TRANSPORT'],
  TRAUMA: ['ADVANCED_LIFE_SUPPORT', 'BASIC_LIFE_SUPPORT'],
  CARDIAC: ['ADVANCED_LIFE_SUPPORT'],
  RESPIRATORY: ['ADVANCED_LIFE_SUPPORT'],
  OBSTETRIC: ['ADVANCED_LIFE_SUPPORT', 'BASIC_LIFE_SUPPORT'],
  PEDIATRIC: ['NEONATAL', 'ADVANCED_LIFE_SUPPORT', 'BASIC_LIFE_SUPPORT'],
  PSYCHIATRIC: ['PATIENT_TRANSPORT', 'BASIC_LIFE_SUPPORT'],
  ACCIDENT: ['ADVANCED_LIFE_SUPPORT', 'BASIC_LIFE_SUPPORT'],
  OTHER: ['BASIC_LIFE_SUPPORT', 'ADVANCED_LIFE_SUPPORT', 'PATIENT_TRANSPORT', 'NEONATAL']
}

/** True when a vehicle category is a good capability fit for the emergency. */
export function capabilityMatches(vehicleCategory: string, emergencyCategory: string): boolean {
  const supported = CATEGORY_CAPABILITY[emergencyCategory] ?? CATEGORY_CAPABILITY.OTHER
  return supported.includes(vehicleCategory)
}

export interface DispatchCandidate {
  providerId: string
  ambulanceId: string
  crewProfileId: string
  crewUserId: string
  vehicleCategory: string
  crewRole: string
  ambulanceAvailability: string
  crewAvailability: string
  /** Distance from the candidate's last known position to the incident. */
  distanceKm: number | null
  capabilityMatch: boolean
}

// --- Expiry ----------------------------------------------------------------

/**
 * Sweeps offers whose deadline has passed. There is no background scheduler, so
 * this is called lazily before any dispatch read or action. An expired offer is
 * never actionable again, but the booking itself stays `OFFERED` until a retry
 * or a human resolves it.
 */
export async function expireStaleOffers(now: Date = new Date()): Promise<number> {
  const result = await prisma.dispatchOffer.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
    data: { status: 'EXPIRED', respondedAt: now }
  })
  return result?.count ?? 0
}

// --- Candidate matching -----------------------------------------------------

function lastKnownPosition(
  ambulance: Record<string, any>,
  provider: Record<string, any>
): { lat: number; lng: number } {
  const { currentLatitude, currentLongitude } = ambulance
  if (
    currentLatitude !== null &&
    currentLatitude !== undefined &&
    currentLongitude !== null &&
    currentLongitude !== undefined
  ) {
    return { lat: Number(currentLatitude), lng: Number(currentLongitude) }
  }
  // Fall back to the provider's registered base when the vehicle has no fix.
  return { lat: Number(provider.latitude), lng: Number(provider.longitude) }
}

/**
 * Builds the ranked list of crews that could serve a booking. Only the booking's
 * own provider is considered (a booking carries its provider from creation).
 * Already-offered crews are excluded so a retry reaches new people first.
 */
async function gatherCandidates(
  booking: Record<string, any>,
  excludedCrewIds: Set<string>
): Promise<DispatchCandidate[]> {
  const provider = await prisma.ambulanceProvider.findUnique({ where: { id: booking.providerId } })
  if (!provider || !isProviderDispatchable(provider)) return []

  // Coverage: when both the incident and the provider are pinned to a state,
  // they must agree.
  if (booking.stateId && provider.stateId && provider.stateId !== booking.stateId) return []

  const ambulances = await prisma.ambulance.findMany({ where: { providerId: provider.id } })
  const eligibleAmbulances = new Map<string, Record<string, any>>()
  for (const ambulance of ambulances) {
    if (!isAmbulanceDispatchable(ambulance)) continue
    if (!AVAILABLE.includes(ambulance.availability)) continue
    eligibleAmbulances.set(ambulance.id, ambulance)
  }

  const crewProfiles = await prisma.crewProfile.findMany({ where: { providerId: provider.id } })
  const candidates: DispatchCandidate[] = []

  for (const crew of crewProfiles) {
    if (excludedCrewIds.has(crew.id)) continue
    if (!isCrewDispatchable(crew)) continue
    if (!AVAILABLE.includes(crew.availability)) continue

    const ambulance = crew.assignedAmbulanceId ? eligibleAmbulances.get(crew.assignedAmbulanceId) : undefined
    if (!ambulance) continue

    const position = lastKnownPosition(ambulance, provider)
    const distanceKm = roundKm(
      haversineDistanceKm(position.lat, position.lng, booking.pickupLat, booking.pickupLng)
    )
    // Unknown-but-far candidates are dropped; the provider base is a safe proxy.
    if (distanceKm > env.DISPATCH_MAX_RADIUS_KM) continue

    candidates.push({
      providerId: provider.id,
      ambulanceId: ambulance.id,
      crewProfileId: crew.id,
      crewUserId: crew.userId,
      vehicleCategory: ambulance.category,
      crewRole: crew.crewRole,
      ambulanceAvailability: ambulance.availability,
      crewAvailability: crew.availability,
      distanceKm,
      capabilityMatch: capabilityMatches(ambulance.category, booking.emergencyCategory)
    })
  }

  // Best capability first, then nearest. Ranking only — a dispatcher can always
  // override by assigning manually.
  return candidates.sort((a, b) => {
    if (a.capabilityMatch !== b.capabilityMatch) return a.capabilityMatch ? -1 : 1
    return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
  })
}

/** Recommended candidates for a booking (dispatcher preview, no offers sent). */
export async function getDispatchCandidates(actor: AuthUser, bookingId: string) {
  const booking = await loadBookingForUser(actor, bookingId)
  await expireStaleOffers()
  const offered = await prisma.dispatchOffer.findMany({ where: { bookingId } })
  const excluded = new Set<string>(offered.map((o: Record<string, any>) => o.crewProfileId))
  const candidates = await gatherCandidates(booking, excluded)
  return { booking, candidates }
}

// --- Offers -----------------------------------------------------------------

async function notifyOffer(booking: Record<string, any>, offer: Record<string, any>): Promise<void> {
  try {
    await dispatchNotifier.notifyOffer({
      offerId: offer.id,
      bookingId: booking.id,
      bookingReference: booking.reference,
      providerId: offer.providerId,
      ambulanceId: offer.ambulanceId,
      crewProfileId: offer.crewProfileId,
      expiresAt: offer.expiresAt
    })
  } catch (err) {
    // A notification failure must never undo a valid offer.
    logger.error({ err, offerId: offer.id }, 'Failed to notify crew of a dispatch offer')
  }
}

async function persistOffers(
  booking: Record<string, any>,
  actor: AuthUser,
  candidates: DispatchCandidate[],
  round: number,
  ttlSeconds: number
): Promise<Record<string, any>[]> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const offers = await prisma.$transaction(async (tx: any) => {
    // The only way into OFFERED is the state machine.
    if (booking.status === 'REQUESTED') {
      await applyBookingTransition(tx, actor, booking.id, { to: 'OFFERED', reason: 'Dispatch started' })
    }
    await tx.booking.update({
      where: { id: booking.id },
      data: { dispatchRound: round, dispatchEscalatedAt: null }
    })

    const created: Record<string, any>[] = []
    for (const candidate of candidates) {
      const offer = await tx.dispatchOffer.create({
        data: {
          bookingId: booking.id,
          providerId: candidate.providerId,
          ambulanceId: candidate.ambulanceId,
          crewProfileId: candidate.crewProfileId,
          round,
          status: 'PENDING',
          distanceKm: candidate.distanceKm,
          capabilityMatch: candidate.capabilityMatch,
          offeredAt: new Date(),
          expiresAt,
          createdById: actor.userId
        }
      })
      created.push(offer)
    }
    return created
  })

  for (const offer of offers) await notifyOffer(booking, offer)
  return offers
}

/**
 * Flags a booking for manual assignment and records *why* in the status trail.
 * Kept in its own transaction so the note survives the 409 the caller receives.
 */
async function escalateDispatch(actor: AuthUser, booking: Record<string, any>, reason: string): Promise<void> {
  const now = new Date()
  await prisma.$transaction(async (tx: any) => {
    await tx.booking.update({ where: { id: booking.id }, data: { dispatchEscalatedAt: now } })
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        actorId: actor.userId,
        actorRole: actor.role,
        reason
      }
    })
  })
}

function assertDispatchableBooking(booking: Record<string, any>): void {
  if (!DISPATCHABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new AppError(409, `A ${booking.status} booking cannot be dispatched.`, {
      code: 'BOOKING_NOT_DISPATCHABLE',
      status: booking.status
    })
  }
}

/**
 * Starts (or restarts) dispatch: recommends eligible crews and creates
 * time-boxed offers for the best few. A `REQUESTED` booking moves to `OFFERED`.
 */
export async function createDispatchOffers(
  actor: AuthUser,
  bookingId: string,
  input: { candidateLimit?: number; ttlSeconds?: number } = {}
) {
  const booking = await loadBookingForUser(actor, bookingId)
  assertDispatchableBooking(booking)
  await expireStaleOffers()

  const round = (booking.dispatchRound ?? 0) + 1
  if (round > env.DISPATCH_MAX_ROUNDS) {
    await escalateDispatch(actor, booking, `Escalated: dispatch round limit (${env.DISPATCH_MAX_ROUNDS}) reached.`)
    throw new AppError(409, 'Dispatch has been escalated for manual assignment.', {
      code: 'DISPATCH_ESCALATED',
      round: booking.dispatchRound
    })
  }

  const existing = await prisma.dispatchOffer.findMany({ where: { bookingId } })
  const excluded = new Set<string>(existing.map((o: Record<string, any>) => o.crewProfileId))
  const limit = input.candidateLimit ?? env.DISPATCH_MAX_CANDIDATES
  const candidates = (await gatherCandidates(booking, excluded)).slice(0, limit)

  if (candidates.length === 0) {
    await escalateDispatch(actor, booking, 'Escalated: no eligible crew are available.')
    throw new AppError(409, 'No eligible crew are available to dispatch this booking.', {
      code: 'NO_DISPATCH_CANDIDATES'
    })
  }

  const ttlSeconds = input.ttlSeconds ?? env.DISPATCH_OFFER_TTL_SECONDS
  const offers = await persistOffers(booking, actor, candidates, round, ttlSeconds)
  const updated = await prisma.booking.findUnique({ where: { id: bookingId } })
  return { booking: updated, offers, round, candidates }
}

/**
 * Retries dispatch with the next batch of candidates (never re-offering someone
 * who already declined or timed out). When there is nobody left, or the round
 * limit is hit, the booking is escalated for manual assignment.
 */
export async function retryDispatch(
  actor: AuthUser,
  bookingId: string,
  input: { candidateLimit?: number; ttlSeconds?: number } = {}
) {
  const booking = await loadBookingForUser(actor, bookingId)
  if (booking.status !== 'OFFERED') {
    throw new AppError(409, 'Only an offered booking can be retried.', {
      code: 'BOOKING_NOT_OFFERED',
      status: booking.status
    })
  }
  await expireStaleOffers()

  const round = (booking.dispatchRound ?? 0) + 1
  if (round > env.DISPATCH_MAX_ROUNDS) {
    await escalateDispatch(actor, booking, `Escalated: dispatch round limit (${env.DISPATCH_MAX_ROUNDS}) reached.`)
    throw new AppError(409, 'Dispatch has been escalated for manual assignment.', {
      code: 'DISPATCH_ESCALATED',
      round: booking.dispatchRound
    })
  }

  const existing = await prisma.dispatchOffer.findMany({ where: { bookingId } })
  const excluded = new Set<string>(existing.map((o: Record<string, any>) => o.crewProfileId))
  const limit = input.candidateLimit ?? env.DISPATCH_MAX_CANDIDATES
  const candidates = (await gatherCandidates(booking, excluded)).slice(0, limit)

  if (candidates.length === 0) {
    await escalateDispatch(actor, booking, 'Escalated: no further eligible crew are available.')
    throw new AppError(409, 'No further eligible crew are available; dispatch escalated.', {
      code: 'DISPATCH_ESCALATED'
    })
  }

  const ttlSeconds = input.ttlSeconds ?? env.DISPATCH_OFFER_TTL_SECONDS
  const offers = await persistOffers(booking, actor, candidates, round, ttlSeconds)
  const updated = await prisma.booking.findUnique({ where: { id: bookingId } })
  return { booking: updated, offers, round, candidates }
}

// --- Responding -------------------------------------------------------------

/** Loads the caller's own crew profile or fails closed. */
async function requireOwnCrewProfile(actor: AuthUser): Promise<Record<string, any>> {
  if (actor.role !== Role.CREW) {
    throw new AppError(403, 'Only a crew member can respond to a dispatch offer.', { code: 'FORBIDDEN' })
  }
  const profile = await prisma.crewProfile.findUnique({ where: { userId: actor.userId } })
  if (!profile) {
    throw new AppError(403, 'Only an active crew member can respond to a dispatch offer.', {
      code: 'CREW_PROFILE_REQUIRED'
    })
  }
  return profile
}

/**
 * A crew accepts their own live offer. The acceptance and the booking
 * transition happen in one transaction, guarded so that exactly one crew can win
 * the booking; every other live offer for it is cancelled.
 */
export async function acceptOffer(actor: AuthUser, offerId: string) {
  const profile = await requireOwnCrewProfile(actor)

  const offer = await prisma.dispatchOffer.findUnique({ where: { id: offerId } })
  // Out-of-scope offers are 404s so their existence is never leaked.
  if (!offer || offer.crewProfileId !== profile.id) {
    throw new AppError(404, 'Dispatch offer not found.', { code: 'OFFER_NOT_FOUND' })
  }

  await expireStaleOffers()
  const fresh = await prisma.dispatchOffer.findUnique({ where: { id: offerId } })
  if (!fresh || fresh.status !== 'PENDING') {
    const expired = fresh?.status === 'EXPIRED'
    throw new AppError(expired ? 410 : 409, 'This dispatch offer is no longer actionable.', {
      code: expired ? 'OFFER_EXPIRED' : 'OFFER_NOT_PENDING',
      status: fresh?.status ?? null
    })
  }

  // Eligibility is re-checked at accept time: things may have changed since the
  // offer was sent.
  const booking = await prisma.booking.findUnique({ where: { id: fresh.bookingId } })
  if (!booking) throw new AppError(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
  const provider = await prisma.ambulanceProvider.findUnique({ where: { id: fresh.providerId } })
  if (!provider || !isProviderDispatchable(provider)) {
    throw new AppError(409, 'The provider is no longer accepting bookings.', { code: 'PROVIDER_NOT_DISPATCHABLE' })
  }
  const ambulance = await prisma.ambulance.findUnique({ where: { id: fresh.ambulanceId } })
  if (!ambulance || !isAmbulanceDispatchable(ambulance)) {
    throw new AppError(409, 'The assigned vehicle is no longer dispatchable.', { code: 'AMBULANCE_NOT_DISPATCHABLE' })
  }
  if (!isCrewDispatchable(profile) || profile.assignedAmbulanceId !== fresh.ambulanceId) {
    throw new AppError(409, 'You are no longer eligible to accept this booking.', { code: 'CREW_NOT_DISPATCHABLE' })
  }
  // Availability is re-checked too: a crew member who went offline after the
  // offer was sent must not be able to accept a live emergency.
  if (!AVAILABLE.includes(profile.availability)) {
    throw new AppError(409, 'You are currently offline and cannot accept this booking.', {
      code: 'CREW_OFFLINE',
      status: profile.availability ?? null
    })
  }

  const now = new Date()
  const updatedBooking = await prisma.$transaction(async (tx: any) => {
    // Only a still-PENDING offer flips, so a double-accept cannot win twice.
    const guard = await tx.dispatchOffer.updateMany({
      where: { id: offerId, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: now }
    })
    if (guard.count !== 1) {
      throw new AppError(409, 'This offer has already been handled.', { code: 'OFFER_ALREADY_HANDLED' })
    }

    const accepted = await applyBookingTransition(tx, actor, fresh.bookingId, {
      to: 'ACCEPTED',
      reason: 'Crew accepted dispatch offer',
      assignment: { acceptedById: profile.userId, assignedAmbulanceId: fresh.ambulanceId }
    })

    // Every other live offer for this booking is superseded.
    await tx.dispatchOffer.updateMany({
      where: { bookingId: fresh.bookingId, status: 'PENDING', id: { not: offerId } },
      data: { status: 'CANCELLED', respondedAt: now, rejectionReason: 'Another crew accepted the booking' }
    })

    return accepted
  })

  // Notify the requester only after the acceptance has committed.
  await notifyBookingStatusChange(updatedBooking, 'ACCEPTED')
  return updatedBooking
}

/** A crew declines their own live offer. The booking stays `OFFERED` for retry. */
export async function rejectOffer(actor: AuthUser, offerId: string, reason?: string) {
  const profile = await requireOwnCrewProfile(actor)

  const offer = await prisma.dispatchOffer.findUnique({ where: { id: offerId } })
  if (!offer || offer.crewProfileId !== profile.id) {
    throw new AppError(404, 'Dispatch offer not found.', { code: 'OFFER_NOT_FOUND' })
  }

  await expireStaleOffers()
  const guard = await prisma.dispatchOffer.updateMany({
    where: { id: offerId, status: 'PENDING' },
    data: { status: 'REJECTED', respondedAt: new Date(), rejectionReason: reason?.trim() || null }
  })
  if (guard.count !== 1) {
    throw new AppError(409, 'This dispatch offer is no longer actionable.', { code: 'OFFER_NOT_PENDING' })
  }
  return prisma.dispatchOffer.findUnique({ where: { id: offerId } })
}

// --- Manual assignment ------------------------------------------------------

/**
 * Human override: assign (or reassign) a specific crew + vehicle. A `REQUESTED`
 * booking is walked through `OFFERED` to `ACCEPTED` so the state machine is
 * always the only route; an already-accepted trip can be reassigned in place,
 * recording the change in the status trail.
 */
export async function manualAssign(
  actor: AuthUser,
  bookingId: string,
  input: { crewProfileId: string; ambulanceId?: string; reason?: string }
) {
  const booking = await loadBookingForUser(actor, bookingId)

  const crew = await prisma.crewProfile.findUnique({ where: { id: input.crewProfileId } })
  if (!crew) throw new AppError(404, 'Crew member not found.', { code: 'CREW_NOT_FOUND' })
  if (crew.providerId !== booking.providerId) {
    throw new AppError(400, 'That crew member does not belong to the booking provider.', {
      code: 'CREW_PROVIDER_MISMATCH'
    })
  }
  if (!isCrewDispatchable(crew)) {
    throw new AppError(409, 'Only a verified, active crew member assigned to a vehicle can be assigned.', {
      code: 'CREW_NOT_DISPATCHABLE'
    })
  }

  const ambulanceId = input.ambulanceId ?? crew.assignedAmbulanceId
  if (!ambulanceId) {
    throw new AppError(400, 'A vehicle is required to assign this booking.', {
      code: 'AMBULANCE_REQUIRED',
      field: 'ambulanceId'
    })
  }
  const ambulance = await prisma.ambulance.findUnique({ where: { id: ambulanceId } })
  if (!ambulance || ambulance.providerId !== booking.providerId) {
    throw new AppError(400, 'Unknown vehicle for this provider.', { code: 'VALIDATION_ERROR', field: 'ambulanceId' })
  }
  if (!isAmbulanceDispatchable(ambulance)) {
    throw new AppError(409, 'The selected vehicle is not dispatchable.', { code: 'AMBULANCE_NOT_DISPATCHABLE' })
  }

  const now = new Date()
  const assigned = await prisma.$transaction(async (tx: any) => {
    let current = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!current) throw new AppError(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })

    if (current.status === 'REQUESTED') {
      current = await applyBookingTransition(tx, actor, bookingId, { to: 'OFFERED', reason: 'Manual dispatch' })
    }

    let updated: Record<string, any>
    if (current.status === 'OFFERED') {
      updated = await applyBookingTransition(tx, actor, bookingId, {
        to: 'ACCEPTED',
        reason: input.reason?.trim() || 'Manually assigned by dispatcher',
        assignment: { acceptedById: crew.userId, assignedAmbulanceId: ambulanceId }
      })
    } else if (REASSIGNABLE_BOOKING_STATUSES.includes(current.status)) {
      const guard = await tx.booking.updateMany({
        where: { id: bookingId, status: current.status },
        data: { acceptedById: crew.userId, assignedAmbulanceId: ambulanceId, acceptedAt: now }
      })
      if (guard.count !== 1) {
        throw new AppError(409, 'The booking was updated by someone else. Please retry.', {
          code: 'CONCURRENT_MODIFICATION'
        })
      }
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: current.status,
          toStatus: current.status,
          actorId: actor.userId,
          actorRole: actor.role,
          reason: input.reason?.trim() || 'Booking reassigned by dispatcher'
        }
      })
      updated = await tx.booking.findUnique({ where: { id: bookingId } })
    } else {
      throw new AppError(409, 'This booking can no longer be assigned.', {
        code: 'BOOKING_NOT_ASSIGNABLE',
        status: current.status
      })
    }

    // The job is taken — withdraw any live offers.
    await tx.dispatchOffer.updateMany({
      where: { bookingId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: now, rejectionReason: 'Manually assigned by dispatcher' }
    })

    return updated
  })

  // A manual assignment is an acceptance from the requester's point of view.
  // The dedupe key makes a reassignment a no-op rather than a duplicate alert.
  if (assigned.status === 'ACCEPTED') await notifyBookingStatusChange(assigned, 'ACCEPTED')
  return assigned
}

// --- Reads ------------------------------------------------------------------

/** All offers for a booking (dispatcher view; scoped to the caller). */
export async function listBookingOffers(actor: AuthUser, bookingId: string) {
  const booking = await loadBookingForUser(actor, bookingId)
  await expireStaleOffers()
  return prisma.dispatchOffer.findMany({
    where: { bookingId: booking.id },
    orderBy: [{ round: 'asc' }, { offeredAt: 'desc' }]
  })
}

/** The caller's own live dispatch offers (crew view). */
export async function listMyOffers(actor: AuthUser) {
  const profile = await prisma.crewProfile.findUnique({ where: { userId: actor.userId } })
  if (!profile) return []
  await expireStaleOffers()
  return prisma.dispatchOffer.findMany({
    where: { crewProfileId: profile.id },
    orderBy: [{ offeredAt: 'desc' }]
  })
}

// --- Dispatcher operations (Stage 13) --------------------------------------

/** Bookings that still need attention (not terminal). */
const ACTIVE_BOOKING_STATUSES = [
  'REQUESTED',
  'OFFERED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'PATIENT_ON_BOARD',
  'AT_HOSPITAL'
] as const

/**
 * The dispatcher's operational booking list: incoming requests, dispatch status
 * and escalations, scoped to the caller's state/provider. The caller receives
 * summaries without patient identifiers or medical notes (see the serializer).
 */
export async function listDispatchBookings(actor: AuthUser, query: ListDispatchBookingsQuery = {}) {
  const where: Record<string, unknown> = { ...bookingScopeFilter(actor) }
  if (query.status) {
    where.status = query.status
  } else if (query.active !== 'false') {
    where.status = { in: [...ACTIVE_BOOKING_STATUSES] }
  }
  if (query.escalated === 'true') where.dispatchEscalatedAt = { not: null }
  else if (query.escalated === 'false') where.dispatchEscalatedAt = null

  return prisma.booking.findMany({
    where,
    orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
    take: query.limit ?? 100
  })
}

/** Provider ids visible to the caller for fleet reads. */
async function scopedProviderIds(actor: AuthUser, query: ListDispatchAmbulancesQuery): Promise<string[]> {
  const providerWhere: Record<string, unknown> = {}
  if (query.stateId) providerWhere.stateId = query.stateId
  if (query.providerId) providerWhere.id = query.providerId

  // The caller's own scope always wins: a query may narrow it, never widen it.
  if (actor.role === Role.STATE_ADMIN || actor.role === Role.DISPATCHER) {
    if (!actor.stateId) return []
    providerWhere.stateId = actor.stateId
  } else if (actor.role === Role.PROVIDER_ADMIN || actor.role === Role.CREW) {
    if (!actor.providerId) return []
    providerWhere.id = actor.providerId
  }

  const providers = await prisma.ambulanceProvider.findMany({ where: providerWhere })
  return providers.map((p: Record<string, any>) => p.id)
}

/**
 * Ambulances currently available to dispatch in the caller's scope, with their
 * provider and any assigned crew. Only verified, active vehicles of a
 * dispatchable provider are returned.
 */
export async function listAvailableAmbulances(actor: AuthUser, query: ListDispatchAmbulancesQuery = {}) {
  const providerIds = await scopedProviderIds(actor, query)
  if (providerIds.length === 0) return []

  const ambulances = await prisma.ambulance.findMany({
    where: {
      providerId: { in: providerIds },
      status: 'VERIFIED',
      isActive: true,
      availability: { in: ['AVAILABLE', 'ON_DUTY'] }
    },
    orderBy: { updatedAt: 'desc' },
    take: query.limit ?? 100
  })

  const results: Record<string, any>[] = []
  for (const ambulance of ambulances) {
    const provider = await prisma.ambulanceProvider.findUnique({ where: { id: ambulance.providerId } })
    if (!provider || !isProviderDispatchable(provider)) continue
    const crew = await prisma.crewProfile.findFirst({
      where: {
        assignedAmbulanceId: ambulance.id,
        status: 'ACTIVE',
        availability: { in: ['AVAILABLE', 'ON_DUTY'] }
      }
    })
    results.push({ ambulance, provider, crew })
  }
  return results
}

/**
 * Escalates a booking for manual assignment. Records why in the append-only
 * status trail and stamps `dispatchEscalatedAt` so the dispatcher queue surfaces
 * it. Escalation never changes the booking status.
 */
export async function escalateBooking(actor: AuthUser, bookingId: string, input: EscalateBookingInput = {}) {
  const booking = await loadBookingForUser(actor, bookingId)
  if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
    throw new AppError(409, `A ${booking.status} booking cannot be escalated.`, {
      code: 'BOOKING_NOT_ESCALATABLE',
      status: booking.status
    })
  }
  if (booking.dispatchEscalatedAt) {
    throw new AppError(409, 'This booking is already escalated.', { code: 'ALREADY_ESCALATED' })
  }

  const now = new Date()
  const reason = input.reason?.trim() || 'Escalated for manual assignment by dispatcher'
  return prisma.$transaction(async (tx: any) => {
    await tx.booking.update({ where: { id: booking.id }, data: { dispatchEscalatedAt: now } })
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        actorId: actor.userId,
        actorRole: actor.role,
        reason
      }
    })
    return tx.booking.findUnique({ where: { id: booking.id } })
  })
}

export interface ContactResolution {
  recipient: string
  channel: 'SMS' | 'EMAIL'
  recipientUserId: string | null
}

/** Resolves an approved contact destination for one of a booking's parties. */
async function resolveContactTarget(
  booking: Record<string, any>,
  recipient: ContactPartyInput['recipient']
): Promise<ContactResolution> {
  if (recipient === 'REQUESTER') {
    if (booking.callbackPhone) {
      return { recipient: booking.callbackPhone, channel: 'SMS', recipientUserId: booking.userId ?? null }
    }
    const owner = booking.userId ? await prisma.user.findUnique({ where: { id: booking.userId } }) : null
    if (owner?.email) return { recipient: owner.email, channel: 'EMAIL', recipientUserId: owner.id }
  } else if (recipient === 'CREW') {
    if (booking.acceptedById) {
      const crewUser = await prisma.user.findUnique({ where: { id: booking.acceptedById } })
      if (crewUser?.phone) return { recipient: crewUser.phone, channel: 'SMS', recipientUserId: crewUser.id }
      if (crewUser?.email) return { recipient: crewUser.email, channel: 'EMAIL', recipientUserId: crewUser.id }
    }
  } else if (recipient === 'HOSPITAL') {
    if (booking.destinationHospitalId) {
      const hospital = await prisma.hospital.findUnique({ where: { id: booking.destinationHospitalId } })
      if (hospital?.email) return { recipient: hospital.email, channel: 'EMAIL', recipientUserId: null }
      if (hospital?.phone) return { recipient: hospital.phone, channel: 'SMS', recipientUserId: null }
    }
  }
  throw new AppError(400, 'No approved contact is available for that party on this booking.', {
    code: 'CONTACT_UNAVAILABLE',
    field: 'recipient'
  })
}

/**
 * Contacts a relevant party through an approved template. Only a fixed recipient
 * and template are accepted — never free text — so the queued notification can
 * never carry PHI. Delivery is best-effort and never blocks the request.
 */
export async function contactParty(actor: AuthUser, bookingId: string, input: ContactPartyInput) {
  const booking = await loadBookingForUser(actor, bookingId)
  const target = await resolveContactTarget(booking, input.recipient)
  await notifyDispatcherContact({
    bookingId: booking.id,
    bookingReference: booking.reference,
    recipient: target.recipient,
    recipientUserId: target.recipientUserId,
    channel: target.channel,
    template: input.template
  })
  return { recipient: input.recipient, channel: target.channel, template: input.template, delivered: true }
}

/**
 * The dispatcher's consolidated booking + trip history view: the booking, the
 * append-only status trail, dispatch offers, recorded trip fixes and the current
 * tracking/ETA.
 */
export async function getDispatchBookingDetail(actor: AuthUser, bookingId: string, now: Date = new Date()) {
  const booking = await loadBookingForUser(actor, bookingId)
  await expireStaleOffers()
  const [history, offers, tripLocations, tracking] = await Promise.all([
    prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'asc' } }),
    prisma.dispatchOffer.findMany({ where: { bookingId: booking.id }, orderBy: [{ round: 'asc' }, { offeredAt: 'desc' }] }),
    prisma.tripLocation.findMany({
      where: { bookingId: booking.id },
      orderBy: { recordedAt: 'desc' },
      take: env.TRACKING_HISTORY_LIMIT
    }),
    getBookingTracking(actor, booking.id, now)
  ])
  return { booking, history, offers, tripLocations, tracking }
}
