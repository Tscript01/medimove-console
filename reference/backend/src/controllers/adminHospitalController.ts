import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { parseOrThrow } from '../middleware/validate'
import { paginationMeta, parsePagination } from '../utils/pagination'
import { requestMeta } from '../utils/requestMeta'
import { toHospital } from '../utils/serializers'
import { reasonSchema } from '../validation/provider.schemas'
import {
  createHospital,
  getAdminHospital,
  listAdminHospitals,
  setHospitalStatus,
  updateHospital
} from '../services/adminService'
import {
  adminListHospitalsQuerySchema
} from '../validation/admin.schemas'
import type { AdminCreateHospitalInput, AdminUpdateHospitalInput } from '../validation/admin.schemas'

/**
 * Platform-level hospital administration. Distinct from the self-service
 * `/hospitals/me` surface: this lets a platform (or state) administrator curate
 * the hospital reference data, including deactivating a hospital. Scope is
 * always taken from the session; a state administrator is confined to their own
 * state and an out-of-scope hospital is reported as 404.
 */

// GET /api/admin/hospitals (requires hospital:manage)
export const listAdminHospitalsController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const query = parseOrThrow(adminListHospitalsQuerySchema, req.query, 'query')
  const window = parsePagination(query)

  const { items, total } = await listAdminHospitals(actor, query, window)
  res.json({
    success: true,
    hospitals: items.map(toHospital),
    pagination: paginationMeta(total, window)
  })
}

// GET /api/admin/hospitals/:id (requires hospital:manage)
export const getAdminHospitalController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const hospital = await getAdminHospital(actor, String(req.params.id ?? ''))
  res.json({ success: true, hospital: toHospital(hospital) })
}

// POST /api/admin/hospitals (requires hospital:manage)
export const createHospitalController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const hospital = await createHospital(actor, req.body as AdminCreateHospitalInput, requestMeta(req))
  res.status(201).json({ success: true, hospital: toHospital(hospital) })
}

// PATCH /api/admin/hospitals/:id (requires hospital:manage)
export const updateHospitalController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const hospital = await updateHospital(
    actor,
    String(req.params.id ?? ''),
    req.body as AdminUpdateHospitalInput,
    requestMeta(req)
  )
  res.json({ success: true, hospital: toHospital(hospital) })
}

// POST /api/admin/hospitals/:id/suspend (requires hospital:manage)
export const suspendHospitalController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = parseOrThrow(reasonSchema, req.body ?? {}, 'body')
  const hospital = await setHospitalStatus(actor, String(req.params.id ?? ''), false, input.reason, requestMeta(req))
  res.json({ success: true, hospital: toHospital(hospital) })
}

// POST /api/admin/hospitals/:id/activate (requires hospital:manage)
export const activateHospitalController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const hospital = await setHospitalStatus(actor, String(req.params.id ?? ''), true, undefined, requestMeta(req))
  res.json({ success: true, hospital: toHospital(hospital) })
}
