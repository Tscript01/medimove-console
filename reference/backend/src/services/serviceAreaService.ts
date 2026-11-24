import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import type { CreateServiceAreaInput, CreateStateInput, UpdateServiceAreaInput, UpdateStateInput } from '../validation/location.schemas'

/**
 * Administrative configuration of states and service areas.
 *
 * State admins are restricted to their own state by the controller, which passes
 * an explicit scope filter in — these functions never widen scope on their own.
 */

function validationError(message: string, field: string): AppError {
  return new AppError(400, message, { code: 'VALIDATION_ERROR', field })
}

interface ServiceAreaShape {
  centerLat: number | null
  centerLng: number | null
  radiusKm: number | null
  polygon: unknown
}

function hasPolygon(polygon: unknown): boolean {
  return Array.isArray(polygon) && polygon.length >= 3
}

function assertServiceAreaShape(shape: ServiceAreaShape): void {
  const circleParts = [shape.centerLat, shape.centerLng, shape.radiusKm].filter((v) => v !== null && v !== undefined)
  if (circleParts.length > 0 && circleParts.length < 3) {
    throw validationError('A circular area needs centerLat, centerLng and radiusKm together.', 'radiusKm')
  }
  if (circleParts.length < 3 && !hasPolygon(shape.polygon)) {
    throw validationError('Provide either a center + radiusKm or a polygon of at least 3 points.', 'polygon')
  }
}

// --- Service areas ---------------------------------------------------------

export async function listServiceAreas(filter: { stateId?: string | null } = {}) {
  return prisma.serviceArea.findMany({
    where: filter.stateId ? { stateId: filter.stateId } : {},
    include: { state: true },
    orderBy: [{ createdAt: 'desc' }]
  })
}

export async function getServiceArea(id: string) {
  return prisma.serviceArea.findUnique({ where: { id } })
}

export async function createServiceArea(input: CreateServiceAreaInput) {
  const state = await prisma.state.findUnique({ where: { id: input.stateId } })
  if (!state) throw validationError('Unknown stateId.', 'stateId')

  const shape: ServiceAreaShape = {
    centerLat: input.centerLat ?? null,
    centerLng: input.centerLng ?? null,
    radiusKm: input.radiusKm ?? null,
    polygon: input.polygon ?? null
  }
  assertServiceAreaShape(shape)

  return prisma.serviceArea.create({
    data: {
      stateId: input.stateId,
      name: input.name,
      centerLat: shape.centerLat,
      centerLng: shape.centerLng,
      radiusKm: shape.radiusKm,
      polygon: shape.polygon as any,
      isActive: input.isActive ?? true
    }
  })
}

export async function updateServiceArea(id: string, input: UpdateServiceAreaInput) {
  const existing = await prisma.serviceArea.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Service area not found.', { code: 'SERVICE_AREA_NOT_FOUND' })

  const shape: ServiceAreaShape = {
    centerLat: input.centerLat !== undefined ? input.centerLat : existing.centerLat,
    centerLng: input.centerLng !== undefined ? input.centerLng : existing.centerLng,
    radiusKm: input.radiusKm !== undefined ? input.radiusKm : existing.radiusKm,
    polygon: input.polygon !== undefined ? input.polygon : existing.polygon
  }
  assertServiceAreaShape(shape)

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.centerLat !== undefined) data.centerLat = input.centerLat
  if (input.centerLng !== undefined) data.centerLng = input.centerLng
  if (input.radiusKm !== undefined) data.radiusKm = input.radiusKm
  if (input.polygon !== undefined) data.polygon = input.polygon

  return prisma.serviceArea.update({ where: { id }, data })
}

export async function deleteServiceArea(id: string) {
  const existing = await prisma.serviceArea.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'Service area not found.', { code: 'SERVICE_AREA_NOT_FOUND' })
  // Locations referencing the area have their serviceAreaId set to null (FK SetNull).
  await prisma.serviceArea.delete({ where: { id } })
}

// --- States ----------------------------------------------------------------

export async function listStates() {
  return prisma.state.findMany({ orderBy: [{ name: 'asc' }] })
}

export async function createState(input: CreateStateInput) {
  return prisma.state.create({ data: { name: input.name, code: input.code } })
}

export async function updateState(id: string, input: UpdateStateInput) {
  const existing = await prisma.state.findUnique({ where: { id } })
  if (!existing) throw new AppError(404, 'State not found.', { code: 'STATE_NOT_FOUND' })
  return prisma.state.update({ where: { id }, data: { ...input } })
}
