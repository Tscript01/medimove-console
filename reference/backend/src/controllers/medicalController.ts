import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toMedicalInfo } from '../utils/serializers'
import { deleteMedicalInfo, getMedicalInfo, upsertMedicalInfo } from '../services/medicalInfoService'

/**
 * Medical information endpoints. Each handler operates on the caller's own
 * record only and is additionally gated on an active MEDICAL_DATA consent by the
 * service layer.
 */

/** GET /api/profile/medical */
export const getMedicalInfoController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const info = await getMedicalInfo(userId)
  res.json({ success: true, medicalInfo: toMedicalInfo(info) })
}

/** PUT /api/profile/medical — create or replace the caller's medical info. */
export const upsertMedicalInfoController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const info = await upsertMedicalInfo(actor.userId, req.body)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'medical.update',
    resourceType: 'PatientMedicalInfo',
    resourceId: actor.userId,
    metadata: { fields: Object.keys(req.body) },
    ...requestMeta(req)
  })

  res.json({ success: true, medicalInfo: toMedicalInfo(info) })
}

/** DELETE /api/profile/medical */
export const deleteMedicalInfoController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  await deleteMedicalInfo(actor.userId)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'medical.delete',
    resourceType: 'PatientMedicalInfo',
    resourceId: actor.userId,
    ...requestMeta(req)
  })

  res.json({ success: true, message: 'Medical information deleted.' })
}
