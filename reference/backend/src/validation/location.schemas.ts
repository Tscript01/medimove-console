import { z } from 'zod'

/**
 * Request schemas for location handling and service coverage.
 *
 * Coordinates are always validated on the backend: latitude/longitude ranges,
 * finiteness and source-specific requirements. A missing coordinate is never
 * defaulted — the client must send a GPS fix, a map pin or a described landmark.
 */

/** Kept in sync with the `LocationSource` Prisma enum. */
export const LOCATION_SOURCES = ['GPS', 'MAP_PIN', 'MANUAL'] as const

const latitude = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90.')
  .max(90, 'Latitude must be between -90 and 90.')

const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.')

/** Query-string coordinates arrive as strings; coerce, but never default them. */
const queryNumber = (min: number, max: number, label: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z.number({ error: `${label} is required.` }).min(min, `${label} is out of range.`).max(max, `${label} is out of range.`)
  )

const queryLatitude = queryNumber(-90, 90, 'latitude')
const queryLongitude = queryNumber(-180, 180, 'longitude')

const accuracyMeters = z.number().nonnegative('Accuracy must be zero or greater.').max(100000).optional()
const address = z.string().trim().max(300).optional()
const landmark = z.string().trim().max(200).optional()
const label = z.string().trim().max(60).optional()

const locationFields = {
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  accuracyMeters,
  address,
  landmark,
  label,
  isPrimary: z.boolean().optional()
}

/** Enforces that coordinates are complete and match what the source requires. */
function locationInvariants(
  data: { source?: (typeof LOCATION_SOURCES)[number]; latitude?: number | null; longitude?: number | null; landmark?: string | null },
  ctx: z.RefinementCtx
): void {
  const hasLat = data.latitude !== undefined && data.latitude !== null
  const hasLng = data.longitude !== undefined && data.longitude !== null

  if (hasLat !== hasLng) {
    ctx.addIssue({ code: 'custom', path: ['longitude'], message: 'Latitude and longitude must be provided together.' })
  }

  if (data.source === 'MANUAL') {
    if (!data.landmark || !String(data.landmark).trim()) {
      ctx.addIssue({ code: 'custom', path: ['landmark'], message: 'A landmark is required for a manually described location.' })
    }
    return
  }

  // GPS and MAP_PIN both require a coordinate pair.
  if (data.source === 'GPS' || data.source === 'MAP_PIN') {
    if (!hasLat || !hasLng) {
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Coordinates are required for GPS and map-pin locations.' })
    }
  }
}

export const createLocationSchema = z
  .object({
    source: z.enum(LOCATION_SOURCES, {
      message: `Location source must be one of: ${LOCATION_SOURCES.join(', ')}.`
    }),
    ...locationFields
  })
  .superRefine(locationInvariants)

export const updateLocationSchema = z
  .object({
    source: z.enum(LOCATION_SOURCES).optional(),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
    accuracyMeters: accuracyMeters.nullable(),
    address: z.string().trim().max(300).nullable().optional(),
    landmark: z.string().trim().max(200).nullable().optional(),
    label: z.string().trim().max(60).nullable().optional(),
    isPrimary: z.boolean().optional()
  })
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update.' })
    }
    locationInvariants(data, ctx)
  })

// --- Service areas ---------------------------------------------------------

const polygonVertex = z.object({ lat: latitude, lng: longitude })

function serviceAreaInvariants(
  data: { centerLat?: number | null; centerLng?: number | null; radiusKm?: number | null; polygon?: unknown },
  ctx: z.RefinementCtx
): void {
  const hasPolygon = Array.isArray(data.polygon) && data.polygon.length >= 3
  const circleParts = [data.centerLat, data.centerLng, data.radiusKm].filter((v) => v !== undefined && v !== null)
  const hasCircle = circleParts.length === 3

  if (circleParts.length > 0 && !hasCircle) {
    ctx.addIssue({
      code: 'custom',
      path: ['radiusKm'],
      message: 'A circular area needs centerLat, centerLng and radiusKm together.'
    })
  }

  if (!hasCircle && !hasPolygon) {
    ctx.addIssue({
      code: 'custom',
      path: ['polygon'],
      message: 'Provide either a center + radiusKm or a polygon of at least 3 points.'
    })
  }
}

export const createServiceAreaSchema = z
  .object({
    stateId: z.string().trim().min(1, 'A state is required.'),
    name: z.string().trim().min(2, 'A name is required.').max(120),
    centerLat: latitude.optional(),
    centerLng: longitude.optional(),
    radiusKm: z.number().positive('Radius must be greater than zero.').max(2000).optional(),
    polygon: z.array(polygonVertex).min(3, 'A polygon needs at least 3 points.').max(500).optional(),
    isActive: z.boolean().optional()
  })
  .superRefine(serviceAreaInvariants)

export const updateServiceAreaSchema = z
  .object({
    name: z.string().trim().min(2, 'A name is required.').max(120).optional(),
    centerLat: latitude.nullable().optional(),
    centerLng: longitude.nullable().optional(),
    radiusKm: z.number().positive('Radius must be greater than zero.').max(2000).nullable().optional(),
    polygon: z.array(polygonVertex).min(3, 'A polygon needs at least 3 points.').max(500).nullable().optional(),
    isActive: z.boolean().optional()
  })
  .superRefine((data, ctx) => {
    if (Object.keys(data).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update.' })
    }
    // The coverage shape is validated against the *merged* record in
    // serviceAreaService, because a partial update may only supply one of the
    // centre/radius values while the rest are inherited from the existing area.
  })

// --- States ----------------------------------------------------------------

export const createStateSchema = z.object({
  name: z.string().trim().min(2, 'A state name is required.').max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'A short state code is required (e.g. EK).')
})

export const updateStateSchema = z
  .object({
    name: z.string().trim().min(2, 'A state name is required.').max(80).optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,10}$/, 'A short state code is required (e.g. EK).')
      .optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' })

// --- Queries ---------------------------------------------------------------

export const coordinateQuerySchema = z.object({ latitude: queryLatitude, longitude: queryLongitude })

/** Fleet listing query. Coordinates are required — there is no default location. */
export const fleetQuerySchema = z.object({ lat: queryLatitude, lng: queryLongitude })

export const distanceQuerySchema = z.object({
  fromLatitude: queryLatitude,
  fromLongitude: queryLongitude,
  toLatitude: queryLatitude,
  toLongitude: queryLongitude
})

export const geocodeSearchQuerySchema = z
  .object({
    q: z.string().trim().min(3, 'Enter at least 3 characters to search.').max(120),
    limit: z.coerce.number().int().min(1).max(10).optional(),
    // Optional proximity bias. These are query-string coordinates, so coerce
    // them like the other location query schemas. They are never stored as a
    // pickup — they only improve local search ranking.
    latitude: queryLatitude.optional(),
    longitude: queryLongitude.optional()
  })
  .refine(
    (data) => (data.latitude === undefined) === (data.longitude === undefined),
    {
      message: 'latitude and longitude must be provided together.',
      path: ['longitude']
    }
  )

export type CreateLocationInput = z.infer<typeof createLocationSchema>
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>
export type CreateServiceAreaInput = z.infer<typeof createServiceAreaSchema>
export type UpdateServiceAreaInput = z.infer<typeof updateServiceAreaSchema>
export type CreateStateInput = z.infer<typeof createStateSchema>
export type UpdateStateInput = z.infer<typeof updateStateSchema>
