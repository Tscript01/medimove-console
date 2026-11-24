import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import type { LocationSource } from '../generated/prisma/enums'
import { coverageColumns } from './coverageService'
import type { CreateLocationInput, UpdateLocationInput } from '../validation/location.schemas'

/**
 * User locations (saved places and recent fixes).
 *
 * Every function is strictly owner-scoped: a location id alone is never enough
 * to read or mutate a row. The `source` is preserved so consumers can tell a
 * GPS fix from a map pin from a user's own description, and source-specific
 * invariants are re-checked here (defence in depth behind the request schema).
 */

interface LocationState {
  source: LocationSource
  latitude: number | null
  longitude: number | null
  landmark: string | null
}

function notFound(): AppError {
  return new AppError(404, 'Location not found.', { code: 'LOCATION_NOT_FOUND' })
}

function validationError(message: string, field: string): AppError {
  return new AppError(400, message, { code: 'VALIDATION_ERROR', field })
}

/** Re-asserts the invariants for the *final* state (matters for partial updates). */
function assertLocationState(state: LocationState): void {
  const hasLat = state.latitude !== null && state.latitude !== undefined
  const hasLng = state.longitude !== null && state.longitude !== undefined

  if (hasLat !== hasLng) {
    throw validationError('Latitude and longitude must be provided together.', 'longitude')
  }

  if (state.source === 'MANUAL') {
    if (!state.landmark || !state.landmark.trim()) {
      throw validationError('A landmark is required for a manually described location.', 'landmark')
    }
    return
  }

  if (!hasLat || !hasLng) {
    throw validationError('Coordinates are required for GPS and map-pin locations.', 'latitude')
  }
}

/** Loads a location only if it belongs to `userId`; otherwise 404 (never 403). */
async function loadOwned(userId: string, id: string) {
  const location = await prisma.userLocation.findUnique({ where: { id } })
  if (!location || location.userId !== userId) throw notFound()
  return location
}

export async function listLocations(userId: string) {
  return prisma.userLocation.findMany({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }]
  })
}

export async function getLocation(userId: string, id: string) {
  return loadOwned(userId, id)
}

export async function createLocation(userId: string, input: CreateLocationInput) {
  const latitude = input.latitude ?? null
  const longitude = input.longitude ?? null
  assertLocationState({ source: input.source, latitude, longitude, landmark: input.landmark ?? null })

  const existing = await prisma.userLocation.count({ where: { userId } })
  const isPrimary = input.isPrimary === true || existing === 0
  const coverage = await coverageColumns(latitude, longitude)

  return prisma.$transaction(async (tx: any) => {
    if (isPrimary) {
      await tx.userLocation.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })
    }
    return tx.userLocation.create({
      data: {
        userId,
        source: input.source,
        latitude,
        longitude,
        accuracyMeters: input.accuracyMeters ?? null,
        address: input.address ?? null,
        landmark: input.landmark ?? null,
        label: input.label ?? null,
        stateId: coverage.stateId,
        serviceAreaId: coverage.serviceAreaId,
        isPrimary
      }
    })
  })
}

export async function updateLocation(userId: string, id: string, input: UpdateLocationInput) {
  const existing = await loadOwned(userId, id)

  const latitude = input.latitude !== undefined ? input.latitude : existing.latitude
  const longitude = input.longitude !== undefined ? input.longitude : existing.longitude
  const landmark = input.landmark !== undefined ? input.landmark : existing.landmark
  const source = (input.source ?? existing.source) as LocationSource

  assertLocationState({ source, latitude, longitude, landmark })

  const data: Record<string, unknown> = {}
  if (input.source !== undefined) data.source = input.source
  if (input.latitude !== undefined) data.latitude = input.latitude
  if (input.longitude !== undefined) data.longitude = input.longitude
  if (input.accuracyMeters !== undefined) data.accuracyMeters = input.accuracyMeters
  if (input.address !== undefined) data.address = input.address
  if (input.landmark !== undefined) data.landmark = input.landmark
  if (input.label !== undefined) data.label = input.label

  const coverage = await coverageColumns(latitude, longitude)
  data.stateId = coverage.stateId
  data.serviceAreaId = coverage.serviceAreaId

  return prisma.$transaction(async (tx: any) => {
    if (input.isPrimary === true) {
      await tx.userLocation.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })
    }
    if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary
    return tx.userLocation.update({ where: { id }, data })
  })
}

export async function deleteLocation(userId: string, id: string) {
  const location = await loadOwned(userId, id)

  await prisma.$transaction(async (tx: any) => {
    await tx.userLocation.delete({ where: { id } })
    if (location.isPrimary) {
      const remaining = await tx.userLocation.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }] })
      if (remaining[0]) {
        await tx.userLocation.update({ where: { id: remaining[0].id }, data: { isPrimary: true } })
      }
    }
  })
}

export async function setPrimaryLocation(userId: string, id: string) {
  await loadOwned(userId, id)

  return prisma.$transaction(async (tx: any) => {
    await tx.userLocation.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })
    return tx.userLocation.update({ where: { id }, data: { isPrimary: true } })
  })
}
