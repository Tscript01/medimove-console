import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { AppError } from '../errors/AppError'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { geocodingService } from '../services/geocodingService'
import { resolveCoverage } from '../services/coverageService'
import {
  createLocation,
  deleteLocation,
  getLocation,
  listLocations,
  setPrimaryLocation,
  updateLocation
} from '../services/locationService'
import { listStates } from '../services/serviceAreaService'
import { requestMeta } from '../utils/requestMeta'
import { haversineDistanceKm, roundKm } from '../utils/geo'
import { toState, toUserLocation } from '../utils/serializers'
import { coordinateQuerySchema, distanceQuerySchema, geocodeSearchQuerySchema } from '../validation/location.schemas'

function locationId(req: { params: Record<string, unknown> }): string {
  const id = String(req.params.id ?? '')
  if (!id) throw new AppError(400, 'Location id is required.', { code: 'VALIDATION_ERROR', field: 'id' })
  return id
}

/** Audit helper: records that a location changed without logging its coordinates. */
async function auditLocation(
  req: Parameters<RequestHandler>[0],
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>
) {
  const actor = currentUser(req)
  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action,
    resourceType: 'UserLocation',
    resourceId,
    metadata,
    ...requestMeta(req)
  })
}

// GET /api/locations
export const listLocationsController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const locations = await listLocations(userId)
  res.json({ success: true, locations: locations.map(toUserLocation) })
}

// POST /api/locations
export const createLocationController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const location = await createLocation(userId, req.body)
  await auditLocation(req, 'location.create', location.id, {
    source: location.source,
    label: location.label ?? null,
    hasCoordinates: location.latitude !== null && location.longitude !== null
  })
  res.status(201).json({ success: true, location: toUserLocation(location) })
}

// GET /api/locations/:id
export const getLocationController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const location = await getLocation(userId, locationId(req))
  res.json({ success: true, location: toUserLocation(location) })
}

// PATCH /api/locations/:id
export const updateLocationController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const location = await updateLocation(userId, locationId(req), req.body)
  await auditLocation(req, 'location.update', location.id, { fields: Object.keys(req.body) })
  res.json({ success: true, location: toUserLocation(location) })
}

// DELETE /api/locations/:id
export const deleteLocationController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const id = locationId(req)
  await deleteLocation(userId, id)
  await auditLocation(req, 'location.delete', id, {})
  res.json({ success: true, message: 'Location removed.' })
}

// POST /api/locations/:id/primary
export const setPrimaryLocationController: RequestHandler = async (req, res) => {
  const { userId } = currentUser(req)
  const location = await setPrimaryLocation(userId, locationId(req))
  res.json({ success: true, location: toUserLocation(location) })
}

// GET /api/locations/coverage?latitude=&longitude=
export const checkCoverageController: RequestHandler = async (req, res) => {
  const { latitude, longitude } = parseOrThrow(coordinateQuerySchema, req.query, 'query')
  const coverage = await resolveCoverage(latitude, longitude)
  res.json({ success: true, coverage })
}

// GET /api/locations/distance?fromLatitude=&fromLongitude=&toLatitude=&toLongitude=
export const distanceController: RequestHandler = async (req, res) => {
  const { fromLatitude, fromLongitude, toLatitude, toLongitude } = parseOrThrow(
    distanceQuerySchema,
    req.query,
    'query'
  )
  // Computed server-side so a client-supplied distance is never trusted.
  const km = haversineDistanceKm(fromLatitude, fromLongitude, toLatitude, toLongitude)
  res.json({ success: true, distanceKm: roundKm(km), distanceMeters: Math.round(km * 1000) })
}

// GET /api/locations/reverse-geocode?latitude=&longitude=
export const reverseGeocodeController: RequestHandler = async (req, res) => {
  const { latitude, longitude } = parseOrThrow(coordinateQuerySchema, req.query, 'query')
  const result = await geocodingService.reverse(latitude, longitude)
  res.json({ success: true, provider: geocodingService.providerName, result })
}

// GET /api/locations/search?q=&limit=
export const geocodeSearchController: RequestHandler = async (req, res) => {
  const { q, limit, latitude, longitude } = parseOrThrow(geocodeSearchQuerySchema, req.query, 'query')
  const results = await geocodingService.search(q, limit ?? 5, { latitude, longitude })
  res.json({ success: true, provider: geocodingService.providerName, results })
}

// GET /api/states — reference data for clients building location forms.
export const listStatesController: RequestHandler = async (_req, res) => {
  const states = await listStates()
  res.json({ success: true, states: states.map(toState) })
}
