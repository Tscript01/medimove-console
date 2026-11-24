import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import type { AuthUser } from '../auth/permissions'
import { complaintScopeFilter, loadBookingForUser, loadComplaintForUser } from '../utils/access'
import { notifyComplaintUpdate } from './notificationService'
import type {
  CreateComplaintInput,
  ListComplaintsQuery,
  UpdateComplaintStatusInput
} from '../validation/complaint.schemas'
import type { ComplaintStatus } from '../generated/prisma/enums'

/**
 * Complaints.
 *
 * A complaint can be raised by any signed-in user, optionally about a booking
 * they can access. Handling follows an explicit status machine and every change
 * appends an immutable `ComplaintEvent`, so the trail is never lost. Reads are
 * scoped: the complainant sees their own, a state operator their state's, and a
 * platform admin everything.
 */

/**
 * The permitted complaint lifecycle. `CLOSED` is terminal; `RESOLVED`/`REJECTED`
 * may be reopened for review or closed.
 */
export const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  OPEN: ['IN_REVIEW', 'RESOLVED', 'REJECTED', 'CLOSED'],
  IN_REVIEW: ['RESOLVED', 'REJECTED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_REVIEW'],
  REJECTED: ['CLOSED', 'IN_REVIEW'],
  CLOSED: []
}

export function allowedComplaintTransitions(status: ComplaintStatus): ComplaintStatus[] {
  return [...(COMPLAINT_TRANSITIONS[status] ?? [])]
}

function buildComplaintReference(): string {
  return `MM-CMP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 10000)}`
}

export async function createComplaint(
  actor: AuthUser,
  input: CreateComplaintInput
): Promise<Record<string, any>> {
  // If a booking is referenced, the caller must be able to access it (404
  // otherwise, so a stranger's booking id is never confirmed).
  const booking = input.bookingId ? await loadBookingForUser(actor, input.bookingId) : null
  const stateId = booking?.stateId ?? actor.stateId ?? null

  return prisma.$transaction(async (tx: any) => {
    const complaint = await tx.complaint.create({
      data: {
        reference: buildComplaintReference(),
        userId: actor.userId,
        bookingId: booking?.id ?? null,
        stateId,
        category: input.category,
        subject: input.subject,
        description: input.description,
        status: 'OPEN'
      }
    })

    await tx.complaintEvent.create({
      data: {
        complaintId: complaint.id,
        fromStatus: null,
        toStatus: 'OPEN',
        actorId: actor.userId,
        actorRole: actor.role,
        note: 'Complaint submitted.'
      }
    })

    return complaint
  })
}

/** Paginated complaint list, scoped to the caller. */
export async function listComplaints(
  actor: AuthUser,
  query: ListComplaintsQuery,
  window: { skip: number; take: number }
): Promise<{ items: Record<string, any>[]; total: number }> {
  const where: Record<string, unknown> = { ...complaintScopeFilter(actor) }
  if (query.status) where.status = query.status
  if (query.category) where.category = query.category
  if (query.bookingId) where.bookingId = query.bookingId

  const [total, items] = await Promise.all([
    prisma.complaint.count({ where }),
    prisma.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: window.skip,
      take: window.take
    })
  ])
  return { items, total }
}

/** One complaint plus its append-only handling trail (scope enforced). */
export async function getComplaintDetail(actor: AuthUser, complaintId: string) {
  const complaint = await loadComplaintForUser(actor, complaintId)
  const events = await prisma.complaintEvent.findMany({
    where: { complaintId: complaint.id },
    orderBy: { createdAt: 'asc' }
  })
  return { complaint, events }
}

/**
 * Moves a complaint through its status machine. The caller's ability to manage
 * complaints is enforced by the route; this only enforces scope and the
 * transition itself, and commits the status change and its trail atomically.
 */
export async function updateComplaintStatus(
  actor: AuthUser,
  complaintId: string,
  input: UpdateComplaintStatusInput
): Promise<{ complaint: Record<string, any>; from: ComplaintStatus }> {
  const existing = await loadComplaintForUser(actor, complaintId)
  const from = (existing.status ?? 'OPEN') as ComplaintStatus

  if (from === input.status) {
    throw new AppError(409, `The complaint is already ${from}.`, { code: 'COMPLAINT_NO_CHANGE' })
  }
  if (!COMPLAINT_TRANSITIONS[from]?.includes(input.status)) {
    throw new AppError(409, `A complaint cannot move from ${from} to ${input.status}.`, {
      code: 'COMPLAINT_INVALID_TRANSITION'
    })
  }

  const now = new Date()
  const data: Record<string, unknown> = { status: input.status }
  if (input.resolution) data.resolution = input.resolution
  if (input.assignedToId) data.assignedToId = input.assignedToId
  if (input.status === 'RESOLVED') data.resolvedAt = now
  if (input.status === 'CLOSED') data.closedAt = now

  const complaint = await prisma.$transaction(async (tx: any) => {
    const updated = await tx.complaint.update({ where: { id: existing.id }, data })
    await tx.complaintEvent.create({
      data: {
        complaintId: existing.id,
        fromStatus: from,
        toStatus: input.status,
        actorId: actor.userId,
        actorRole: actor.role,
        note: input.note ?? input.resolution ?? null
      }
    })
    return updated
  })

  // Best-effort: a notification failure never un-does the status change.
  await notifyComplaintUpdate(complaint)

  return { complaint, from }
}
