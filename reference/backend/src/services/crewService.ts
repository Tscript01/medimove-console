import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { Role } from '../auth/permissions'
import { generateRefreshToken, hashToken } from '../utils/crypto'
import type {
  AcceptInvitationInput,
  InviteCrewInput,
  ReviewDocumentInput,
  SubmitDocumentInput,
  UpdateCrewProfileInput
} from '../validation/crew.schemas'

/**
 * Crew lifecycle: invitations, activation, profile, documents, verification,
 * availability, vehicle assignment and deactivation.
 *
 * Key invariants:
 * - Accepting an invitation requires the caller to be signed in as the invited
 *   email, so an invitation can never be used to hijack an account.
 * - Submitting a document does NOT verify anyone; only a reviewer can move a
 *   crew member to `VERIFIED`.
 * - Only a `VERIFIED` + `ACTIVE` crew member may be assigned to a vehicle or
 *   receive dispatch offers.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function crewNotFound(): AppError {
  return new AppError(404, 'Crew member not found.', { code: 'CREW_NOT_FOUND' })
}

function invitationNotFound(): AppError {
  return new AppError(404, 'Invitation not found.', { code: 'INVITATION_NOT_FOUND' })
}

async function loadCrew(id: string) {
  const profile = await prisma.crewProfile.findUnique({ where: { id } })
  if (!profile) throw crewNotFound()
  return profile
}

/** Loads a crew profile by id for reviewers (404 when missing). */
export async function getCrewProfileById(id: string) {
  return loadCrew(id)
}

// --- Invitations -----------------------------------------------------------

/**
 * Creates an invitation and returns it together with the single-use token. The
 * raw token is only ever returned here (to the inviting provider admin) — only
 * its hash is stored.
 */
export async function inviteCrew(actorUserId: string, providerId: string, input: InviteCrewInput) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } })
  if (existingUser?.crewProfile) {
    throw new AppError(409, 'That person is already a crew member.', { code: 'CREW_ALREADY_EXISTS' })
  }

  const token = generateRefreshToken()
  const invitation = await prisma.crewInvitation.create({
    data: {
      providerId,
      email: input.email,
      phone: input.phone,
      crewRole: input.crewRole,
      tokenHash: hashToken(token),
      status: 'PENDING',
      invitedById: actorUserId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS)
    }
  })

  return { invitation, token }
}

export async function listInvitations(providerId: string) {
  return prisma.crewInvitation.findMany({ where: { providerId }, orderBy: [{ createdAt: 'desc' }] })
}

export async function revokeInvitation(providerId: string, id: string) {
  const invitation = await prisma.crewInvitation.findUnique({ where: { id } })
  if (!invitation || invitation.providerId !== providerId) throw invitationNotFound()
  if (invitation.status !== 'PENDING') {
    throw new AppError(409, 'Only a pending invitation can be revoked.', { code: 'INVITATION_NOT_PENDING' })
  }
  return prisma.crewInvitation.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date() } })
}

/**
 * Accepts an invitation for the authenticated user. The invitation email must
 * match the caller's email; on success a crew profile is created and the user's
 * role/scope are set to CREW for that provider.
 */
export async function acceptInvitation(userId: string, userEmail: string, token: string, input: AcceptInvitationInput) {
  const invitation = await prisma.crewInvitation.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!invitation) throw invitationNotFound()

  if (invitation.status !== 'PENDING') {
    throw new AppError(409, 'This invitation is no longer valid.', { code: 'INVITATION_NOT_PENDING' })
  }
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    await prisma.crewInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } })
    throw new AppError(410, 'This invitation has expired.', { code: 'INVITATION_EXPIRED' })
  }
  if (String(invitation.email).toLowerCase() !== userEmail.toLowerCase()) {
    throw new AppError(403, 'This invitation was issued to a different email address.', {
      code: 'INVITATION_EMAIL_MISMATCH'
    })
  }

  const existing = await prisma.crewProfile.findUnique({ where: { userId } })
  if (existing) {
    throw new AppError(409, 'You already have a crew profile.', { code: 'CREW_ALREADY_EXISTS' })
  }

  return prisma.$transaction(async (tx: any) => {
    const profile = await tx.crewProfile.create({
      data: {
        userId,
        providerId: invitation.providerId,
        crewRole: invitation.crewRole,
        status: 'PENDING_VERIFICATION',
        verificationStatus: 'PENDING',
        availability: 'OFFLINE',
        licenseNumber: input.licenseNumber ?? null,
        yearsExperience: input.yearsExperience ?? null
      }
    })
    await tx.user.update({
      where: { id: userId },
      data: { role: Role.CREW, providerId: invitation.providerId }
    })
    await tx.crewInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: userId }
    })
    return profile
  })
}

// --- Own profile -----------------------------------------------------------

export async function getOwnCrewProfile(userId: string) {
  const profile = await prisma.crewProfile.findUnique({ where: { userId } })
  if (!profile) throw crewNotFound()
  return profile
}

export async function updateOwnCrewProfile(userId: string, input: UpdateCrewProfileInput) {
  const profile = await getOwnCrewProfile(userId)
  return prisma.crewProfile.update({ where: { id: profile.id }, data: { ...input } })
}

export async function setOwnAvailability(userId: string, availability: 'AVAILABLE' | 'ON_DUTY' | 'OFFLINE' | 'UNAVAILABLE') {
  const profile = await getOwnCrewProfile(userId)
  // A deactivated or suspended crew member cannot mark themselves available.
  if (profile.status === 'DEACTIVATED' || profile.status === 'SUSPENDED') {
    throw new AppError(409, 'Your crew account is not active.', { code: 'CREW_NOT_ACTIVE' })
  }
  return prisma.crewProfile.update({ where: { id: profile.id }, data: { availability } })
}

// --- Documents -------------------------------------------------------------

export async function submitDocument(userId: string, input: SubmitDocumentInput) {
  const profile = await getOwnCrewProfile(userId)
  // Submitting a document records it as PENDING — it never verifies the crew.
  return prisma.crewDocument.create({
    data: {
      crewProfileId: profile.id,
      type: input.type,
      fileUrl: input.fileUrl,
      status: 'PENDING',
      expiresAt: input.expiresAt ?? null
    }
  })
}

export async function listOwnDocuments(userId: string) {
  const profile = await getOwnCrewProfile(userId)
  return prisma.crewDocument.findMany({ where: { crewProfileId: profile.id }, orderBy: [{ createdAt: 'desc' }] })
}

/** Loads a document by id for reviewers (404 when missing). */
export async function getDocumentById(id: string) {
  const document = await prisma.crewDocument.findUnique({ where: { id } })
  if (!document) throw new AppError(404, 'Document not found.', { code: 'DOCUMENT_NOT_FOUND' })
  return document
}

export async function reviewDocument(actorId: string, id: string, input: ReviewDocumentInput) {
  const document = await prisma.crewDocument.findUnique({ where: { id } })
  if (!document) throw new AppError(404, 'Document not found.', { code: 'DOCUMENT_NOT_FOUND' })
  return prisma.crewDocument.update({
    where: { id },
    data: {
      status: input.status,
      rejectionReason: input.status === 'REJECTED' ? input.rejectionReason ?? null : null,
      reviewedById: actorId,
      reviewedAt: new Date()
    }
  })
}

// --- Provider-side crew management -----------------------------------------

export async function listProviderCrew(providerId: string) {
  return prisma.crewProfile.findMany({ where: { providerId }, orderBy: [{ createdAt: 'desc' }] })
}

async function loadOwnedCrew(providerId: string, id: string) {
  const profile = await loadCrew(id)
  if (profile.providerId !== providerId) throw crewNotFound()
  return profile
}

export async function assignAmbulance(providerId: string, id: string, ambulanceId: string) {
  const profile = await loadOwnedCrew(providerId, id)

  const ambulance = await prisma.ambulance.findUnique({ where: { id: ambulanceId } })
  if (!ambulance || ambulance.providerId !== providerId) {
    throw new AppError(400, 'Unknown ambulance for this provider.', { code: 'VALIDATION_ERROR', field: 'ambulanceId' })
  }
  if (profile.verificationStatus !== 'VERIFIED' || profile.status !== 'ACTIVE') {
    throw new AppError(409, 'Only verified, active crew can be assigned to a vehicle.', { code: 'CREW_NOT_ACTIVE' })
  }

  return prisma.crewProfile.update({ where: { id }, data: { assignedAmbulanceId: ambulanceId } })
}

/** Immediate deactivation: access and any assignment are revoked at once. */
export async function deactivateCrew(providerId: string, id: string, reason?: string) {
  await loadOwnedCrew(providerId, id)
  return prisma.crewProfile.update({
    where: { id },
    data: {
      status: 'DEACTIVATED',
      availability: 'OFFLINE',
      assignedAmbulanceId: null,
      deactivatedAt: new Date(),
      deactivationReason: reason ?? null
    }
  })
}

export async function suspendCrew(providerId: string, id: string, reason?: string) {
  await loadOwnedCrew(providerId, id)
  return prisma.crewProfile.update({
    where: { id },
    data: {
      status: 'SUSPENDED',
      availability: 'OFFLINE',
      assignedAmbulanceId: null,
      deactivationReason: reason ?? null
    }
  })
}

export async function reactivateCrew(providerId: string, id: string) {
  const profile = await loadOwnedCrew(providerId, id)
  return prisma.crewProfile.update({
    where: { id },
    data: {
      status: profile.verificationStatus === 'VERIFIED' ? 'ACTIVE' : 'PENDING_VERIFICATION',
      deactivatedAt: null,
      deactivationReason: null
    }
  })
}

// --- Verification (reviewers) ----------------------------------------------

export async function verifyCrew(actorId: string, id: string, decision: 'VERIFIED' | 'REJECTED', reason?: string) {
  const profile = await loadCrew(id)

  if (decision === 'VERIFIED') {
    const nextStatus = profile.status === 'PENDING_VERIFICATION' || profile.status === 'INVITED' ? 'ACTIVE' : profile.status
    return prisma.crewProfile.update({
      where: { id },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedById: actorId,
        status: nextStatus,
        deactivationReason: null
      }
    })
  }

  return prisma.crewProfile.update({
    where: { id },
    data: { verificationStatus: 'REJECTED', deactivationReason: reason ?? null }
  })
}
