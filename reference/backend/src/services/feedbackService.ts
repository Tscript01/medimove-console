import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import type { AuthUser } from '../auth/permissions'
import { canAccessFeedback, feedbackScopeFilter, loadBookingForUser } from '../utils/access'
import type { CreateFeedbackInput, ListFeedbackQuery } from '../validation/feedback.schemas'

/**
 * Trip feedback (rating + comment).
 *
 * Ownership is enforced at every step: only the booking's requester may rate it,
 * only after the trip has ended, and at most once per trip. Reads are scoped so
 * a patient sees their own, a provider admin their provider's and a state
 * operator their state's.
 */

/** A trip must have ended before it can be rated. */
const RATABLE_STATUSES = ['COMPLETED', 'CANCELLED', 'FAILED']

export async function createFeedback(
  actor: AuthUser,
  bookingId: string,
  input: CreateFeedbackInput
): Promise<Record<string, any>> {
  // Reuses the booking scope rules; an out-of-scope booking is a 404, not a 403.
  const booking = await loadBookingForUser(actor, bookingId)

  // Even an operator who can *see* the booking may not rate it — only the
  // person who requested the trip can.
  if (booking.userId !== actor.userId) {
    throw new AppError(403, 'You can only rate a trip you requested.', { code: 'FORBIDDEN' })
  }
  if (!RATABLE_STATUSES.includes(booking.status)) {
    throw new AppError(409, 'A trip can only be rated after it has ended.', { code: 'TRIP_NOT_ENDED' })
  }

  const existing = await prisma.feedback.findFirst({
    where: { bookingId: booking.id, userId: actor.userId }
  })
  if (existing) {
    throw new AppError(409, 'You have already rated this trip.', { code: 'FEEDBACK_EXISTS' })
  }

  return prisma.feedback.create({
    data: {
      bookingId: booking.id,
      userId: actor.userId,
      providerId: booking.providerId ?? null,
      stateId: booking.stateId ?? null,
      rating: input.rating,
      comment: input.comment ?? null
    }
  })
}

/** Paginated feedback list, scoped to the caller. */
export async function listFeedback(
  actor: AuthUser,
  query: ListFeedbackQuery,
  window: { skip: number; take: number }
): Promise<{ items: Record<string, any>[]; total: number }> {
  const where: Record<string, unknown> = { ...feedbackScopeFilter(actor) }
  // Filters only ever narrow the caller's scope.
  if (query.rating != null) where.rating = query.rating
  if (query.bookingId) where.bookingId = query.bookingId

  const [total, items] = await Promise.all([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: window.skip,
      take: window.take
    })
  ])
  return { items, total }
}

/** Feedback left on one booking, filtered to what the caller may see. */
export async function getBookingFeedback(actor: AuthUser, bookingId: string): Promise<Record<string, any>[]> {
  const booking = await loadBookingForUser(actor, bookingId)
  const rows = await prisma.feedback.findMany({
    where: { bookingId: booking.id },
    orderBy: { createdAt: 'desc' }
  })
  return rows.filter((row: Record<string, any>) => canAccessFeedback(actor, row))
}
