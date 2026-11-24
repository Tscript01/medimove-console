import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toConsentRecord } from '../utils/serializers'
import {
  getConsentSummary,
  grantConsent,
  isConsentType,
  listConsents,
  withdrawConsent
} from '../services/consentService'

/** GET /api/profile/consents — current state for every type plus full history. */
export const listConsentsController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const [summary, history] = await Promise.all([getConsentSummary(userId), listConsents(userId)])
  res.json({
    success: true,
    consents: summary,
    history: history.map(toConsentRecord)
  })
}

/** POST /api/profile/consents — grant (or re-grant) consent for a type. */
export const grantConsentController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { type, version } = req.body

  const record = await grantConsent(actor.userId, type, version, requestMeta(req))

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'consent.grant',
    resourceType: 'ConsentRecord',
    resourceId: record.id,
    metadata: { type, version },
    ...requestMeta(req)
  })

  res.status(201).json({ success: true, consent: toConsentRecord(record) })
}

/** POST /api/profile/consents/:type/withdraw — withdraw consent for a type. */
export const withdrawConsentController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const type = String(req.params.type ?? '')

  if (!isConsentType(type)) {
    throw new AppError(400, 'Unknown consent type.', { code: 'VALIDATION_ERROR', field: 'type' })
  }

  const state = await withdrawConsent(actor.userId, type)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'consent.withdraw',
    resourceType: 'ConsentRecord',
    resourceId: actor.userId,
    metadata: { type },
    ...requestMeta(req)
  })

  res.json({ success: true, consent: state })
}
