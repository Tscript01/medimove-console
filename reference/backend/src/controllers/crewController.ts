import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toCrewDocument, toCrewInvitation, toCrewProfile } from '../utils/serializers'
import { getProvider } from '../services/providerService'
import {
  acceptInvitation,
  assignAmbulance,
  deactivateCrew,
  getCrewProfileById,
  getDocumentById,
  getOwnCrewProfile,
  inviteCrew,
  listInvitations,
  listOwnDocuments,
  listProviderCrew,
  reactivateCrew,
  reviewDocument,
  revokeInvitation,
  setOwnAvailability,
  submitDocument,
  suspendCrew,
  updateOwnCrewProfile,
  verifyCrew
} from '../services/crewService'

function idParam(req: { params: Record<string, unknown> }, label: string): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, `${label} id is required.`, { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

function providerIdOf(req: Parameters<RequestHandler>[0]): string {
  const actor = currentUser(req)
  if (!actor.providerId) throw new AppError(404, 'Provider not found.', { code: 'PROVIDER_NOT_FOUND' })
  return actor.providerId
}

// --- Provider-side: invitations --------------------------------------------

// POST /api/providers/me/crew/invitations
export const inviteCrewController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { invitation, token } = await inviteCrew(actor.userId, providerIdOf(req), req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'crew.invite',
    resourceType: 'CrewInvitation',
    resourceId: invitation.id,
    metadata: { providerId: invitation.providerId, email: invitation.email, crewRole: invitation.crewRole },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, invitation: toCrewInvitation(invitation, token) })
}

// GET /api/providers/me/crew/invitations
export const listInvitationsController: RequestHandler = async (req, res) => {
  const invitations = await listInvitations(providerIdOf(req))
  res.json({ success: true, invitations: invitations.map((i: Record<string, unknown>) => toCrewInvitation(i)) })
}

// POST /api/providers/me/crew/invitations/:id/revoke
export const revokeInvitationController: RequestHandler = async (req, res) => {
  const invitation = await revokeInvitation(providerIdOf(req), idParam(req, 'Invitation'))
  res.json({ success: true, invitation: toCrewInvitation(invitation) })
}

// --- Provider-side: crew management ----------------------------------------

// GET /api/providers/me/crew
export const listProviderCrewController: RequestHandler = async (req, res) => {
  const crew = await listProviderCrew(providerIdOf(req))
  res.json({ success: true, crew: crew.map(toCrewProfile) })
}

// POST /api/providers/me/crew/:id/assign
export const assignAmbulanceController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Crew member')
  const crew = await assignAmbulance(providerIdOf(req), id, req.body.ambulanceId)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'crew.assign',
    resourceType: 'CrewProfile',
    resourceId: id,
    metadata: { ambulanceId: crew.assignedAmbulanceId },
    ...requestMeta(req)
  })
  res.json({ success: true, crew: toCrewProfile(crew) })
}

// POST /api/providers/me/crew/:id/deactivate
export const deactivateCrewController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Crew member')
  const crew = await deactivateCrew(providerIdOf(req), id, req.body?.reason)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'crew.deactivate',
    resourceType: 'CrewProfile',
    resourceId: id,
    metadata: { reason: req.body?.reason ?? null },
    ...requestMeta(req)
  })
  res.json({ success: true, crew: toCrewProfile(crew) })
}

// POST /api/providers/me/crew/:id/suspend
export const suspendCrewController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Crew member')
  const crew = await suspendCrew(providerIdOf(req), id, req.body?.reason)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'crew.suspend',
    resourceType: 'CrewProfile',
    resourceId: id,
    metadata: { reason: req.body?.reason ?? null },
    ...requestMeta(req)
  })
  res.json({ success: true, crew: toCrewProfile(crew) })
}

// POST /api/providers/me/crew/:id/reactivate
export const reactivateCrewController: RequestHandler = async (req, res) => {
  const crew = await reactivateCrew(providerIdOf(req), idParam(req, 'Crew member'))
  res.json({ success: true, crew: toCrewProfile(crew) })
}

// --- Crew self-service -----------------------------------------------------

// POST /api/crew/invitations/:token/accept
export const acceptInvitationController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const token = String(req.params.token ?? '')
  if (!token) throw new AppError(400, 'An invitation token is required.', { code: 'VALIDATION_ERROR', field: 'token' })
  const profile = await acceptInvitation(actor.userId, actor.email, token, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'crew.invitation.accept',
    resourceType: 'CrewProfile',
    resourceId: profile.id,
    metadata: { providerId: profile.providerId, crewRole: profile.crewRole },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, crew: toCrewProfile(profile) })
}

// GET /api/crew/me
export const getOwnCrewController: RequestHandler = async (req, res) => {
  const profile = await getOwnCrewProfile(currentUser(req).userId)
  res.json({ success: true, crew: toCrewProfile(profile) })
}

// PATCH /api/crew/me
export const updateOwnCrewController: RequestHandler = async (req, res) => {
  const profile = await updateOwnCrewProfile(currentUser(req).userId, req.body)
  res.json({ success: true, crew: toCrewProfile(profile) })
}

// POST /api/crew/me/availability
export const setOwnAvailabilityController: RequestHandler = async (req, res) => {
  const profile = await setOwnAvailability(currentUser(req).userId, req.body.availability)
  res.json({ success: true, crew: toCrewProfile(profile) })
}

// GET /api/crew/me/documents
export const listOwnDocumentsController: RequestHandler = async (req, res) => {
  const documents = await listOwnDocuments(currentUser(req).userId)
  res.json({ success: true, documents: documents.map(toCrewDocument) })
}

// POST /api/crew/me/documents
export const submitDocumentController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const document = await submitDocument(actor.userId, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'crew.document.submit',
    resourceType: 'CrewDocument',
    resourceId: document.id,
    metadata: { type: document.type },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, document: toCrewDocument(document) })
}

// --- Verification (reviewers) ----------------------------------------------

// POST /api/admin/crew/:id/verify
export const verifyCrewController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Crew member')
  const { decision, reason } = req.body

  // State admins may only verify crew whose provider is in their state.
  if (actor.role !== 'PLATFORM_ADMIN') {
    const profile = await getCrewProfileById(id)
    const provider = await getProvider(profile.providerId)
    if (actor.role === 'STATE_ADMIN' && provider.stateId !== actor.stateId) {
      throw new AppError(404, 'Crew member not found.', { code: 'CREW_NOT_FOUND' })
    }
  }

  const crew = await verifyCrew(actor.userId, id, decision, reason)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: `crew.${decision === 'VERIFIED' ? 'verify' : 'reject'}`,
    resourceType: 'CrewProfile',
    resourceId: id,
    metadata: { reason: reason ?? null },
    ...requestMeta(req)
  })
  res.json({ success: true, crew: toCrewProfile(crew) })
}

// POST /api/admin/crew-documents/:id/review
export const reviewDocumentController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Document')

  // State admins may only review documents belonging to crew in their state.
  if (actor.role !== 'PLATFORM_ADMIN') {
    const document = await getDocumentById(id)
    const profile = await getCrewProfileById(document.crewProfileId)
    const provider = await getProvider(profile.providerId)
    if (actor.role === 'STATE_ADMIN' && provider.stateId !== actor.stateId) {
      throw new AppError(404, 'Document not found.', { code: 'DOCUMENT_NOT_FOUND' })
    }
  }

  const document = await reviewDocument(actor.userId, id, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: `crew.document.${document.status === 'APPROVED' ? 'approve' : 'reject'}`,
    resourceType: 'CrewDocument',
    resourceId: id,
    metadata: { status: document.status },
    ...requestMeta(req)
  })
  res.json({ success: true, document: toCrewDocument(document) })
}
