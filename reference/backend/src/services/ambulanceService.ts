import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import type { CreateAmbulanceInput, UpdateAmbulanceInput } from '../validation/provider.schemas'

/**
 * Ambulance (vehicle) management, scoped to the owning provider.
 *
 * A vehicle is registered by its provider and then reviewed: only a `VERIFIED`,
 * active vehicle may be dispatched. Current location and availability are
 * updated separately from profile data.
 */

function ambulanceNotFound(): AppError {
  return new AppError(404, 'Ambulance not found.', { code: 'AMBULANCE_NOT_FOUND' })
}

export async function listAmbulances(providerId: string) {
  return prisma.ambulance.findMany({ where: { providerId }, orderBy: [{ createdAt: 'desc' }] })
}

export async function getAmbulance(id: string) {
  const ambulance = await prisma.ambulance.findUnique({ where: { id } })
  if (!ambulance) throw ambulanceNotFound()
  return ambulance
}

async function loadOwned(providerId: string, id: string) {
  const ambulance = await prisma.ambulance.findUnique({ where: { id } })
  if (!ambulance || ambulance.providerId !== providerId) throw ambulanceNotFound()
  return ambulance
}

export async function createAmbulance(providerId: string, input: CreateAmbulanceInput) {
  const duplicate = await prisma.ambulance.findUnique({ where: { registrationNumber: input.registrationNumber } })
  if (duplicate) {
    throw new AppError(409, 'An ambulance with that registration number already exists.', {
      code: 'AMBULANCE_EXISTS',
      field: 'registrationNumber'
    })
  }

  const hasLat = input.currentLatitude !== undefined
  const hasLng = input.currentLongitude !== undefined
  if (hasLat !== hasLng) {
    throw new AppError(400, 'Latitude and longitude must be provided together.', {
      code: 'VALIDATION_ERROR',
      field: 'currentLongitude'
    })
  }

  return prisma.ambulance.create({
    data: {
      providerId,
      registrationNumber: input.registrationNumber,
      vehicleType: input.vehicleType,
      category: input.category,
      availability: input.availability ?? 'OFFLINE',
      currentLatitude: input.currentLatitude ?? null,
      currentLongitude: input.currentLongitude ?? null,
      currentLocationUpdatedAt: hasLat ? new Date() : null,
      status: 'PENDING'
    }
  })
}

export async function updateAmbulance(providerId: string, id: string, input: UpdateAmbulanceInput) {
  await loadOwned(providerId, id)

  if (input.registrationNumber) {
    const duplicate = await prisma.ambulance.findUnique({ where: { registrationNumber: input.registrationNumber } })
    if (duplicate && duplicate.id !== id) {
      throw new AppError(409, 'An ambulance with that registration number already exists.', {
        code: 'AMBULANCE_EXISTS',
        field: 'registrationNumber'
      })
    }
  }

  return prisma.ambulance.update({ where: { id }, data: { ...input } })
}

export async function deleteAmbulance(providerId: string, id: string) {
  await loadOwned(providerId, id)
  await prisma.ambulance.delete({ where: { id } })
}

export async function updateAmbulanceLocation(
  providerId: string,
  id: string,
  latitude: number,
  longitude: number
) {
  await loadOwned(providerId, id)
  return prisma.ambulance.update({
    where: { id },
    data: { currentLatitude: latitude, currentLongitude: longitude, currentLocationUpdatedAt: new Date() }
  })
}

export async function setAmbulanceAvailability(
  providerId: string,
  id: string,
  availability: 'AVAILABLE' | 'ON_DUTY' | 'OFFLINE' | 'UNAVAILABLE'
) {
  await loadOwned(providerId, id)
  return prisma.ambulance.update({ where: { id }, data: { availability } })
}

/** Reviewer decision for a vehicle. Rejecting a vehicle also marks it inactive. */
export async function verifyAmbulance(id: string, actorId: string, decision: 'VERIFIED' | 'REJECTED', reason?: string) {
  await getAmbulance(id)
  const data =
    decision === 'VERIFIED'
      ? { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: actorId, rejectedAt: null, rejectionReason: null }
      : { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason ?? null, isActive: false }
  return prisma.ambulance.update({ where: { id }, data })
}
