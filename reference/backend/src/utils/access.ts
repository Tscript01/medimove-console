import { prisma } from './prisma'
import { AppError } from '../errors/AppError'
import { Role, type AuthUser } from '../auth/permissions'

/**
 * Resource-scoping helpers.
 *
 * Every read of a patient-owned or organisation-owned record MUST go through
 * these helpers. They translate a caller's role into a data scope so that a
 * patient can never reach another patient's records by changing an id, and an
 * operator can never reach outside the state / provider / hospital they belong
 * to.
 */

/** A `where` fragment that matches nothing (used when a scope is missing). */
const NOTHING = { id: { in: [] as string[] } }

/**
 * Prisma `where` fragment that restricts `Booking` rows to those the caller may
 * list. Used by collection endpoints; single-record reads use
 * `canAccessBooking` instead.
 */
export function bookingScopeFilter(user: AuthUser): Record<string, unknown> {
  switch (user.role) {
    case Role.PLATFORM_ADMIN:
      return {}
    case Role.STATE_ADMIN:
    case Role.DISPATCHER:
      return user.stateId ? { stateId: user.stateId } : NOTHING
    case Role.PROVIDER_ADMIN:
    case Role.CREW:
      return user.providerId ? { providerId: user.providerId } : NOTHING
    case Role.HOSPITAL_STAFF:
      return user.hospitalId ? { destinationHospitalId: user.hospitalId } : NOTHING
    case Role.PATIENT:
    default:
      return { userId: user.userId }
  }
}

/** True when `user` is allowed to see the given booking record. */
export function canAccessBooking(user: AuthUser, booking: { userId?: string | null; stateId?: string | null; providerId?: string | null; destinationHospitalId?: string | null }): boolean {
  switch (user.role) {
    case Role.PLATFORM_ADMIN:
      return true
    case Role.STATE_ADMIN:
    case Role.DISPATCHER:
      return Boolean(user.stateId) && booking.stateId === user.stateId
    case Role.PROVIDER_ADMIN:
    case Role.CREW:
      return Boolean(user.providerId) && booking.providerId === user.providerId
    case Role.HOSPITAL_STAFF:
      return Boolean(user.hospitalId) && booking.destinationHospitalId === user.hospitalId
    case Role.PATIENT:
    default:
      return booking.userId === user.userId
  }
}

/**
 * Loads a booking and asserts the caller may see it. A booking that exists but
 * is out of scope is reported as 404 (not 403) so its existence is never leaked.
 */
export async function loadBookingForUser(user: AuthUser, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { provider: true }
  })
  if (!booking || !canAccessBooking(user, booking)) {
    throw new AppError(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
  }
  return booking
}

/** Throws 404 unless the caller owns the payment (directly or via its booking). */
export function assertPaymentAccess(
  user: AuthUser,
  payment: { userId?: string | null; booking?: { userId?: string | null } | null }
): void {
  if (user.role === Role.PLATFORM_ADMIN) return
  const ownerId = payment.userId ?? payment.booking?.userId ?? null
  if (ownerId && ownerId === user.userId) return
  throw new AppError(404, 'Payment not found.', { code: 'PAYMENT_NOT_FOUND' })
}

/** Loads a savings goal and asserts the caller owns it (platform admin excepted). */
export async function loadSavingsGoalForUser(user: AuthUser, goalId: string) {
  const goal = await prisma.savingsGoal.findUnique({ where: { id: goalId } })
  if (!goal || (user.role !== Role.PLATFORM_ADMIN && goal.userId !== user.userId)) {
    throw new AppError(404, 'Savings goal not found.', { code: 'SAVINGS_GOAL_NOT_FOUND' })
  }
  return goal
}

// --- Feedback & complaints (Stage 14) --------------------------------------

/**
 * Prisma `where` fragment that restricts `Feedback` rows to those the caller may
 * list. The author sees their own; a provider admin sees their provider's; a
 * state operator sees their state's; a platform admin sees all.
 */
export function feedbackScopeFilter(user: AuthUser): Record<string, unknown> {
  switch (user.role) {
    case Role.PLATFORM_ADMIN:
      return {}
    case Role.STATE_ADMIN:
    case Role.DISPATCHER:
      return user.stateId ? { stateId: user.stateId } : NOTHING
    case Role.PROVIDER_ADMIN:
    case Role.CREW:
      return user.providerId ? { providerId: user.providerId } : NOTHING
    case Role.PATIENT:
    default:
      return { userId: user.userId }
  }
}

/** True when `user` is allowed to see the given feedback record. */
export function canAccessFeedback(
  user: AuthUser,
  feedback: { userId?: string | null; providerId?: string | null; stateId?: string | null }
): boolean {
  switch (user.role) {
    case Role.PLATFORM_ADMIN:
      return true
    case Role.STATE_ADMIN:
    case Role.DISPATCHER:
      return Boolean(user.stateId) && feedback.stateId === user.stateId
    case Role.PROVIDER_ADMIN:
    case Role.CREW:
      return Boolean(user.providerId) && feedback.providerId === user.providerId
    case Role.PATIENT:
    default:
      return feedback.userId === user.userId
  }
}

/**
 * Prisma `where` fragment that restricts `Complaint` rows to those the caller
 * may list. The complainant sees their own; a state operator sees complaints
 * raised in their state; a platform admin sees all. A complaint with no state
 * snapshot is only ever visible to its author or a platform admin.
 */
export function complaintScopeFilter(user: AuthUser): Record<string, unknown> {
  switch (user.role) {
    case Role.PLATFORM_ADMIN:
      return {}
    case Role.STATE_ADMIN:
    case Role.DISPATCHER:
      return user.stateId ? { stateId: user.stateId } : NOTHING
    default:
      return { userId: user.userId }
  }
}

/** True when `user` is allowed to see the given complaint record. */
export function canAccessComplaint(
  user: AuthUser,
  complaint: { userId?: string | null; stateId?: string | null }
): boolean {
  if (user.role === Role.PLATFORM_ADMIN) return true
  if (user.role === Role.STATE_ADMIN || user.role === Role.DISPATCHER) {
    return Boolean(user.stateId) && complaint.stateId === user.stateId
  }
  return complaint.userId === user.userId
}

/** Loads a complaint and asserts the caller may see it (out of scope -> 404). */
export async function loadComplaintForUser(user: AuthUser, complaintId: string) {
  const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } })
  if (!complaint || !canAccessComplaint(user, complaint)) {
    throw new AppError(404, 'Complaint not found.', { code: 'COMPLAINT_NOT_FOUND' })
  }
  return complaint
}

/** Loads a feedback record and asserts the caller may see it (out of scope -> 404). */
export async function loadFeedbackForUser(user: AuthUser, feedbackId: string) {
  const feedback = await prisma.feedback.findUnique({ where: { id: feedbackId } })
  if (!feedback || !canAccessFeedback(user, feedback)) {
    throw new AppError(404, 'Feedback not found.', { code: 'FEEDBACK_NOT_FOUND' })
  }
  return feedback
}
