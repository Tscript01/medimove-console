import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { Role } from '../auth/permissions'
import { haversineDistanceKm, roundKm } from '../utils/geo'
import { coverageColumns } from './coverageService'
import type {
  CreatePricingConfigInput,
  EstimateFareInput,
  ListPricingQuery,
  UpdatePricingConfigInput
} from '../validation/pricing.schemas'

/**
 * Server-authoritative, database-backed pricing.
 *
 * A `PricingConfig` rule matches a trip by any combination of provider / state /
 * service area / vehicle category. The most specific matching rule wins; when no
 * rule matches, the fare falls back to the provider's own `baseFareKobo` /
 * `ratePerKmKobo` so existing behaviour is preserved.
 *
 * No amount ever comes from a client: estimates and bookings are computed here
 * from stored rules and a server-computed distance.
 */

export interface PricingContext {
  providerId?: string | null
  stateId?: string | null
  serviceAreaId?: string | null
  vehicleCategory?: string | null
  now?: Date
}

export interface FareLineItem {
  code: string
  label: string
  amountKobo: number
}

export interface FareDiscount extends FareLineItem {
  type: 'FIXED' | 'PERCENT'
  value: number
}

export interface FareBreakdown {
  currency: string
  distanceKm: number
  durationMinutes: number
  baseFareKobo: number
  distanceChargeKobo: number
  timeChargeKobo: number
  perKmKobo: number
  perMinuteKobo: number
  /** Legacy alias of `perKmKobo`, kept for older clients. */
  ratePerKmKobo: number
  extraCharges: FareLineItem[]
  extrasTotalKobo: number
  subtotalKobo: number
  discounts: FareDiscount[]
  discountTotalKobo: number
  minimumFareKobo: number
  minimumApplied: boolean
  totalKobo: number
  /** Legacy alias of `totalKobo`. */
  estimatedFareKobo: number
  pricingConfigId: string | null
  pricingConfigName: string | null
  computedAt: string
}

export interface FareResult {
  estimatedFareKobo: number
  breakdown: FareBreakdown
}

interface ProviderRate {
  id?: string
  baseFareKobo: number
  ratePerKmKobo: number
}

// --- JSON helpers ----------------------------------------------------------

function asArray(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw as Record<string, any>[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as Record<string, any>[]) : []
    } catch {
      return []
    }
  }
  return []
}

function toInt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export function parseExtraCharges(raw: unknown): FareLineItem[] {
  return asArray(raw)
    .filter((c) => c && typeof c.code === 'string')
    .map((c) => ({
      code: String(c.code),
      label: typeof c.label === 'string' ? c.label : String(c.code),
      amountKobo: toInt(c.amountKobo)
    }))
}

export function parseDiscounts(raw: unknown): Omit<FareDiscount, 'amountKobo'>[] {
  return asArray(raw)
    .filter((d) => d && typeof d.code === 'string' && (d.type === 'FIXED' || d.type === 'PERCENT'))
    .map((d) => ({
      code: String(d.code),
      label: typeof d.label === 'string' ? d.label : String(d.code),
      type: d.type as 'FIXED' | 'PERCENT',
      value: Number(d.value) || 0
    }))
}

// --- Resolution ------------------------------------------------------------

/**
 * Specificity weight of a rule's scope. A narrower axis wins over a broader one:
 * provider > service area > state > vehicle category. The sum means, e.g., a
 * provider rule beats a state rule, and a state + service-area rule beats a
 * state-only rule.
 */
const SCOPE_WEIGHT = { providerId: 8, serviceAreaId: 4, stateId: 2, vehicleCategory: 1 } as const

function scopeScore(config: Record<string, any>): number {
  let score = 0
  for (const [field, weight] of Object.entries(SCOPE_WEIGHT)) {
    const value = config[field]
    if (value !== null && value !== undefined) score += weight
  }
  return score
}

function inEffect(config: Record<string, any>, now: Date): boolean {
  if (config.effectiveFrom && new Date(config.effectiveFrom) > now) return false
  if (config.effectiveTo && new Date(config.effectiveTo) <= now) return false
  return true
}

function scopeMatches(config: Record<string, any>, ctx: PricingContext): boolean {
  const pairs: [unknown, unknown][] = [
    [config.providerId, ctx.providerId],
    [config.stateId, ctx.stateId],
    [config.serviceAreaId, ctx.serviceAreaId],
    [config.vehicleCategory, ctx.vehicleCategory]
  ]
  return pairs.every(([ruleValue, ctxValue]) => ruleValue === null || ruleValue === undefined || ruleValue === ctxValue)
}

/**
 * Picks the single best rule for a trip: most specific scope wins, then the
 * highest priority, then the most recently updated. Returns `null` when nothing
 * matches (the caller then uses the provider's own rate).
 */
export async function resolvePricingConfig(ctx: PricingContext): Promise<Record<string, any> | null> {
  const now = ctx.now ?? new Date()
  const configs = (await prisma.pricingConfig.findMany({ where: { isActive: true } })) as Record<string, any>[]
  const candidates = configs.filter((c) => c.isActive !== false && inEffect(c, now) && scopeMatches(c, ctx))
  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const specificity = scopeScore(b) - scopeScore(a)
    if (specificity !== 0) return specificity
    const priority = toInt(b.priority) - toInt(a.priority)
    if (priority !== 0) return priority
    return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  })
  return candidates[0]
}

// --- Calculation -----------------------------------------------------------

/**
 * Computes a fare from an explicit rule. Pure (no I/O) so it is cheap to unit
 * test and deterministic: charges are summed, discounts are applied to the
 * subtotal, and the result is floored at `minimumFareKobo`.
 */
export function computeFareFromConfig(
  config: Record<string, any>,
  distanceKm: number,
  durationMinutes = 0
): FareResult {
  const currency = typeof config.currency === 'string' ? config.currency : 'NGN'
  const baseFareKobo = toInt(config.baseFareKobo)
  const perKmKobo = toInt(config.perKmKobo)
  const perMinuteKobo = toInt(config.perMinuteKobo)
  const minimumFareKobo = toInt(config.minimumFareKobo)

  const distanceChargeKobo = Math.round(distanceKm * perKmKobo)
  const timeChargeKobo = Math.round(durationMinutes * perMinuteKobo)

  const extraCharges = parseExtraCharges(config.extraCharges)
  const extrasTotalKobo = extraCharges.reduce((sum, c) => sum + c.amountKobo, 0)

  const subtotalKobo = baseFareKobo + distanceChargeKobo + timeChargeKobo + extrasTotalKobo

  const discounts: FareDiscount[] = parseDiscounts(config.discounts).map((d) => ({
    ...d,
    amountKobo: d.type === 'PERCENT' ? Math.round((subtotalKobo * d.value) / 100) : Math.round(d.value)
  }))
  // A discount can never exceed the subtotal (no negative fares).
  const discountTotalKobo = Math.min(
    discounts.reduce((sum, d) => sum + d.amountKobo, 0),
    subtotalKobo
  )

  const afterDiscountKobo = subtotalKobo - discountTotalKobo
  const minimumApplied = afterDiscountKobo < minimumFareKobo
  const totalKobo = Math.max(afterDiscountKobo, minimumFareKobo)

  return {
    estimatedFareKobo: totalKobo,
    breakdown: {
      currency,
      distanceKm,
      durationMinutes,
      baseFareKobo,
      distanceChargeKobo,
      timeChargeKobo,
      perKmKobo,
      perMinuteKobo,
      ratePerKmKobo: perKmKobo,
      extraCharges,
      extrasTotalKobo,
      subtotalKobo,
      discounts,
      discountTotalKobo,
      minimumFareKobo,
      minimumApplied,
      totalKobo,
      estimatedFareKobo: totalKobo,
      pricingConfigId: config.id ?? null,
      pricingConfigName: config.name ?? null,
      computedAt: new Date().toISOString()
    }
  }
}

/** Backwards-compatible fare from the provider's own stored rate. */
export function computeLegacyFare(provider: ProviderRate, distanceKm: number, durationMinutes = 0): FareResult {
  const baseFareKobo = toInt(provider.baseFareKobo)
  const perKmKobo = toInt(provider.ratePerKmKobo)
  const distanceChargeKobo = Math.round(distanceKm * perKmKobo)
  const totalKobo = baseFareKobo + distanceChargeKobo

  return {
    estimatedFareKobo: totalKobo,
    breakdown: {
      currency: 'NGN',
      distanceKm,
      durationMinutes,
      baseFareKobo,
      distanceChargeKobo,
      timeChargeKobo: 0,
      perKmKobo,
      perMinuteKobo: 0,
      ratePerKmKobo: perKmKobo,
      extraCharges: [],
      extrasTotalKobo: 0,
      subtotalKobo: totalKobo,
      discounts: [],
      discountTotalKobo: 0,
      minimumFareKobo: 0,
      minimumApplied: false,
      totalKobo,
      estimatedFareKobo: totalKobo,
      pricingConfigId: null,
      pricingConfigName: null,
      computedAt: new Date().toISOString()
    }
  }
}

/**
 * The single entry point used when creating a booking: resolves the best rule
 * for the trip and falls back to the provider's rate when none matches.
 */
export async function computeFareForBooking(
  provider: ProviderRate,
  ctx: PricingContext,
  distanceKm: number,
  durationMinutes = 0
): Promise<FareResult> {
  const config = await resolvePricingConfig({ ...ctx, providerId: ctx.providerId ?? provider.id ?? null })
  if (config) return computeFareFromConfig(config, distanceKm, durationMinutes)
  return computeLegacyFare(provider, distanceKm, durationMinutes)
}

// --- Estimation ------------------------------------------------------------

export interface FareEstimate {
  distanceKm: number
  estimatedFareKobo: number
  breakdown: FareBreakdown
  pricingConfig: Record<string, any> | null
}

/**
 * Quotes a fare without creating anything. The distance is computed on the
 * server from the supplied coordinates (or the destination hospital's own
 * coordinates); the caller never sends an amount.
 */
export async function estimateFare(input: EstimateFareInput): Promise<FareEstimate> {
  let destLat = input.destLat
  let destLng = input.destLng
  if ((destLat === undefined || destLng === undefined) && input.destinationHospitalId) {
    const hospital = await prisma.hospital.findUnique({ where: { id: input.destinationHospitalId } })
    if (!hospital) throw new AppError(404, 'Destination hospital not found.', { code: 'HOSPITAL_NOT_FOUND' })
    destLat = hospital.lat
    destLng = hospital.lng
  }
  if (destLat === undefined || destLng === undefined) {
    throw new AppError(400, 'A destination location is required.', { code: 'VALIDATION_ERROR', field: 'destLat' })
  }

  let provider: ProviderRate & { stateId?: string | null } | null = null
  if (input.providerId) {
    provider = await prisma.ambulanceProvider.findUnique({ where: { id: input.providerId } })
    if (!provider) throw new AppError(404, 'Selected provider not found.', { code: 'PROVIDER_NOT_FOUND' })
  }

  const coverage = await coverageColumns(input.pickupLat, input.pickupLng)
  const distanceKm = roundKm(haversineDistanceKm(input.pickupLat, input.pickupLng, destLat, destLng))
  const durationMinutes = input.durationMinutes ?? 0

  const ctx: PricingContext = {
    providerId: provider?.id ?? null,
    stateId: provider?.stateId ?? coverage.stateId ?? null,
    serviceAreaId: coverage.serviceAreaId ?? null,
    vehicleCategory: input.vehicleCategory ?? null
  }

  const config = await resolvePricingConfig(ctx)
  const result = config
    ? computeFareFromConfig(config, distanceKm, durationMinutes)
    : computeLegacyFare(
        provider ?? { baseFareKobo: 0, ratePerKmKobo: 0 },
        distanceKm,
        durationMinutes
      )

  return {
    distanceKm,
    estimatedFareKobo: result.estimatedFareKobo,
    breakdown: result.breakdown,
    pricingConfig: config
  }
}

// --- Management ------------------------------------------------------------

export interface PricingActor {
  userId: string
  role: Role
  stateId: string | null
}

function pricingNotFound(): AppError {
  return new AppError(404, 'Pricing rule not found.', { code: 'PRICING_NOT_FOUND' })
}

async function assertReferenceExists(model: 'ambulanceProvider' | 'state' | 'serviceArea', id: string, code: string, label: string) {
  const row = await (prisma as any)[model].findUnique({ where: { id } })
  if (!row) throw new AppError(404, `${label} not found.`, { code })
  return row
}

/**
 * Enforces who may scope a rule where. State administrators may only manage
 * rules for their own state (and its service areas); platform-wide defaults and
 * provider-specific overrides are reserved for the platform administrator.
 */
async function assertScopeAllowed(actor: PricingActor, data: Record<string, any>, creating: boolean) {
  if (actor.role === Role.PLATFORM_ADMIN) {
    if (data.providerId) await assertReferenceExists('ambulanceProvider', data.providerId, 'PROVIDER_NOT_FOUND', 'Provider')
    if (data.stateId) await assertReferenceExists('state', data.stateId, 'STATE_NOT_FOUND', 'State')
    if (data.serviceAreaId) await assertReferenceExists('serviceArea', data.serviceAreaId, 'SERVICE_AREA_NOT_FOUND', 'Service area')
    return
  }

  if (actor.role !== Role.STATE_ADMIN) {
    throw new AppError(403, 'You are not allowed to manage pricing.', { code: 'FORBIDDEN' })
  }

  if (data.providerId) {
    throw new AppError(403, 'State administrators cannot create provider-specific pricing.', { code: 'FORBIDDEN' })
  }
  if (data.stateId !== undefined && data.stateId !== null && data.stateId !== actor.stateId) {
    throw new AppError(404, 'State not found.', { code: 'STATE_NOT_FOUND' })
  }
  if (creating) {
    if (!actor.stateId) {
      throw new AppError(403, 'You are not assigned to a state.', { code: 'FORBIDDEN' })
    }
    data.stateId = actor.stateId
  } else if (data.stateId === null) {
    throw new AppError(403, 'State administrators cannot create platform-wide pricing.', { code: 'FORBIDDEN' })
  }
  if (data.serviceAreaId) {
    const area = await assertReferenceExists('serviceArea', data.serviceAreaId, 'SERVICE_AREA_NOT_FOUND', 'Service area')
    if (area.stateId !== actor.stateId) {
      throw new AppError(404, 'Service area not found.', { code: 'SERVICE_AREA_NOT_FOUND' })
    }
  }
}

/** Applies schema defaults explicitly so the in-memory test client matches Postgres. */
function normaliseCreate(input: CreatePricingConfigInput) {
  return {
    name: input.name,
    providerId: input.providerId ?? null,
    stateId: input.stateId ?? null,
    serviceAreaId: input.serviceAreaId ?? null,
    vehicleCategory: input.vehicleCategory ?? null,
    baseFareKobo: input.baseFareKobo ?? 0,
    perKmKobo: input.perKmKobo ?? 0,
    perMinuteKobo: input.perMinuteKobo ?? 0,
    minimumFareKobo: input.minimumFareKobo ?? 0,
    extraCharges: input.extraCharges ?? [],
    discounts: input.discounts ?? [],
    currency: input.currency ?? 'NGN',
    priority: input.priority ?? 0,
    isActive: input.isActive ?? true,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null
  }
}

export async function createPricingConfig(actor: PricingActor, input: CreatePricingConfigInput) {
  const data = normaliseCreate(input)
  await assertScopeAllowed(actor, data, true)
  return prisma.pricingConfig.create({ data: { ...data, createdById: actor.userId } })
}

async function loadInScope(actor: PricingActor, id: string) {
  const config = await prisma.pricingConfig.findUnique({ where: { id } })
  if (!config) throw pricingNotFound()
  if (actor.role === Role.STATE_ADMIN && config.stateId !== actor.stateId) throw pricingNotFound()
  return config
}

export async function updatePricingConfig(actor: PricingActor, id: string, input: UpdatePricingConfigInput) {
  const existing = await loadInScope(actor, id)
  await assertScopeAllowed(actor, input as Record<string, any>, false)
  return prisma.pricingConfig.update({ where: { id: existing.id }, data: { ...input } })
}

export async function setPricingConfigActive(actor: PricingActor, id: string, isActive: boolean) {
  const existing = await loadInScope(actor, id)
  return prisma.pricingConfig.update({ where: { id: existing.id }, data: { isActive } })
}

export async function listPricingConfigs(actor: PricingActor, filter: ListPricingQuery) {
  const where: Record<string, unknown> = {}
  if (filter.stateId) where.stateId = filter.stateId
  if (filter.serviceAreaId) where.serviceAreaId = filter.serviceAreaId
  if (filter.providerId) where.providerId = filter.providerId
  if (filter.vehicleCategory) where.vehicleCategory = filter.vehicleCategory
  if (filter.isActive !== undefined) where.isActive = filter.isActive

  // A state administrator only ever sees rules scoped to their own state.
  if (actor.role === Role.STATE_ADMIN) where.stateId = actor.stateId ?? '__no_state__'

  return prisma.pricingConfig.findMany({ where, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] })
}

export async function getPricingConfig(actor: PricingActor, id: string) {
  return loadInScope(actor, id)
}
