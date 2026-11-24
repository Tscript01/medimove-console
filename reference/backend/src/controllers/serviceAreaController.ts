import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { Role } from '../auth/permissions'
import { recordAudit } from '../services/auditService'
import {
  createServiceArea,
  createState,
  deleteServiceArea,
  getServiceArea,
  listServiceAreas,
  listStates,
  updateServiceArea,
  updateState
} from '../services/serviceAreaService'
import { requestMeta } from '../utils/requestMeta'
import { toServiceArea, toState } from '../utils/serializers'
import type { CreateServiceAreaInput } from '../validation/location.schemas'

function paramId(req: { params: Record<string, unknown> }, label: string): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, `${label} id is required.`, { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

/** A state admin may only ever touch service areas inside their own state. */
function scopedStateId(actorStateId: string | null, role: Role, requested?: string): string | null {
  if (role === Role.STATE_ADMIN) return actorStateId
  return requested ?? null
}

// GET /api/admin/service-areas
export const listServiceAreasController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const requested = typeof req.query.stateId === 'string' ? req.query.stateId : undefined
  const stateId = scopedStateId(actor.stateId, actor.role, requested)

  if (actor.role === Role.STATE_ADMIN && !stateId) {
    res.json({ success: true, serviceAreas: [] })
    return
  }

  const areas = await listServiceAreas({ stateId })
  res.json({ success: true, serviceAreas: areas.map(toServiceArea) })
}

// POST /api/admin/service-areas
export const createServiceAreaController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = req.body as CreateServiceAreaInput

  const stateId = scopedStateId(actor.stateId, actor.role, input.stateId)
  if (!stateId) {
    throw new AppError(400, 'A stateId is required.', { code: 'SCOPE_REQUIRED', field: 'stateId' })
  }

  const area = await createServiceArea({ ...input, stateId })
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'service-area.create',
    resourceType: 'ServiceArea',
    resourceId: area.id,
    metadata: { stateId, name: area.name },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, serviceArea: toServiceArea(area) })
}

// PATCH /api/admin/service-areas/:id
export const updateServiceAreaController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = paramId(req, 'Service area')

  const target = await getServiceArea(id)
  if (!target || (actor.role === Role.STATE_ADMIN && target.stateId !== actor.stateId)) {
    throw new AppError(404, 'Service area not found.', { code: 'SERVICE_AREA_NOT_FOUND' })
  }

  const area = await updateServiceArea(id, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'service-area.update',
    resourceType: 'ServiceArea',
    resourceId: id,
    metadata: { fields: Object.keys(req.body) },
    ...requestMeta(req)
  })
  res.json({ success: true, serviceArea: toServiceArea(area) })
}

// DELETE /api/admin/service-areas/:id
export const deleteServiceAreaController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = paramId(req, 'Service area')

  const target = await getServiceArea(id)
  if (!target || (actor.role === Role.STATE_ADMIN && target.stateId !== actor.stateId)) {
    throw new AppError(404, 'Service area not found.', { code: 'SERVICE_AREA_NOT_FOUND' })
  }

  await deleteServiceArea(id)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'service-area.delete',
    resourceType: 'ServiceArea',
    resourceId: id,
    ...requestMeta(req)
  })
  res.json({ success: true, message: 'Service area removed.' })
}

// GET /api/admin/states
export const listStatesAdminController: RequestHandler = async (_req, res) => {
  const states = await listStates()
  res.json({ success: true, states: states.map(toState) })
}

// POST /api/admin/states
export const createStateController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const state = await createState(req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'state.create',
    resourceType: 'State',
    resourceId: state.id,
    metadata: { name: state.name, code: state.code },
    ...requestMeta(req)
  })
  res.status(201).json({ success: true, state: toState(state) })
}

// PATCH /api/admin/states/:id
export const updateStateController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const id = paramId(req, 'State')
  const state = await updateState(id, req.body)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'state.update',
    resourceType: 'State',
    resourceId: id,
    metadata: { fields: Object.keys(req.body) },
    ...requestMeta(req)
  })
  res.json({ success: true, state: toState(state) })
}
