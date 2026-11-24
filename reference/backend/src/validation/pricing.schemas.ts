import { z } from 'zod'

/**
 * Request schemas for configurable pricing and fare estimation.
 *
 * All money is integer kobo; a client can never submit a payable amount — the
 * only money it may send is *rule configuration*, and only administrators can do
 * that. Fare estimates take locations and an optional vehicle category, never a
 * price. Kept in sync with the `PricingConfig` model.
 */

export const VEHICLE_CATEGORY_VALUES = [
  'BASIC_LIFE_SUPPORT',
  'ADVANCED_LIFE_SUPPORT',
  'NEONATAL',
  'PATIENT_TRANSPORT',
  'MORTUARY'
] as const

export const DISCOUNT_TYPES = ['FIXED', 'PERCENT'] as const

const latitude = z.number().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.')
const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.')

const money = z.number().int('Amounts must be whole kobo.').nonnegative('Amount cannot be negative.').max(1_000_000_000)

const extraChargeSchema = z.object({
  code: z.string().trim().min(1, 'A charge code is required.').max(40),
  label: z.string().trim().min(1, 'A charge label is required.').max(120),
  amountKobo: money
})

const discountSchema = z
  .object({
    code: z.string().trim().min(1, 'A discount code is required.').max(40),
    label: z.string().trim().min(1, 'A discount label is required.').max(120),
    type: z.enum(DISCOUNT_TYPES),
    /** For `FIXED` this is kobo; for `PERCENT` it is a percentage (0–100). */
    value: z.number().nonnegative('A discount cannot be negative.').max(1_000_000_000)
  })
  .superRefine((data, ctx) => {
    if (data.type === 'PERCENT' && data.value > 100) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage discount cannot exceed 100.' })
    }
  })

export const createPricingConfigSchema = z.object({
  name: z.string().trim().min(2, 'A name is required.').max(120),
  providerId: z.string().trim().min(1).optional(),
  stateId: z.string().trim().min(1).optional(),
  serviceAreaId: z.string().trim().min(1).optional(),
  vehicleCategory: z.enum(VEHICLE_CATEGORY_VALUES).optional(),
  baseFareKobo: money.default(0),
  perKmKobo: money.default(0),
  perMinuteKobo: money.default(0),
  minimumFareKobo: money.default(0),
  extraCharges: z.array(extraChargeSchema).max(20).optional(),
  discounts: z.array(discountSchema).max(20).optional(),
  currency: z.string().trim().min(3).max(3).default('NGN'),
  priority: z.number().int().min(-1000).max(1000).default(0),
  isActive: z.boolean().default(true),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional()
})

export const updatePricingConfigSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    providerId: z.string().trim().min(1).nullable().optional(),
    stateId: z.string().trim().min(1).nullable().optional(),
    serviceAreaId: z.string().trim().min(1).nullable().optional(),
    vehicleCategory: z.enum(VEHICLE_CATEGORY_VALUES).nullable().optional(),
    baseFareKobo: money.optional(),
    perKmKobo: money.optional(),
    perMinuteKobo: money.optional(),
    minimumFareKobo: money.optional(),
    extraCharges: z.array(extraChargeSchema).max(20).nullable().optional(),
    discounts: z.array(discountSchema).max(20).nullable().optional(),
    currency: z.string().trim().min(3).max(3).optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
    isActive: z.boolean().optional(),
    effectiveFrom: z.coerce.date().nullable().optional(),
    effectiveTo: z.coerce.date().nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' })

/** Fare estimate request. Takes locations and an optional vehicle category. */
export const estimateFareSchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
    pickupLat: latitude,
    pickupLng: longitude,
    destLat: latitude.optional(),
    destLng: longitude.optional(),
    destinationHospitalId: z.string().trim().min(1).optional(),
    vehicleCategory: z.enum(VEHICLE_CATEGORY_VALUES).optional(),
    /** Optional assumed trip duration, in minutes, for time-based charges. */
    durationMinutes: z.number().nonnegative().max(24 * 60).optional()
  })
  .superRefine((data, ctx) => {
    const hasLat = data.destLat !== undefined
    const hasLng = data.destLng !== undefined
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: 'custom',
        path: ['destLng'],
        message: 'Destination latitude and longitude must be provided together.'
      })
    }
    if (!hasLat && !data.destinationHospitalId) {
      ctx.addIssue({
        code: 'custom',
        path: ['destLat'],
        message: 'Provide destination coordinates or a destination hospital.'
      })
    }
  })

export const listPricingQuerySchema = z.object({
  stateId: z.string().trim().min(1).optional(),
  serviceAreaId: z.string().trim().min(1).optional(),
  providerId: z.string().trim().min(1).optional(),
  vehicleCategory: z.enum(VEHICLE_CATEGORY_VALUES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
})

/** Activate/deactivate a rule without editing its amounts. */
export const setPricingActiveSchema = z.object({ isActive: z.boolean() })

export type CreatePricingConfigInput = z.infer<typeof createPricingConfigSchema>
export type UpdatePricingConfigInput = z.infer<typeof updatePricingConfigSchema>
export type EstimateFareInput = z.infer<typeof estimateFareSchema>
export type ListPricingQuery = z.infer<typeof listPricingQuerySchema>
