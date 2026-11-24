import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { Role, type AuthUser } from '../auth/permissions'
import { recordAudit } from './auditService'
import { bookingScopeFilter } from '../utils/access'
import type { RequestMeta } from '../utils/requestMeta'
import type {
  AdminCreateHospitalInput,
  AdminListBookingsQuery,
  AdminListHospitalsQuery,
  AdminUpdateHospitalInput,
  ReportQuery
} from '../validation/admin.schemas'

/**
 * Platform administration.
 *
 * Every administrative write commits its change and its **immutable audit
 * record atomically** (a missing audit entry aborts the change), so there is no
 * way to mutate an important resource without leaving a trail. Reads never
 * touch PHI beyond what the caller's role already permits, and nothing here ever
 * records a password, OTP, token or unnecessary health detail.
 *
 * Scope is always taken from the session: a state administrator can only ever
 * act on records inside their own state; a platform administrator acts
 * platform-wide. Out-of-scope targets surface as 404 so existence is not leaked.
 */

// --- Scope guards -----------------------------------------------------------

/** True when the actor may administer the given user's account. */
function assertUserAdminScope(actor: AuthUser, target: { stateId?: string | null }): void {
  if (actor.role === Role.PLATFORM_ADMIN) return
  if (actor.role === Role.STATE_ADMIN) {
    if (!actor.stateId || target.stateId !== actor.stateId) {
      throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })
    }
    return
  }
  throw new AppError(403, 'You do not have permission to manage users.', { code: 'FORBIDDEN' })
}

/** True when the actor may administer the given hospital. */
function assertHospitalAdminScope(actor: AuthUser, hospital: { stateId?: string | null }): void {
  if (actor.role === Role.PLATFORM_ADMIN) return
  if (actor.role === Role.STATE_ADMIN) {
    if (!actor.stateId || hospital.stateId !== actor.stateId) {
      throw new AppError(404, 'Hospital not found.', { code: 'HOSPITAL_NOT_FOUND' })
    }
    return
  }
  throw new AppError(403, 'You do not have permission to manage hospitals.', { code: 'FORBIDDEN' })
}

/** The state a write must be confined to, or `null` for platform-wide. */
function writeStateScope(actor: AuthUser, requested?: string | null): string | null {
  if (actor.role === Role.STATE_ADMIN) {
    if (!actor.stateId) throw new AppError(403, 'Your account is not linked to a state.', { code: 'SCOPE_REQUIRED' })
    return actor.stateId
  }
  return requested ?? null
}

// --- User administration ----------------------------------------------------

/** Loads a user for administrative read, enforcing scope (out of scope -> 404). */
export async function getUserForAdmin(actor: AuthUser, id: string) {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })
  assertUserAdminScope(actor, user)
  return user
}

/**
 * Suspends an account. Suspension is immediate: the flag is set **and** every
 * active session is revoked in the same transaction, so an issued access token
 * stops working on the next request. A platform administrator can never be
 * suspended, and nobody can suspend themselves.
 */
export async function suspendUser(actor: AuthUser, targetId: string, reason: string | undefined, meta: RequestMeta) {
  if (targetId === actor.userId) {
    throw new AppError(400, 'You cannot suspend your own account.', { code: 'SELF_SUSPEND' })
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })
  assertUserAdminScope(actor, target)

  if (target.role === Role.PLATFORM_ADMIN) {
    throw new AppError(403, 'A platform administrator cannot be suspended.', { code: 'PROTECTED_ACCOUNT' })
  }
  if (target.isActive === false) {
    throw new AppError(409, 'This account is already suspended.', { code: 'ALREADY_SUSPENDED' })
  }

  const now = new Date()
  return prisma.$transaction(async (tx: any) => {
    const user = await tx.user.update({
      where: { id: targetId },
      data: { isActive: false, suspendedAt: now, suspensionReason: reason ?? null }
    })
    await tx.session.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'ACCOUNT_SUSPENDED' }
    })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'user.suspend',
        resourceType: 'User',
        resourceId: targetId,
        metadata: { reason: reason ?? null, role: target.role ?? null, stateId: target.stateId ?? null },
        ...meta
      },
      tx,
      true
    )
    return user
  })
}

/** Re-activates a previously suspended account. */
export async function activateUser(actor: AuthUser, targetId: string, meta: RequestMeta) {
  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })
  assertUserAdminScope(actor, target)

  if (target.isActive !== false) {
    throw new AppError(409, 'This account is already active.', { code: 'ALREADY_ACTIVE' })
  }

  return prisma.$transaction(async (tx: any) => {
    const user = await tx.user.update({
      where: { id: targetId },
      data: { isActive: true, suspendedAt: null, suspensionReason: null }
    })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'user.activate',
        resourceType: 'User',
        resourceId: targetId,
        metadata: { role: target.role ?? null, stateId: target.stateId ?? null },
        ...meta
      },
      tx,
      true
    )
    return user
  })
}

// --- Hospital administration ------------------------------------------------

/** Paginated hospital list for administrators, including inactive records. */
export async function listAdminHospitals(actor: AuthUser, query: AdminListHospitalsQuery, window: { skip: number; take: number }) {
  const where: Record<string, unknown> = {}
  if (actor.role === Role.STATE_ADMIN) {
    if (!actor.stateId) return { items: [], total: 0 }
    where.stateId = actor.stateId
  } else if (query.stateId) {
    where.stateId = query.stateId
  }
  if (query.city) where.city = query.city
  if (!query.includeInactive) where.isActive = true

  // Free-text search is applied in memory: the hospital directory is small
  // reference data and this keeps the query portable across real and mock clients.
  let rows = await prisma.hospital.findMany({ where, orderBy: { name: 'asc' } })
  if (query.q) {
    const needle = query.q.toLowerCase()
    rows = rows.filter((h: Record<string, any>) =>
      [h.name, h.city, h.category].some((value) => String(value ?? '').toLowerCase().includes(needle))
    )
  }

  const total = rows.length
  const items = rows.slice(window.skip, window.skip + window.take)
  return { items, total }
}

/** Loads a hospital for administrative read, enforcing scope. */
export async function getAdminHospital(actor: AuthUser, id: string) {
  const hospital = await prisma.hospital.findUnique({ where: { id } })
  if (!hospital) throw new AppError(404, 'Hospital not found.', { code: 'HOSPITAL_NOT_FOUND' })
  assertHospitalAdminScope(actor, hospital)
  return hospital
}

/** Creates a hospital record (reference data). State admins are state-confined. */
export async function createHospital(actor: AuthUser, input: AdminCreateHospitalInput, meta: RequestMeta) {
  const stateId = writeStateScope(actor, input.stateId)
  if (!stateId) throw new AppError(400, 'A stateId is required.', { code: 'SCOPE_REQUIRED', field: 'stateId' })
  if (actor.role === Role.STATE_ADMIN && input.stateId !== actor.stateId) {
    throw new AppError(403, 'You can only create hospitals in your own state.', { code: 'FORBIDDEN' })
  }

  const state = await prisma.state.findUnique({ where: { id: stateId } })
  if (!state) throw new AppError(400, 'Unknown stateId.', { code: 'SCOPE_INVALID', field: 'stateId' })

  const existing = await prisma.hospital.findUnique({ where: { id: input.id } })
  if (existing) throw new AppError(409, 'A hospital with this id already exists.', { code: 'HOSPITAL_EXISTS' })

  return prisma.$transaction(async (tx: any) => {
    const hospital = await tx.hospital.create({
      data: {
        id: input.id,
        name: input.name,
        city: input.city,
        stateId,
        category: input.category,
        lat: input.lat,
        lng: input.lng,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        landmark: input.landmark ?? null,
        acceptsEmergencies: input.acceptsEmergencies ?? true,
        isActive: input.isActive ?? true
      }
    })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'hospital.create',
        resourceType: 'Hospital',
        resourceId: hospital.id,
        metadata: { stateId, name: hospital.name },
        ...meta
      },
      tx,
      true
    )
    return hospital
  })
}

/** Updates a hospital's administrative/profile fields (scope enforced). */
export async function updateHospital(actor: AuthUser, id: string, input: AdminUpdateHospitalInput, meta: RequestMeta) {
  const hospital = await getAdminHospital(actor, id)

  const data: Record<string, unknown> = {}
  for (const field of [
    'name',
    'city',
    'category',
    'lat',
    'lng',
    'phone',
    'email',
    'address',
    'landmark',
    'acceptsEmergencies'
  ] as const) {
    if (input[field] !== undefined) data[field] = input[field]
  }

  return prisma.$transaction(async (tx: any) => {
    const updated = await tx.hospital.update({ where: { id: hospital.id }, data })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'hospital.update',
        resourceType: 'Hospital',
        resourceId: id,
        metadata: { fields: Object.keys(data) },
        ...meta
      },
      tx,
      true
    )
    return updated
  })
}

/** Activates or suspends a hospital (scope enforced). */
export async function setHospitalStatus(
  actor: AuthUser,
  id: string,
  active: boolean,
  reason: string | undefined,
  meta: RequestMeta
) {
  const hospital = await getAdminHospital(actor, id)

  if (active && hospital.isActive !== false) {
    throw new AppError(409, 'This hospital is already active.', { code: 'ALREADY_ACTIVE' })
  }
  if (!active && hospital.isActive === false) {
    throw new AppError(409, 'This hospital is already suspended.', { code: 'ALREADY_SUSPENDED' })
  }

  const now = new Date()
  const data = active
    ? { isActive: true, suspendedAt: null, suspensionReason: null }
    : { isActive: false, suspendedAt: now, suspensionReason: reason ?? null }

  return prisma.$transaction(async (tx: any) => {
    const updated = await tx.hospital.update({ where: { id: hospital.id }, data })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: active ? 'hospital.activate' : 'hospital.suspend',
        resourceType: 'Hospital',
        resourceId: id,
        metadata: { reason: reason ?? null, stateId: hospital.stateId ?? null },
        ...meta
      },
      tx,
      true
    )
    return updated
  })
}

// --- Booking oversight ------------------------------------------------------

/**
 * Administrative booking oversight. The caller's booking scope is applied first
 * (so a state admin only ever sees their state), then the request filters only
 * *narrow* the result.
 */
export async function listAdminBookings(
  actor: AuthUser,
  query: AdminListBookingsQuery,
  window: { skip: number; take: number }
) {
  const where: Record<string, unknown> = { ...bookingScopeFilter(actor) }
  if (actor.role === Role.PLATFORM_ADMIN && query.stateId) where.stateId = query.stateId
  if (query.status) where.status = query.status
  if (query.providerId) where.providerId = query.providerId
  if (query.userId) where.userId = query.userId
  if (query.from || query.to) {
    where.requestedAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {})
    }
  }

  const [total, items] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      include: { provider: { select: { id: true, name: true, vehicleType: true } } },
      orderBy: { createdAt: 'desc' },
      skip: window.skip,
      take: window.take
    })
  ])
  return { items, total }
}

// --- Operational reports ----------------------------------------------------

function countBy(rows: Record<string, any>[], field: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const key = String(row[field] ?? 'UNKNOWN')
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

/**
 * A platform-wide (or state-scoped) operational snapshot. All figures are
 * aggregate counts and sums — never an individual's data — and the report is
 * read-only, so it is not itself audited.
 */
export async function getOperationalReport(actor: AuthUser, query: ReportQuery) {
  const stateScope = actor.role === Role.STATE_ADMIN ? actor.stateId : query.stateId ?? null
  const scoped = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
    stateScope ? { stateId: stateScope, ...extra } : { ...extra }

  const dateRange: Record<string, Date> = {}
  if (query.from) dateRange.gte = query.from
  if (query.to) dateRange.lte = query.to
  const hasRange = Object.keys(dateRange).length > 0

  const bookingWhere: Record<string, unknown> = scoped()
  if (hasRange) bookingWhere.requestedAt = dateRange

  // Bookings in scope — also used to scope payments and crew to the same slice.
  const bookings = await prisma.booking.findMany({ where: bookingWhere, select: { id: true, status: true } })
  const bookingIds = bookings.map((b: Record<string, any>) => b.id)

  const providerWhere = scoped()
  const [providers, crewProfiles, hospitals, users, serviceAreas, complaints, feedback] = await Promise.all([
    prisma.ambulanceProvider.findMany({ where: providerWhere, select: { status: true, verificationStatus: true } }),
    prisma.crewProfile.findMany({ select: { providerId: true, verificationStatus: true } }),
    prisma.hospital.findMany({ where: scoped(), select: { isActive: true } }),
    prisma.user.findMany({ where: scoped(), select: { role: true } }),
    prisma.serviceArea.findMany({ where: scoped(), select: { id: true } }),
    prisma.complaint.findMany({ where: scoped(), select: { status: true } }),
    prisma.feedback.findMany({ where: scoped(), select: { rating: true } })
  ])

  // Crew belong to a provider, not a state, so scope them via the state's providers.
  let scopedCrew = crewProfiles
  if (stateScope) {
    const providerIds = await prisma.ambulanceProvider.findMany({
      where: { stateId: stateScope },
      select: { id: true }
    })
    const ids = new Set(providerIds.map((p: Record<string, any>) => p.id))
    scopedCrew = crewProfiles.filter((c: Record<string, any>) => ids.has(c.providerId))
  }

  // Payments are scoped through their booking.
  const paymentWhere: Record<string, unknown> = {}
  if (stateScope) {
    paymentWhere.bookingId = { in: bookingIds.length ? bookingIds : ['__none__'] }
  }
  if (hasRange) paymentWhere.createdAt = dateRange
  const payments = await prisma.payment.findMany({
    where: paymentWhere,
    select: { status: true, amountKobo: true, method: true }
  })

  const successfulPayments = payments.filter((p: Record<string, any>) => p.status === 'SUCCESSFUL')
  const successfulAmountKobo = successfulPayments.reduce(
    (sum: number, p: Record<string, any>) => sum + Number(p.amountKobo ?? 0),
    0
  )
  const ratings = feedback.map((f: Record<string, any>) => Number(f.rating ?? 0)).filter((n: number) => n > 0)
  const averageRating = ratings.length ? Number((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(2)) : null

  return {
    generatedAt: new Date().toISOString(),
    scope: { role: actor.role, stateId: stateScope },
    range: { from: query.from ?? null, to: query.to ?? null },
    bookings: { total: bookings.length, byStatus: countBy(bookings, 'status') },
    payments: {
      total: payments.length,
      successfulCount: successfulPayments.length,
      successfulAmountKobo,
      byStatus: countBy(payments, 'status'),
      byMethod: countBy(payments, 'method')
    },
    providers: {
      total: providers.length,
      byStatus: countBy(providers, 'status'),
      byVerificationStatus: countBy(providers, 'verificationStatus')
    },
    crew: {
      total: scopedCrew.length,
      verified: scopedCrew.filter((c: Record<string, any>) => c.verificationStatus === 'VERIFIED').length
    },
    hospitals: {
      total: hospitals.length,
      active: hospitals.filter((h: Record<string, any>) => h.isActive !== false).length
    },
    users: { total: users.length, byRole: countBy(users, 'role') },
    complaints: { total: complaints.length, byStatus: countBy(complaints, 'status') },
    feedback: { total: feedback.length, averageRating },
    serviceAreas: { total: serviceAreas.length }
  }
}
