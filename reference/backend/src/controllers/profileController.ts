import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toEmergencyContact, toPatientProfile, toPublicUser } from '../utils/serializers'
import {
  getProfileAggregate,
  requestPhoneVerification,
  updateProfile,
  verifyPhone
} from '../services/profileService'

/** GET /api/profile — the caller's full onboarding view. */
export const getProfileController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const { user, profile, contacts, completion } = await getProfileAggregate(userId)

  res.json({
    success: true,
    user: toPublicUser(user),
    profile: toPatientProfile(profile),
    emergencyContacts: contacts.map(toEmergencyContact),
    completion
  })
}

/** PATCH /api/profile — update identity + onboarding fields. */
export const updateProfileController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { user, profile } = await updateProfile(actor.userId, req.body)

  // Only field *names* are audited — never the values (they contain PII).
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'profile.update',
    resourceType: 'User',
    resourceId: actor.userId,
    metadata: { fields: Object.keys(req.body) },
    ...requestMeta(req)
  })

  res.json({ success: true, user: toPublicUser(user), profile: toPatientProfile(profile) })
}

/** POST /api/profile/phone/request-verification — send a code to the stored phone. */
export const requestPhoneVerificationController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const result = await requestPhoneVerification(userId)

  res.json({
    success: true,
    alreadyVerified: result.alreadyVerified,
    message: result.alreadyVerified
      ? 'Your phone number is already verified.'
      : 'A verification code has been sent to your phone.',
    ...(result.alreadyVerified ? {} : { expiresInMinutes: result.expiresInMinutes })
  })
}

/** POST /api/profile/phone/verify — confirm the code and mark the phone verified. */
export const verifyPhoneController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const user = await verifyPhone(actor.userId, req.body.code)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'profile.phone.verify',
    resourceType: 'User',
    resourceId: actor.userId,
    ...requestMeta(req)
  })

  res.json({ success: true, message: 'Phone number verified.', user: toPublicUser(user) })
}
