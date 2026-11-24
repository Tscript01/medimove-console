import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toPricingConfig } from '../utils/serializers'
import {
  createPricingConfig,
  estimateFare,
  getPricingConfig,
  listPricingConfigs,
  setPricingConfigActive,
  updatePricingConfig,
  type PricingActor
} from '../services/pricingService'
import type { EstimateFareInput } from '../validation/pricing.schemas'
import { listPricingQuerySchema } from '../validation/pricing.schemas'

/**
 * Pricing HTTP handlers. All fare arithmetic lives in `services/pricingService`;
 * these handlers only translate HTTP. Note that no endpoint here accepts a
 * payable amount — administrators send *rule configuration*, requesters only
 * ever send locations.
 */

function actorOf(req: Parameters<RequestHandler>[0]): PricingActor {
  const actor = currentUser(req)
  return { userId: actor.userId, role: actor.role, stateId: actor.stateId }
}

function idParam(req: { params: Record<string, unknown> }): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Pricing rule id is required.', { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

// POST /api/pricing/estimate
export const estimateFareController: RequestHandler = async (req, res) => {
  const estimate = await estimateFare(req.body as EstimateFareInput)
  res.json({
    success: true,
    estimate: {
      distanceKm: estimate.distanceKm,
      estimatedFareKobo: estimate.estimatedFareKobo,
      currency: estimate.breakdown.currency,
      breakdown: estimate.breakdown,
      pricingConfig: estimate.pricingConfig ? toPricingConfig(estimate.pricingConfig) : null
    }
  })
}

// GET /api/admin/pricing
export const listPricingConfigsController: RequestHandler = async (req, res) => {
  const actor = actorOf(req)
  const filter = parseOrThrow(listPricingQuerySchema, req.query, 'query')
  const configs = await listPricingConfigs(actor, filter)
  res.json({ success: true, pricing: configs.map(toPricingConfig) })
}

// GET /api/admin/pricing/:id
export const getPricingConfigController: RequestHandler = async (req, res) => {
  const config = await getPricingConfig(actorOf(req), idParam(req))
  res.json({ success: true, pricing: toPricingConfig(config) })
}

// POST /api/admin/pricing
export const createPricingConfigController: RequestHandler = async (req, res) => {
  const actor = actorOf(req)
  const config = await createPricingConfig(actor, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'pricing.create',
    resourceType: 'PricingConfig',
    resourceId: config.id,
    metadata: {
      stateId: config.stateId ?? null,
      serviceAreaId: config.serviceAreaId ?? null,
      providerId: config.providerId ?? null,
      vehicleCategory: config.vehicleCategory ?? null
    },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, pricing: toPricingConfig(config) })
}

// PATCH /api/admin/pricing/:id
export const updatePricingConfigController: RequestHandler = async (req, res) => {
  const actor = actorOf(req)
  const config = await updatePricingConfig(actor, idParam(req), req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'pricing.update',
    resourceType: 'PricingConfig',
    resourceId: config.id,
    metadata: { fields: Object.keys(req.body) },
    ...requestMeta(req)
  })
  res.json({ success: true, pricing: toPricingConfig(config) })
}

// PATCH /api/admin/pricing/:id/status
export const setPricingConfigActiveController: RequestHandler = async (req, res) => {
  const actor = actorOf(req)
  const { isActive } = req.body as { isActive: boolean }
  const config = await setPricingConfigActive(actor, idParam(req), isActive)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: isActive ? 'pricing.activate' : 'pricing.deactivate',
    resourceType: 'PricingConfig',
    resourceId: config.id,
    ...requestMeta(req)
  })
  res.json({ success: true, pricing: toPricingConfig(config) })
}
