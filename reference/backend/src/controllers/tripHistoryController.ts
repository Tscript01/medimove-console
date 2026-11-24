import type { RequestHandler } from 'express'
import { prisma } from '../utils/prisma'
import { currentUser } from '../auth/context'
import { Role } from '../auth/permissions'
import { parseOrThrow } from '../middleware/validate'
import { paginationMeta, parsePagination } from '../utils/pagination'
import {
  bookingScopeFilter,
  canAccessComplaint,
  canAccessFeedback,
  complaintScopeFilter,
  feedbackScopeFilter,
  loadBookingForUser
} from '../utils/access'
import {
  toBooking,
  toBookingStatusHistory,
  toComplaint,
  toFeedback,
  toPayment
} from '../utils/serializers'
import { listBookingsQuerySchema } from '../validation/booking.schemas'

/**
 * Patient-facing trip history: a consolidated view that ties a booking to its
 * event trail, payment/receipt, rating and any complaints.
 *
 * Every read goes through the shared booking scope rules (`bookingScopeFilter` /
 * `loadBookingForUser`), and the attached payment/feedback/complaint rows are
 * filtered to the caller's own scope — so a trip history can never surface
 * another person's records.
 */

/** The caller's most recent *successful* payment per booking, keyed by booking id. */
async function paymentsByBooking(actorId: string, bookingIds: string[]) {
  const map = new Map<string, Record<string, any>>()
  if (bookingIds.length === 0) return map
  const payments = await prisma.payment.findMany({
    where: { bookingId: { in: bookingIds }, userId: actorId, status: 'SUCCESSFUL' },
    orderBy: { createdAt: 'desc' }
  })
  for (const payment of payments) {
    if (payment.bookingId && !map.has(payment.bookingId)) map.set(payment.bookingId, payment)
  }
  return map
}

/** Feedback/complaint counts keyed by booking id, already filtered to scope. */
async function feedbackByBooking(actor: Parameters<typeof feedbackScopeFilter>[0], bookingIds: string[]) {
  const map = new Map<string, Record<string, any>>()
  if (bookingIds.length === 0) return map
  const rows = await prisma.feedback.findMany({
    where: { ...feedbackScopeFilter(actor), bookingId: { in: bookingIds } },
    orderBy: { createdAt: 'desc' }
  })
  for (const row of rows) {
    if (row.bookingId && !map.has(row.bookingId)) map.set(row.bookingId, row)
  }
  return map
}

async function complaintCountsByBooking(actor: Parameters<typeof complaintScopeFilter>[0], bookingIds: string[]) {
  const map = new Map<string, number>()
  if (bookingIds.length === 0) return map
  const rows = await prisma.complaint.findMany({
    where: { ...complaintScopeFilter(actor), bookingId: { in: bookingIds } }
  })
  for (const row of rows) {
    if (row.bookingId) map.set(row.bookingId, (map.get(row.bookingId) ?? 0) + 1)
  }
  return map
}

// GET /api/trips/history (scoped, paginated)
export const listTripHistoryController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const query = parseOrThrow(listBookingsQuerySchema, req.query, 'query')
  const window = parsePagination(query)

  const where: Record<string, unknown> = { ...bookingScopeFilter(actor) }
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
      orderBy: { requestedAt: 'desc' },
      skip: window.skip,
      take: window.take
    })
  ])

  const ids = bookings.map((b: Record<string, any>) => b.id)
  const [payments, feedback, complaints] = await Promise.all([
    paymentsByBooking(actor.userId, ids),
    feedbackByBooking(actor, ids),
    complaintCountsByBooking(actor, ids)
  ])

  const trips = bookings.map((booking: Record<string, any>) => {
    const payment = payments.get(booking.id) ?? null
    const rating = feedback.get(booking.id) ?? null
    return {
      ...toBooking(booking),
      payment: payment ? toPayment(payment) : null,
      receiptNumber: payment?.receiptNumber ?? null,
      receiptIssuedAt: payment?.receiptIssuedAt ?? null,
      feedback: rating ? toFeedback(rating) : null,
      complaintCount: complaints.get(booking.id) ?? 0
    }
  })

  res.json({ success: true, trips, pagination: paginationMeta(total, window) })
}

// GET /api/trips/:id (scope enforced) — consolidated trip detail
export const getTripDetailController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const booking = await loadBookingForUser(actor, String(req.params.id ?? ''))

  const [history, allPayments, feedbackRows, complaintRows] = await Promise.all([
    prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'asc' } }),
    prisma.payment.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } }),
    prisma.feedback.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } }),
    prisma.complaint.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } })
  ])

  // Only surface payment rows the caller may see (the payer, or a platform admin).
  const payments = allPayments.filter(
    (payment: Record<string, any>) => actor.role === Role.PLATFORM_ADMIN || payment.userId === actor.userId
  )
  const latestPaid = payments.find((payment: Record<string, any>) => payment.status === 'SUCCESSFUL') ?? null

  const feedback = feedbackRows.filter((row: Record<string, any>) => canAccessFeedback(actor, row))
  const complaints = complaintRows.filter((row: Record<string, any>) => canAccessComplaint(actor, row))

  res.json({
    success: true,
    trip: {
      ...toBooking(booking),
      statusHistory: history.map(toBookingStatusHistory),
      payment: latestPaid ? toPayment(latestPaid) : null,
      payments: payments.map(toPayment),
      receipt: latestPaid?.receiptNumber
        ? { receiptNumber: latestPaid.receiptNumber, issuedAt: latestPaid.receiptIssuedAt ?? null }
        : null,
      feedback: feedback.map(toFeedback),
      complaints: complaints.map(toComplaint)
    }
  })
}
