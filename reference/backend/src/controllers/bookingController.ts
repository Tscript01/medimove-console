import type { RequestHandler } from 'express'
import { prisma } from '../utils/prisma'
import { currentUser } from '../auth/context'
import { bookingScopeFilter, loadBookingForUser } from '../utils/access'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { paginationMeta, parsePagination } from '../utils/pagination'
import { parseOrThrow } from '../middleware/validate'
import { toBooking, toBookingStatusHistory } from '../utils/serializers'
import {
  cancelBooking as cancelBookingService,
  createBooking as createBookingService,
  getBookingHistory,
  transitionBooking
} from '../services/bookingService'
import type {
  CancelBookingInput,
  CreateBookingInput,
  ListBookingsQuery,
  UpdateBookingStatusInput
} from '../validation/booking.schemas'
import { listBookingsQuerySchema } from '../validation/booking.schemas'

/**
 * Booking HTTP handlers. All business rules (fare, capacity, idempotency, the
 * state machine) live in `services/bookingService`; handlers only translate
 * HTTP to/from it.
 */

/** Preserve the provider relation on reads that requested it. */
function withProvider(booking: Record<string, any>) {
  return { ...toBooking(booking), ...(booking.provider ? { provider: booking.provider } : {}) }
}

// POST /api/bookings (Authenticated — requires booking:create)
export const createBooking: RequestHandler = async (req, res) => {
  const input = req.body as CreateBookingInput
  const { booking, reused } = await createBookingService(currentUser(req), input)

  if (!reused) {
    const actor = currentUser(req)
    await recordAudit({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'booking.create',
      resourceType: 'Booking',
      resourceId: booking.id,
      metadata: {
        providerId: booking.providerId,
        emergencyCategory: booking.emergencyCategory,
        isForSelf: booking.isForSelf,
        estimatedFare: booking.estimatedFare
      },
      ...requestMeta(req)
    })
  }

  res.status(reused ? 200 : 201).json({ success: true, reused, booking: toBooking(booking) })
}

// GET /api/bookings (Authenticated — scoped to the caller's role, paginated)
export const listBookings: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const query = parseOrThrow(listBookingsQuerySchema, req.query, 'query')
  const window = parsePagination(query)

  const where: Record<string, unknown> = { ...bookingScopeFilter(user) }
  if (query.status) where.status = query.status
  if (query.from || query.to) {
    where.requestedAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {})
    }
  }

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      include: { provider: { select: { id: true, name: true, vehicleType: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      skip: window.skip,
      take: window.take
    })
  ])

  res.json({
    success: true,
    bookings: bookings.map(withProvider),
    pagination: paginationMeta(total, window)
  })
}

// GET /api/bookings/:id (Authenticated — ownership/scope enforced)
export const getBooking: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const booking = await loadBookingForUser(user, String(req.params.id ?? ''))
  res.json({ success: true, booking: withProvider(booking) })
}

// GET /api/bookings/:id/history (Authenticated — scope enforced)
export const getBookingHistoryController: RequestHandler = async (req, res) => {
  const entries = await getBookingHistory(currentUser(req), String(req.params.id ?? ''))
  res.json({ success: true, history: entries.map(toBookingStatusHistory) })
}

// PATCH /api/bookings/:id/status (Authenticated — booking:update:status + scope)
export const updateBookingStatus: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as UpdateBookingStatusInput
  const booking = await transitionBooking(actor, String(req.params.id ?? ''), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'booking.status.update',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { to: input.status, reason: input.reason ?? null },
    ...requestMeta(req)
  })

  res.json({ success: true, booking: toBooking(booking) })
}

// POST /api/bookings/:id/cancel (Authenticated — requester or operator)
export const cancelBooking: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as CancelBookingInput
  const booking = await cancelBookingService(actor, String(req.params.id ?? ''), input?.reason)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'booking.cancel',
    resourceType: 'Booking',
    resourceId: booking.id,
    metadata: { reason: input?.reason ?? null },
    ...requestMeta(req)
  })

  res.json({ success: true, booking: toBooking(booking) })
}
