import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { Role } from '../auth/permissions'
import { AppError } from '../errors/AppError'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toProvider, toProviderLocation } from '../utils/serializers'
import {
  applyProvider,
  createProviderLocation,
  deleteProviderLocation,
  getOwnProvider,
  getProvider,
  linkProviderServiceArea,
  listProviderLocations,
  listProviderServiceAreas,
  listProviders,
  setProviderStatus,
  unlinkProviderServiceArea,
  updateOwnProvider,
  updateProviderLocation,
  verifyProvider
} from '../services/providerService'

function idParam(req: { params: Record<string, unknown> }, label: string): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, `${label} id is required.`, { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

/** Provider-scoped handlers require the caller to belong to a provider. */
function providerIdOf(req: Parameters<RequestHandler>[0]): string {
  const actor = currentUser(req)
  if (!actor.providerId) throw new AppError(404, 'Provider not found.', { code: 'PROVIDER_NOT_FOUND' })
  return actor.providerId
}

/** State admins may only act on providers inside their own state. */
async function assertInScope(req: Parameters<RequestHandler>[0], providerId: string) {
  const actor = currentUser(req)
  const provider = await getProvider(providerId)
  if (actor.role === Role.STATE_ADMIN && provider.stateId !== actor.stateId) {
    throw new AppError(404, 'Provider not found.', { code: 'PROVIDER_NOT_FOUND' })
  }
  return provider
}

// POST /api/providers/apply
export const applyProviderController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const provider = await applyProvider(actor.userId, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'provider.apply',
    resourceType: 'AmbulanceProvider',
    resourceId: provider.id,
    metadata: { name: provider.name, stateId: provider.stateId ?? null },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, provider: toProvider(provider) })
}

// GET /api/providers/me
export const getOwnProviderController: RequestHandler = async (req, res) => {
  const provider = await getOwnProvider(providerIdOf(req))
  res.json({ success: true, provider: toProvider(provider) })
}

// PATCH /api/providers/me
export const updateOwnProviderController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const provider = await updateOwnProvider(actor.providerId, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'provider.update',
    resourceType: 'AmbulanceProvider',
    resourceId: provider.id,
    metadata: { fields: Object.keys(req.body) },
    ...requestMeta(req)
  })
  res.json({ success: true, provider: toProvider(provider) })
}

// --- Operating locations ---------------------------------------------------

// GET /api/providers/me/locations
export const listProviderLocationsController: RequestHandler = async (req, res) => {
  const locations = await listProviderLocations(providerIdOf(req))
  res.json({ success: true, locations: locations.map(toProviderLocation) })
}

// POST /api/providers/me/locations
export const createProviderLocationController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const location = await createProviderLocation(providerIdOf(req), req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'provider.location.create',
    resourceType: 'ProviderOperatingLocation',
    resourceId: location.id,
    metadata: { providerId: location.providerId },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, location: toProviderLocation(location) })
}

// PATCH /api/providers/me/locations/:id
export const updateProviderLocationController: RequestHandler = async (req, res) => {
  const location = await updateProviderLocation(providerIdOf(req), idParam(req, 'Location'), req.body)
  res.json({ success: true, location: toProviderLocation(location) })
}

// DELETE /api/providers/me/locations/:id
export const deleteProviderLocationController: RequestHandler = async (req, res) => {
  await deleteProviderLocation(providerIdOf(req), idParam(req, 'Location'))
  res.json({ success: true, message: 'Operating location removed.' })
}

// --- Service areas ---------------------------------------------------------

// GET /api/providers/me/service-areas
export const listProviderServiceAreasController: RequestHandler = async (req, res) => {
  const links = await listProviderServiceAreas(providerIdOf(req))
  res.json({ success: true, serviceAreas: links })
}

// POST /api/providers/me/service-areas
export const linkProviderServiceAreaController: RequestHandler = async (req, res) => {
  const link = await linkProviderServiceArea(providerIdOf(req), req.body.serviceAreaId)
  res.status(201).json({ success: true, serviceArea: link })
}

// DELETE /api/providers/me/service-areas/:id
export const unlinkProviderServiceAreaController: RequestHandler = async (req, res) => {
  await unlinkProviderServiceArea(providerIdOf(req), idParam(req, 'Service-area link'))
  res.json({ success: true, message: 'Service area unlinked.' })
}

// --- Administration --------------------------------------------------------

// GET /api/admin/providers
export const listProvidersController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const requested = typeof req.query.stateId === 'string' ? req.query.stateId : undefined
  const stateId = actor.role === Role.STATE_ADMIN ? actor.stateId : requested ?? null

  if (actor.role === Role.STATE_ADMIN && !stateId) {
    res.json({ success: true, providers: [] })
    return
  }

  const providers = await listProviders({ stateId })
  res.json({ success: true, providers: providers.map(toProvider) })
}

// GET /api/admin/providers/:id
export const getProviderController: RequestHandler = async (req, res) => {
  const provider = await assertInScope(req, idParam(req, 'Provider'))
  res.json({ success: true, provider: toProvider(provider) })
}

// POST /api/admin/providers/:id/verify
export const verifyProviderController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Provider')
  await assertInScope(req, id)
  const { decision, reason } = req.body
  const provider = await verifyProvider(id, actor.userId, decision, reason)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: `provider.${decision === 'VERIFIED' ? 'verify' : 'reject'}`,
    resourceType: 'AmbulanceProvider',
    resourceId: id,
    metadata: { reason: reason ?? null },
    ...requestMeta(req)
  })
  res.json({ success: true, provider: toProvider(provider) })
}

// POST /api/admin/providers/:id/activate
export const activateProviderController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Provider')
  await assertInScope(req, id)
  const provider = await setProviderStatus(id, 'ACTIVE')
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'provider.activate',
    resourceType: 'AmbulanceProvider',
    resourceId: id,
    ...requestMeta(req)
  })
  res.json({ success: true, provider: toProvider(provider) })
}

// POST /api/admin/providers/:id/suspend
export const suspendProviderController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Provider')
  await assertInScope(req, id)
  const provider = await setProviderStatus(id, 'SUSPENDED', req.body?.reason)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'provider.suspend',
    resourceType: 'AmbulanceProvider',
    resourceId: id,
    metadata: { reason: req.body?.reason ?? null },
    ...requestMeta(req)
  })
  res.json({ success: true, provider: toProvider(provider) })
}
