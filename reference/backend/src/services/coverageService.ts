import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { haversineDistanceKm, pointInPolygon, roundKm, type LatLng } from '../utils/geo'

/**
 * Service-coverage evaluation.
 *
 * A point is covered when it falls inside at least one *active* service area.
 * Areas are either circles (centre + radius) or polygons. Coverage is only
 * enforced once at least one active area exists: before any area is configured
 * `configured` is false and callers may proceed (the result is still reported so
 * the gap is visible).
 */

interface ServiceAreaRow {
  id: string
  name: string
  stateId: string
  centerLat: number | null
  centerLng: number | null
  radiusKm: number | null
  polygon: unknown
  isActive: boolean
  state?: { id: string; name: string } | null
}

export interface CoverageResult {
  covered: boolean
  /** Whether any active service area exists to test the point against. */
  configured: boolean
  stateId: string | null
  stateName: string | null
  serviceAreaId: string | null
  serviceAreaName: string | null
  matchedBy: 'polygon' | 'radius' | null
  /** Distance to the nearest area centre when the point is not covered. */
  nearestAreaKm: number | null
  nearestAreaId: string | null
}

function parsePolygon(raw: unknown): LatLng[] {
  if (!Array.isArray(raw)) return []
  const vertices: LatLng[] = []
  for (const vertex of raw) {
    if (vertex && typeof vertex === 'object' && Number.isFinite((vertex as any).lat) && Number.isFinite((vertex as any).lng)) {
      vertices.push({ lat: Number((vertex as any).lat), lng: Number((vertex as any).lng) })
    }
  }
  return vertices
}

/** Centroid of a polygon (vertex average) — only used for the "nearest" hint. */
function polygonCentroid(vertices: LatLng[]): LatLng {
  const sum = vertices.reduce((acc, v) => ({ lat: acc.lat + v.lat, lng: acc.lng + v.lng }), { lat: 0, lng: 0 })
  return { lat: sum.lat / vertices.length, lng: sum.lng / vertices.length }
}

function evaluateArea(
  area: ServiceAreaRow,
  point: LatLng
): { inside: boolean; matchedBy: 'polygon' | 'radius' | null; reference: LatLng | null } {
  const vertices = parsePolygon(area.polygon)
  if (vertices.length >= 3) {
    return { inside: pointInPolygon(point, vertices), matchedBy: 'polygon', reference: polygonCentroid(vertices) }
  }
  if (area.centerLat !== null && area.centerLng !== null && area.radiusKm !== null) {
    const center = { lat: area.centerLat, lng: area.centerLng }
    const distance = haversineDistanceKm(center.lat, center.lng, point.lat, point.lng)
    return { inside: distance <= area.radiusKm, matchedBy: 'radius', reference: center }
  }
  return { inside: false, matchedBy: null, reference: null }
}

/** Resolves whether a coordinate is inside the configured service coverage. */
export async function resolveCoverage(latitude: number, longitude: number): Promise<CoverageResult> {
  const areas = (await prisma.serviceArea.findMany({
    where: { isActive: true },
    include: { state: true }
  })) as ServiceAreaRow[]

  const point: LatLng = { lat: latitude, lng: longitude }
  const configured = areas.length > 0

  let nearestAreaKm: number | null = null
  let nearestAreaId: string | null = null

  for (const area of areas) {
    const { inside, matchedBy, reference } = evaluateArea(area, point)
    if (inside) {
      return {
        covered: true,
        configured,
        stateId: area.stateId,
        stateName: area.state?.name ?? null,
        serviceAreaId: area.id,
        serviceAreaName: area.name,
        matchedBy,
        nearestAreaKm: 0,
        nearestAreaId: area.id
      }
    }
    if (reference) {
      const distance = haversineDistanceKm(reference.lat, reference.lng, point.lat, point.lng)
      if (nearestAreaKm === null || distance < nearestAreaKm) {
        nearestAreaKm = distance
        nearestAreaId = area.id
      }
    }
  }

  return {
    covered: false,
    configured,
    stateId: null,
    stateName: null,
    serviceAreaId: null,
    serviceAreaName: null,
    matchedBy: null,
    nearestAreaKm: nearestAreaKm === null ? null : roundKm(nearestAreaKm),
    nearestAreaId
  }
}

/**
 * Throws 422 when a coordinate is outside configured coverage. When no service
 * area is configured yet, coverage cannot be enforced and the point is allowed
 * (the caller can still record `configured: false`).
 */
export async function assertInCoverage(latitude: number, longitude: number): Promise<CoverageResult> {
  const result = await resolveCoverage(latitude, longitude)
  if (result.configured && !result.covered) {
    throw new AppError(422, "This location is outside MediMove's service area.", {
      code: 'LOCATION_OUT_OF_COVERAGE',
      nearestAreaKm: result.nearestAreaKm
    })
  }
  return result
}

/**
 * Best-effort coverage enrichment for a stored location: resolves the state and
 * service area a coordinate falls in, or `null`s when it is outside coverage.
 * Never throws — coverage is informational when persisting a place.
 */
export async function coverageColumns(
  latitude: number | null,
  longitude: number | null
): Promise<{ stateId: string | null; serviceAreaId: string | null }> {
  if (latitude === null || longitude === null) return { stateId: null, serviceAreaId: null }
  const coverage = await resolveCoverage(latitude, longitude)
  return {
    stateId: coverage.covered ? coverage.stateId : null,
    serviceAreaId: coverage.covered ? coverage.serviceAreaId : null
  }
}
