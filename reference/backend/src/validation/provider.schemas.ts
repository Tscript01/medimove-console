import { z } from 'zod'

/**
 * Request schemas for providers and their vehicles.
 *
 * These are kept in sync with the Prisma enums (`ProviderStatus`,
 * `VerificationStatus`, `VehicleCategory`, `AvailabilityStatus`). Coordinates
 * are always validated on the backend and never defaulted.
 */

export const VEHICLE_CATEGORIES = [
  'BASIC_LIFE_SUPPORT',
  'ADVANCED_LIFE_SUPPORT',
  'NEONATAL',
  'PATIENT_TRANSPORT',
  'MORTUARY'
] as const

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'ON_DUTY', 'OFFLINE', 'UNAVAILABLE'] as const

const latitude = z.number().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.')
const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.')

const money = z.number().int('Amounts must be whole kobo.').nonnegative('Amount cannot be negative.').max(100_000_000)

const phone = z.string().trim().min(7, 'A phone number is required.').max(20)
const name = z.string().trim().min(2, 'A name is required.').max(120)

/** Provider application. The caller becomes the provider's PROVIDER_ADMIN. */
export const applyProviderSchema = z.object({
  name,
  phone,
  vehicleType: z.string().trim().min(2, 'A vehicle type is required.').max(60),
  baseFareKobo: money,
  ratePerKmKobo: money,
  latitude,
  longitude,
  stateId: z.string().trim().min(1).optional(),
  email: z.string().trim().email('Enter a valid email.').max(200).optional(),
  address: z.string().trim().max(300).optional(),
  contactName: z.string().trim().max(120).optional(),
  registrationNumber: z.string().trim().max(60).optional()
})

export const updateProviderSchema = z
  .object({
    name: name.optional(),
    phone: phone.optional(),
    vehicleType: z.string().trim().min(2).max(60).optional(),
    baseFareKobo: money.optional(),
    ratePerKmKobo: money.optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    email: z.string().trim().email('Enter a valid email.').max(200).nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    contactName: z.string().trim().max(120).nullable().optional(),
    registrationNumber: z.string().trim().max(60).nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' })

export const providerLocationSchema = z.object({
  latitude,
  longitude,
  label: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300).optional(),
  landmark: z.string().trim().max(200).optional(),
  stateId: z.string().trim().min(1).optional(),
  serviceAreaId: z.string().trim().min(1).optional(),
  isPrimary: z.boolean().optional()
})

export const updateProviderLocationSchema = z
  .object({
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    label: z.string().trim().max(60).nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    landmark: z.string().trim().max(200).nullable().optional(),
    stateId: z.string().trim().min(1).nullable().optional(),
    serviceAreaId: z.string().trim().min(1).nullable().optional(),
    isPrimary: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' })

export const linkServiceAreaSchema = z.object({ serviceAreaId: z.string().trim().min(1, 'A service area is required.') })

export const createAmbulanceSchema = z.object({
  registrationNumber: z.string().trim().min(2, 'A registration number is required.').max(40),
  vehicleType: z.string().trim().min(2, 'A vehicle type is required.').max(60),
  category: z.enum(VEHICLE_CATEGORIES, { message: `Category must be one of: ${VEHICLE_CATEGORIES.join(', ')}.` }),
  availability: z.enum(AVAILABILITY_STATUSES).optional(),
  currentLatitude: latitude.optional(),
  currentLongitude: longitude.optional()
})

export const updateAmbulanceSchema = z
  .object({
    registrationNumber: z.string().trim().min(2).max(40).optional(),
    vehicleType: z.string().trim().min(2).max(60).optional(),
    category: z.enum(VEHICLE_CATEGORIES).optional(),
    availability: z.enum(AVAILABILITY_STATUSES).optional(),
    isActive: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' })

export const ambulanceLocationSchema = z.object({ latitude, longitude })

export const ambulanceAvailabilitySchema = z.object({ availability: z.enum(AVAILABILITY_STATUSES) })

export const providerDecisionSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED'], { message: 'Decision must be VERIFIED or REJECTED.' }),
    reason: z.string().trim().max(300).optional()
  })
  .refine((data) => data.decision !== 'REJECTED' || Boolean(data.reason), {
    message: 'A reason is required when rejecting.',
    path: ['reason']
  })

/** Optional free-text reason (suspend / revoke / deactivate). */
export const reasonSchema = z.object({
  reason: z.string().trim().max(300).optional()
})

export type ApplyProviderInput = z.infer<typeof applyProviderSchema>
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>
export type ProviderLocationInput = z.infer<typeof providerLocationSchema>
export type UpdateProviderLocationInput = z.infer<typeof updateProviderLocationSchema>
export type CreateAmbulanceInput = z.infer<typeof createAmbulanceSchema>
export type UpdateAmbulanceInput = z.infer<typeof updateAmbulanceSchema>
