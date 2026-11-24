import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { Role } from '../auth/permissions'
import { coverageColumns } from './coverageService'
import type {
  ApplyProviderInput,
  ProviderLocationInput,
  UpdateProviderInput,
  UpdateProviderLocationInput
} from '../validation/provider.schemas'

/**
 * Provider (ambulance operator) lifecycle and configuration.
 *
 * A provider is created by an application, then verified and activated by a
 * reviewer. Only a provider that is both `VERIFIED` and `ACTIVE` is eligible for
 * dispatch. Provider-scoped functions take an explicit `providerId`; callers
 * must have resolved it from the authenticated user, never from request input.
 */

export function providerNotFound(): AppError {
  return new AppError(404, 'Provider not found.', { code: 'PROVIDER_NOT_FOUND' })
}

function validationError(message: string, field: string): AppError {
  return new AppError(400, message, { code: 'VALIDATION_ERROR', field })
}

async function assertStateExists(stateId?: string | null): Promise<void> {
  if (!stateId) return
  const state = await prisma.state.findUnique({ where: { id: stateId } })
  if (!state) throw validationError('Unknown stateId.', 'stateId')
}

// --- Registration & profile ------------------------------------------------

/**
 * Applies to register a provider. The applicant becomes its PROVIDER_ADMIN and
 * the new provider starts `PENDING`/unverified — never dispatchable until a
 * reviewer verifies and activates it.
 */
export async function applyProvider(userId: string, input: ApplyProviderInput) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })
  if (user.providerId) {
    throw new AppError(409, 'You already belong to a provider.', { code: 'PROVIDER_ALREADY_EXISTS' })
  }
  await assertStateExists(input.stateId)

  return prisma.$transaction(async (tx: any) => {
    const provider = await tx.ambulanceProvider.create({
      data: {
        name: input.name,
        phone: input.phone,
        vehicleType: input.vehicleType,
        baseFareKobo: input.baseFareKobo,
        ratePerKmKobo: input.ratePerKmKobo,
        latitude: input.latitude,
        longitude: input.longitude,
        stateId: input.stateId ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        contactName: input.contactName ?? null,
        registrationNumber: input.registrationNumber ?? null,
        isSimulated: false,
        availableStatus: true,
        status: 'PENDING',
        verificationStatus: 'PENDING'
      }
    })

    await tx.user.update({
      where: { id: userId },
      data: { role: Role.PROVIDER_ADMIN, providerId: provider.id, stateId: input.stateId ?? user.stateId ?? null }
    })

    return provider
  })
}

export async function getOwnProvider(providerId: string | null) {
  if (!providerId) throw providerNotFound()
  const provider = await prisma.ambulanceProvider.findUnique({ where: { id: providerId } })
  if (!provider) throw providerNotFound()
  return provider
}

export async function updateOwnProvider(providerId: string | null, input: UpdateProviderInput) {
  const provider = await getOwnProvider(providerId)
  return prisma.ambulanceProvider.update({ where: { id: provider.id }, data: { ...input } })
}

// --- Operating locations ---------------------------------------------------

export async function listProviderLocations(providerId: string) {
  return prisma.providerOperatingLocation.findMany({
    where: { providerId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }]
  })
}

export async function createProviderLocation(providerId: string, input: ProviderLocationInput) {
  await assertStateExists(input.stateId)
  const existing = await prisma.providerOperatingLocation.count({ where: { providerId } })
  const isPrimary = input.isPrimary === true || existing === 0
  const coverage = await coverageColumns(input.latitude, input.longitude)

  return prisma.$transaction(async (tx: any) => {
    if (isPrimary) {
      await tx.providerOperatingLocation.updateMany({ where: { providerId, isPrimary: true }, data: { isPrimary: false } })
    }
    return tx.providerOperatingLocation.create({
      data: {
        providerId,
        label: input.label ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address ?? null,
        landmark: input.landmark ?? null,
        stateId: input.stateId ?? coverage.stateId,
        serviceAreaId: input.serviceAreaId ?? coverage.serviceAreaId,
        isPrimary
      }
    })
  })
}

async function loadOwnedLocation(providerId: string, id: string) {
  const location = await prisma.providerOperatingLocation.findUnique({ where: { id } })
  if (!location || location.providerId !== providerId) {
    throw new AppError(404, 'Operating location not found.', { code: 'PROVIDER_LOCATION_NOT_FOUND' })
  }
  return location
}

export async function updateProviderLocation(providerId: string, id: string, input: UpdateProviderLocationInput) {
  const existing = await loadOwnedLocation(providerId, id)
  await assertStateExists(input.stateId)

  const latitude = input.latitude !== undefined ? input.latitude : existing.latitude
  const longitude = input.longitude !== undefined ? input.longitude : existing.longitude
  const coverage = await coverageColumns(latitude, longitude)

  const data: Record<string, unknown> = {}
  for (const key of ['label', 'address', 'landmark', 'stateId', 'serviceAreaId', 'latitude', 'longitude'] as const) {
    if ((input as Record<string, unknown>)[key] !== undefined) data[key] = (input as Record<string, unknown>)[key]
  }
  if (data.stateId === undefined) data.stateId = coverage.stateId
  if (data.serviceAreaId === undefined) data.serviceAreaId = coverage.serviceAreaId

  return prisma.$transaction(async (tx: any) => {
    if (input.isPrimary === true) {
      await tx.providerOperatingLocation.updateMany({ where: { providerId, isPrimary: true }, data: { isPrimary: false } })
    }
    if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary
    return tx.providerOperatingLocation.update({ where: { id }, data })
  })
}

export async function deleteProviderLocation(providerId: string, id: string) {
  const location = await loadOwnedLocation(providerId, id)
  await prisma.$transaction(async (tx: any) => {
    await tx.providerOperatingLocation.delete({ where: { id } })
    if (location.isPrimary) {
      const remaining = await tx.providerOperatingLocation.findMany({
        where: { providerId },
        orderBy: [{ createdAt: 'asc' }]
      })
      if (remaining[0]) {
        await tx.providerOperatingLocation.update({ where: { id: remaining[0].id }, data: { isPrimary: true } })
      }
    }
  })
}

// --- Service areas ---------------------------------------------------------

export async function listProviderServiceAreas(providerId: string) {
  return prisma.providerServiceArea.findMany({ where: { providerId }, orderBy: [{ createdAt: 'desc' }] })
}

export async function linkProviderServiceArea(providerId: string, serviceAreaId: string) {
  const area = await prisma.serviceArea.findUnique({ where: { id: serviceAreaId } })
  if (!area) throw validationError('Unknown serviceAreaId.', 'serviceAreaId')

  const existing = await prisma.providerServiceArea.findFirst({ where: { providerId, serviceAreaId } })
  if (existing) return existing

  return prisma.providerServiceArea.create({ data: { providerId, serviceAreaId } })
}

export async function unlinkProviderServiceArea(providerId: string, id: string) {
  const link = await prisma.providerServiceArea.findUnique({ where: { id } })
  if (!link || link.providerId !== providerId) {
    throw new AppError(404, 'Service-area link not found.', { code: 'PROVIDER_SERVICE_AREA_NOT_FOUND' })
  }
  await prisma.providerServiceArea.delete({ where: { id } })
}

// --- Verification & activation (reviewers) ---------------------------------

async function loadProvider(id: string) {
  const provider = await prisma.ambulanceProvider.findUnique({ where: { id } })
  if (!provider) throw providerNotFound()
  return provider
}

export async function verifyProvider(id: string, actorId: string, decision: 'VERIFIED' | 'REJECTED', reason?: string) {
  await loadProvider(id)
  const data =
    decision === 'VERIFIED'
      ? {
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
          verifiedById: actorId,
          rejectedAt: null,
          rejectionReason: null
        }
      : {
          verificationStatus: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: reason ?? null,
          verifiedAt: null,
          verifiedById: null,
          // A rejected provider can never remain active.
          status: 'REJECTED'
        }
  return prisma.ambulanceProvider.update({ where: { id }, data })
}

/** Activates or suspends a provider. Activation requires prior verification. */
export async function setProviderStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) {
  const provider = await loadProvider(id)

  if (status === 'ACTIVE') {
    if (provider.verificationStatus !== 'VERIFIED') {
      throw new AppError(409, 'A provider must be verified before it can be activated.', {
        code: 'PROVIDER_NOT_VERIFIED'
      })
    }
    return prisma.ambulanceProvider.update({
      where: { id },
      data: { status: 'ACTIVE', suspendedAt: null, suspensionReason: null }
    })
  }

  return prisma.ambulanceProvider.update({
    where: { id },
    data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason ?? null }
  })
}

// --- Admin listings --------------------------------------------------------

export async function listProviders(filter: { stateId?: string | null } = {}) {
  return prisma.ambulanceProvider.findMany({
    where: filter.stateId ? { stateId: filter.stateId } : {},
    orderBy: [{ createdAt: 'desc' }]
  })
}

export async function getProvider(id: string) {
  return loadProvider(id)
}
