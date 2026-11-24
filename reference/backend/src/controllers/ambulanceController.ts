import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toAmbulance } from '../utils/serializers'
import {
  createAmbulance,
  deleteAmbulance,
  getAmbulance,
  listAmbulances,
  setAmbulanceAvailability,
  updateAmbulance,
  updateAmbulanceLocation,
  verifyAmbulance
} from '../services/ambulanceService'
import { getProvider } from '../services/providerService'

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

// GET /api/providers/me/ambulances
export const listAmbulancesController: RequestHandler = async (req, res) => {
  const ambulances = await listAmbulances(providerIdOf(req))
  res.json({ success: true, ambulances: ambulances.map(toAmbulance) })
}

// POST /api/providers/me/ambulances
export const createAmbulanceController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const ambulance = await createAmbulance(providerIdOf(req), req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'ambulance.create',
    resourceType: 'Ambulance',
    resourceId: ambulance.id,
    metadata: { providerId: ambulance.providerId, registrationNumber: ambulance.registrationNumber },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, ambulance: toAmbulance(ambulance) })
}

// GET /api/providers/me/ambulances/:id
export const getAmbulanceController: RequestHandler = async (req, res) => {
  const ambulance = await getAmbulance(idParam(req, 'Ambulance'))
  if (ambulance.providerId !== providerIdOf(req)) {
    throw new AppError(404, 'Ambulance not found.', { code: 'AMBULANCE_NOT_FOUND' })
  }
  res.json({ success: true, ambulance: toAmbulance(ambulance) })
}

// PATCH /api/providers/me/ambulances/:id
export const updateAmbulanceController: RequestHandler = async (req, res) => {
  const ambulance = await updateAmbulance(providerIdOf(req), idParam(req, 'Ambulance'), req.body)
  res.json({ success: true, ambulance: toAmbulance(ambulance) })
}

// DELETE /api/providers/me/ambulances/:id
export const deleteAmbulanceController: RequestHandler = async (req, res) => {
  await deleteAmbulance(providerIdOf(req), idParam(req, 'Ambulance'))
  res.json({ success: true, message: 'Ambulance removed.' })
}

// POST /api/providers/me/ambulances/:id/location
export const updateAmbulanceLocationController: RequestHandler = async (req, res) => {
  const { latitude, longitude } = req.body
  const ambulance = await updateAmbulanceLocation(providerIdOf(req), idParam(req, 'Ambulance'), latitude, longitude)
  res.json({ success: true, ambulance: toAmbulance(ambulance) })
}

// POST /api/providers/me/ambulances/:id/availability
export const setAmbulanceAvailabilityController: RequestHandler = async (req, res) => {
  const ambulance = await setAmbulanceAvailability(
    providerIdOf(req),
    idParam(req, 'Ambulance'),
    req.body.availability
  )
  res.json({ success: true, ambulance: toAmbulance(ambulance) })
}

// POST /api/admin/ambulances/:id/verify
export const verifyAmbulanceController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = idParam(req, 'Ambulance')
  const { decision, reason } = req.body

  // State admins may only review vehicles belonging to a provider in their state.
  const ambulance = await getAmbulance(id)
  if (actor.role !== 'PLATFORM_ADMIN') {
    const provider = await getProvider(ambulance.providerId)
    if (actor.role === 'STATE_ADMIN' && provider.stateId !== actor.stateId) {
      throw new AppError(404, 'Ambulance not found.', { code: 'AMBULANCE_NOT_FOUND' })
    }
  }

  const updated = await verifyAmbulance(id, actor.userId, decision, reason)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: `ambulance.${decision === 'VERIFIED' ? 'verify' : 'reject'}`,
    resourceType: 'Ambulance',
    resourceId: id,
    metadata: { reason: reason ?? null },
    ...requestMeta(req)
  })
  res.json({ success: true, ambulance: toAmbulance(updated) })
}
