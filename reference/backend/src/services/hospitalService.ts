import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { Role, type AuthUser } from '../auth/permissions'
import { recordAudit } from './auditService'
import { getBookingTracking } from './trackingService'
import type { RequestMeta } from '../utils/requestMeta'
import type {
  AuthorizeStaffInput,
  ListHospitalsQuery,
  ReplaceServicesInput,
  ReplaceSpecialtiesInput,
  UpdateCapacityInput,
  UpdateHospitalInput
} from '../validation/hospital.schemas'

/**
 * Hospital operations.
 *
 * A hospital user only ever acts on their *own* hospital: the hospital id is
 * resolved from the session (`actor.hospitalId`), never from request input, so a
 * hospital can never read or edit another hospital's profile, staff or alerts.
 *
 * Two rules are load-bearing:
 *  1. Capacity/intake is *self-reported*. Every value carries the time the
 *     hospital last maintained it; nothing here is presented as real-time.
 *  2. Inbound alerts share the minimum necessary information — a reference, the
 *     emergency category, a status and an ETA — never patient identifiers or
 *     medical detail.
 */

/** Statuses in which a patient is inbound to (or at) the destination hospital. */
export const INBOUND_BOOKING_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PATIENT_ON_BOARD', 'AT_HOSPITAL'] as const

/** Resolves the caller's hospital scope or fails closed. */
export function requireHospitalScope(actor: AuthUser): string {
  if (actor.role !== Role.HOSPITAL_STAFF) {
    throw new AppError(403, 'Only hospital staff can access hospital operations.', { code: 'FORBIDDEN' })
  }
  if (!actor.hospitalId) {
    throw new AppError(403, 'Your account is not linked to a hospital.', { code: 'HOSPITAL_SCOPE_REQUIRED' })
  }
  return actor.hospitalId
}

async function loadOwnHospital(actor: AuthUser): Promise<Record<string, any>> {
  const hospitalId = requireHospitalScope(actor)
  const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } })
  if (!hospital) throw new AppError(404, 'Hospital not found.', { code: 'HOSPITAL_NOT_FOUND' })
  return hospital
}

// --- Directory -------------------------------------------------------------

/**
 * The hospital directory. Reference data readable by any signed-in user (the
 * booking flow needs it to choose a destination). Never includes PHI.
 */
export async function listHospitals(query: ListHospitalsQuery = {}) {
  const where: Record<string, unknown> = { isActive: true }
  if (query.stateId) where.stateId = query.stateId
  if (query.city) where.city = query.city

  let hospitals = await prisma.hospital.findMany({
    where,
    orderBy: { name: 'asc' },
    take: query.limit ?? 200
  })

  // Free-text search is applied in memory: the directory is small reference data
  // and this keeps the query portable across the real and mock clients.
  if (query.q) {
    const needle = query.q.toLowerCase()
    hospitals = hospitals.filter((h: Record<string, any>) =>
      [h.name, h.city, h.category].some((value) => String(value ?? '').toLowerCase().includes(needle))
    )
  }
  return hospitals
}

/** A single hospital profile (directory read). */
export async function getHospital(id: string) {
  const hospital = await prisma.hospital.findUnique({ where: { id } })
  if (!hospital) throw new AppError(404, 'Hospital not found.', { code: 'HOSPITAL_NOT_FOUND' })
  return hospital
}

// --- Own profile -----------------------------------------------------------

/** The caller's own hospital with its maintained specialties/services/capacity. */
export async function getOwnHospital(actor: AuthUser) {
  const hospital = await loadOwnHospital(actor)
  const [specialties, services, capacity] = await Promise.all([
    prisma.hospitalSpecialty.findMany({ where: { hospitalId: hospital.id }, orderBy: { name: 'asc' } }),
    prisma.hospitalService.findMany({ where: { hospitalId: hospital.id }, orderBy: { service: 'asc' } }),
    prisma.hospitalCapacity.findUnique({ where: { hospitalId: hospital.id } })
  ])
  return { ...hospital, specialties, services, capacity }
}

/** Updates the caller's hospital profile/location. */
export async function updateOwnHospital(actor: AuthUser, input: UpdateHospitalInput) {
  const hospital = await loadOwnHospital(actor)
  const data: Record<string, unknown> = {}
  for (const field of ['phone', 'email', 'address', 'landmark', 'lat', 'lng', 'acceptsEmergencies'] as const) {
    if (input[field] !== undefined) data[field] = input[field]
  }
  return prisma.hospital.update({ where: { id: hospital.id }, data })
}

// --- Specialties -----------------------------------------------------------

/** Replaces the caller's specialty list wholesale (idempotent). */
export async function replaceSpecialties(actor: AuthUser, input: ReplaceSpecialtiesInput) {
  const hospital = await loadOwnHospital(actor)
  // De-duplicate by name (case-insensitively) so the unique constraint is never
  // violated and a repeated name cannot appear twice.
  const seen = new Set<string>()
  const rows = input.specialties
    .filter((item) => {
      const key = item.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((item) => ({
      hospitalId: hospital.id,
      name: item.name,
      notes: item.notes ?? null,
      isActive: item.isActive ?? true
    }))

  await prisma.$transaction(async (tx: any) => {
    await tx.hospitalSpecialty.deleteMany({ where: { hospitalId: hospital.id } })
    if (rows.length > 0) await tx.hospitalSpecialty.createMany({ data: rows })
  })

  return prisma.hospitalSpecialty.findMany({ where: { hospitalId: hospital.id }, orderBy: { name: 'asc' } })
}

// --- Service availability --------------------------------------------------

/** Replaces the caller's service-availability list wholesale (idempotent). */
export async function replaceServices(actor: AuthUser, input: ReplaceServicesInput) {
  const hospital = await loadOwnHospital(actor)
  const seen = new Set<string>()
  const rows = input.services
    .filter((item) => {
      const key = item.service.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((item) => ({
      hospitalId: hospital.id,
      service: item.service,
      status: item.status ?? 'AVAILABLE',
      notes: item.notes ?? null
    }))

  await prisma.$transaction(async (tx: any) => {
    await tx.hospitalService.deleteMany({ where: { hospitalId: hospital.id } })
    if (rows.length > 0) await tx.hospitalService.createMany({ data: rows })
  })

  return prisma.hospitalService.findMany({ where: { hospitalId: hospital.id }, orderBy: { service: 'asc' } })
}

// --- Capacity / intake (self-reported) -------------------------------------

/** The caller's maintained capacity/intake, or null when never maintained. */
export async function getOwnCapacity(actor: AuthUser) {
  const hospital = await loadOwnHospital(actor)
  return prisma.hospitalCapacity.findUnique({ where: { hospitalId: hospital.id } })
}

/** Creates/updates the caller's capacity/intake. Stamps who and when. */
export async function updateOwnCapacity(actor: AuthUser, input: UpdateCapacityInput) {
  const hospital = await loadOwnHospital(actor)
  // `updatedAt` is stamped explicitly (as well as by `@updatedAt`) so the
  // "maintained at" freshness signal is always present and deterministic.
  const data: Record<string, unknown> = { updatedById: actor.userId, updatedAt: new Date() }
  for (const field of ['intakeStatus', 'emergencyBedsAvailable', 'icuBedsAvailable', 'notes'] as const) {
    if (input[field] !== undefined) data[field] = input[field]
  }
  return prisma.hospitalCapacity.upsert({
    where: { hospitalId: hospital.id },
    update: data,
    create: { hospitalId: hospital.id, ...data }
  })
}

// --- Authorized staff accounts ---------------------------------------------

/** Authorized staff accounts at the caller's hospital. */
export async function listOwnStaff(actor: AuthUser) {
  const hospitalId = requireHospitalScope(actor)
  return prisma.user.findMany({
    where: { hospitalId, role: Role.HOSPITAL_STAFF },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * Authorizes an existing user as staff at the caller's hospital. Bounded: only
 * the HOSPITAL_STAFF role can be granted, only within the caller's own hospital,
 * and a platform administrator can never be demoted. The change and its audit
 * record commit atomically.
 */
export async function authorizeStaff(actor: AuthUser, input: AuthorizeStaffInput, meta: RequestMeta) {
  const hospitalId = requireHospitalScope(actor)
  const target = await prisma.user.findUnique({ where: { email: input.email } })
  if (!target) throw new AppError(404, 'No user with that email address.', { code: 'USER_NOT_FOUND' })
  if (target.role === Role.PLATFORM_ADMIN) {
    throw new AppError(400, 'A platform administrator cannot be assigned as hospital staff.', {
      code: 'FORBIDDEN_ROLE_CHANGE'
    })
  }
  if (target.hospitalId === hospitalId && target.role === Role.HOSPITAL_STAFF) {
    return target
  }

  return prisma.$transaction(async (tx: any) => {
    const updated = await tx.user.update({
      where: { id: target.id },
      data: { role: Role.HOSPITAL_STAFF, hospitalId, stateId: null, providerId: null }
    })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'hospital.staff.authorize',
        resourceType: 'User',
        resourceId: target.id,
        metadata: { hospitalId, from: target.role ?? null, to: Role.HOSPITAL_STAFF },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      },
      tx,
      true
    )
    return updated
  })
}

/**
 * Revokes a staff account from the caller's hospital (the user reverts to
 * PATIENT). A staff member cannot revoke themselves. The change and its audit
 * record commit atomically.
 */
export async function revokeStaff(actor: AuthUser, userId: string, meta: RequestMeta) {
  const hospitalId = requireHospitalScope(actor)
  if (userId === actor.userId) {
    throw new AppError(400, 'You cannot revoke your own staff access.', { code: 'SELF_REVOKE' })
  }
  const target = await prisma.user.findUnique({ where: { id: userId } })
  if (!target || target.hospitalId !== hospitalId || target.role !== Role.HOSPITAL_STAFF) {
    throw new AppError(404, 'Staff account not found.', { code: 'STAFF_NOT_FOUND' })
  }

  return prisma.$transaction(async (tx: any) => {
    const updated = await tx.user.update({
      where: { id: target.id },
      data: { role: Role.PATIENT, hospitalId: null }
    })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'hospital.staff.revoke',
        resourceType: 'User',
        resourceId: target.id,
        metadata: { hospitalId },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      },
      tx,
      true
    )
    return updated
  })
}

// --- Incoming patient alerts -----------------------------------------------

/**
 * Bookings inbound to the caller's hospital, with the latest ETA. Shares only
 * the minimum necessary information: a reference, category, status and ETA.
 */
export async function listIncomingPatients(actor: AuthUser, now: Date = new Date()) {
  const hospitalId = requireHospitalScope(actor)
  const bookings = await prisma.booking.findMany({
    where: { destinationHospitalId: hospitalId, status: { in: [...INBOUND_BOOKING_STATUSES] } },
    orderBy: { requestedAt: 'asc' },
    take: 100
  })

  const incoming: Record<string, any>[] = []
  for (const booking of bookings) {
    let distanceRemainingKm: number | null = null
    let etaMinutes: number | null = null
    let etaAt: string | null = null
    try {
      const tracking = await getBookingTracking(actor, booking.id, now)
      distanceRemainingKm = tracking.distanceRemainingKm
      etaMinutes = tracking.etaMinutes
      etaAt = tracking.etaAt
    } catch {
      // Tracking is best-effort; an alert is still useful without an ETA.
    }
    incoming.push({
      bookingId: booking.id,
      reference: booking.reference,
      emergencyCategory: booking.emergencyCategory ?? null,
      status: booking.status,
      isInbound: true,
      requestedAt: booking.requestedAt ?? booking.createdAt ?? null,
      acceptedAt: booking.acceptedAt ?? null,
      atHospitalAt: booking.atHospitalAt ?? null,
      distanceRemainingKm,
      etaMinutes,
      etaAt
    })
  }
  return incoming
}
