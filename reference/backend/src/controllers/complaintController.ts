import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { paginationMeta, parsePagination } from '../utils/pagination'
import { toComplaint } from '../utils/serializers'
import {
  allowedComplaintTransitions,
  createComplaint,
  getComplaintDetail,
  listComplaints,
  updateComplaintStatus
} from '../services/complaintService'
import {
  listComplaintsQuerySchema
} from '../validation/complaint.schemas'
import type { CreateComplaintInput, UpdateComplaintStatusInput } from '../validation/complaint.schemas'
import type { ComplaintStatus } from '../generated/prisma/enums'

/**
 * Complaint HTTP handlers. The status machine and scope rules live in
 * `services/complaintService`; handlers only translate HTTP and record audit.
 */

// POST /api/complaints (any authenticated user)
export const createComplaintController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as CreateComplaintInput
  const complaint = await createComplaint(actor, input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'complaint.create',
    resourceType: 'Complaint',
    resourceId: complaint.id,
    metadata: { reference: complaint.reference, category: complaint.category, bookingId: complaint.bookingId ?? null },
    ...requestMeta(req)
  })

  res.status(201).json({ success: true, complaint: toComplaint(complaint) })
}

// GET /api/complaints (scoped to the caller)
export const listComplaintsController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const query = parseOrThrow(listComplaintsQuerySchema, req.query, 'query')
  const window = parsePagination(query)

  const { items, total } = await listComplaints(actor, query, window)
  res.json({
    success: true,
    complaints: items.map(toComplaint),
    pagination: paginationMeta(total, window)
  })
}

// GET /api/complaints/:id (scope enforced; includes the handling trail)
export const getComplaintController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { complaint, events } = await getComplaintDetail(actor, String(req.params.id ?? ''))
  res.json({
    success: true,
    complaint: toComplaint({ ...complaint, events }),
    allowedTransitions: allowedComplaintTransitions((complaint.status ?? 'OPEN') as ComplaintStatus)
  })
}

// PATCH /api/complaints/:id/status (complaint:manage + scope)
export const updateComplaintStatusController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as UpdateComplaintStatusInput
  const { complaint, from } = await updateComplaintStatus(actor, String(req.params.id ?? ''), input)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'complaint.status.update',
    resourceType: 'Complaint',
    resourceId: complaint.id,
    metadata: { from, to: input.status, assignedToId: input.assignedToId ?? null },
    ...requestMeta(req)
  })

  res.json({
    success: true,
    complaint: toComplaint(complaint),
    allowedTransitions: allowedComplaintTransitions(input.status)
  })
}
