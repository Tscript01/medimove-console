import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import {
  toHospital,
  toHospitalCapacity,
  toHospitalService,
  toHospitalSpecialty,
  toHospitalStaff,
  toIncomingPatient
} from '../utils/serializers'
import {
  authorizeStaff,
  getHospital,
  getOwnCapacity,
  getOwnHospital,
  listHospitals,
  listIncomingPatients,
  listOwnStaff,
  replaceServices,
  replaceSpecialties,
  revokeStaff,
  updateOwnCapacity,
  updateOwnHospital
} from '../services/hospitalService'
import { listHospitalsQuerySchema } from '../validation/hospital.schemas'
import type { AuthorizeStaffInput } from '../validation/hospital.schemas'

/**
 * Hospital HTTP handlers. All hospital-scoping and business rules live in
 * `services/hospitalService`; handlers translate HTTP to/from it and record the
 * audit trail for profile/capacity changes. Staff role changes are audited
 * atomically inside the service.
 */

function idParam(req: { params: Record<string, unknown> }, label: string): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, `${label} id is required.`, { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

// GET /api/hospitals — directory (any signed-in user)
export const listHospitalsController: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listHospitalsQuerySchema, req.query, 'query')
  const hospitals = await listHospitals(query)
  res.json({ success: true, hospitals: hospitals.map(toHospital) })
}

// GET /api/hospitals/me — the caller's own hospital (hospital:profile:read)
export const getOwnHospitalController: RequestHandler = async (req, res) => {
  const hospital = await getOwnHospital(currentUser(req))
  res.json({ success: true, hospital: toHospital(hospital) })
}

// GET /api/hospitals/:id — a single hospital profile (any signed-in user)
export const getHospitalController: RequestHandler = async (req, res) => {
  const hospital = await getHospital(idParam(req, 'Hospital'))
  res.json({ success: true, hospital: toHospital(hospital) })
}

// PATCH /api/hospitals/me — update profile/location (hospital:profile:manage)
export const updateOwnHospitalController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const hospital = await updateOwnHospital(actor, req.body)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'hospital.profile.update',
    resourceType: 'Hospital',
    resourceId: hospital.id,
    metadata: { fields: Object.keys(req.body ?? {}) },
    ...requestMeta(req)
  })

  res.json({ success: true, hospital: toHospital(hospital) })
}

// PUT /api/hospitals/me/specialties — replace specialties (hospital:profile:manage)
export const replaceSpecialtiesController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const specialties = await replaceSpecialties(actor, req.body)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'hospital.specialties.update',
    resourceType: 'Hospital',
    resourceId: actor.hospitalId,
    metadata: { count: specialties.length },
    ...requestMeta(req)
  })

  res.json({ success: true, specialties: specialties.map(toHospitalSpecialty) })
}

// GET /api/hospitals/me/specialties (hospital:profile:read)
export const listSpecialtiesController: RequestHandler = async (req, res) => {
  const hospital = await getOwnHospital(currentUser(req))
  res.json({ success: true, specialties: (hospital.specialties ?? []).map(toHospitalSpecialty) })
}

// PUT /api/hospitals/me/services — replace service availability (hospital:profile:manage)
export const replaceServicesController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const services = await replaceServices(actor, req.body)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'hospital.services.update',
    resourceType: 'Hospital',
    resourceId: actor.hospitalId,
    metadata: { count: services.length },
    ...requestMeta(req)
  })

  res.json({ success: true, services: services.map(toHospitalService) })
}

// GET /api/hospitals/me/services (hospital:profile:read)
export const listServicesController: RequestHandler = async (req, res) => {
  const hospital = await getOwnHospital(currentUser(req))
  res.json({ success: true, services: (hospital.services ?? []).map(toHospitalService) })
}

// GET /api/hospitals/me/capacity (hospital:profile:read)
export const getOwnCapacityController: RequestHandler = async (req, res) => {
  const capacity = await getOwnCapacity(currentUser(req))
  res.json({ success: true, capacity: toHospitalCapacity(capacity) })
}

// PATCH /api/hospitals/me/capacity — self-reported intake (hospital:profile:manage)
export const updateOwnCapacityController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const capacity = await updateOwnCapacity(actor, req.body)

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'hospital.capacity.update',
    resourceType: 'HospitalCapacity',
    resourceId: capacity.id,
    metadata: { intakeStatus: capacity.intakeStatus },
    ...requestMeta(req)
  })

  res.json({ success: true, capacity: toHospitalCapacity(capacity) })
}

// GET /api/hospitals/me/staff (hospital:staff:manage)
export const listOwnStaffController: RequestHandler = async (req, res) => {
  const staff = await listOwnStaff(currentUser(req))
  res.json({ success: true, staff: staff.map(toHospitalStaff) })
}

// POST /api/hospitals/me/staff — authorize a staff account (hospital:staff:manage)
export const authorizeStaffController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const user = await authorizeStaff(actor, req.body as AuthorizeStaffInput, requestMeta(req))
  res.status(201).json({ success: true, staff: toHospitalStaff(user) })
}

// DELETE /api/hospitals/me/staff/:id — revoke a staff account (hospital:staff:manage)
export const revokeStaffController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const user = await revokeStaff(actor, idParam(req, 'Staff'), requestMeta(req))
  res.json({ success: true, staff: toHospitalStaff(user) })
}

// GET /api/hospitals/me/incoming — inbound patient alerts (booking:read:hospital)
export const listIncomingPatientsController: RequestHandler = async (req, res) => {
  const incoming = await listIncomingPatients(currentUser(req))
  res.json({ success: true, incoming: incoming.map(toIncomingPatient) })
}
