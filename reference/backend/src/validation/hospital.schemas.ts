import { z } from 'zod'

/**
 * Hospital operations request validation.
 *
 * All hospital-scoped rules live in `services/hospitalService`; these schemas
 * only bound and normalise input. The caller's hospital is always resolved from
 * the session, never from a request body or path, so a hospital can only ever
 * read or edit its own profile.
 */

const latitude = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90.')
  .max(90, 'Latitude must be between -90 and 90.')
const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.')

export const HOSPITAL_SERVICE_STATUS_VALUES = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'] as const
export const HOSPITAL_INTAKE_STATUS_VALUES = ['OPEN', 'LIMITED', 'DIVERTING', 'CLOSED'] as const

export const hospitalServiceStatusSchema = z.enum(HOSPITAL_SERVICE_STATUS_VALUES)
export const hospitalIntakeStatusSchema = z.enum(HOSPITAL_INTAKE_STATUS_VALUES)

/** Directory query. Reference data only — no PHI is ever involved. */
export const listHospitalsQuerySchema = z.object({
  stateId: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
})

export type ListHospitalsQuery = z.infer<typeof listHospitalsQuerySchema>

/** Profile/location edits a hospital may make to its own record. */
export const updateHospitalSchema = z.object({
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  email: z.string().trim().email('Enter a valid email address.').max(200).nullable().optional(),
  address: z.string().trim().min(2).max(300).nullable().optional(),
  landmark: z.string().trim().min(2).max(200).nullable().optional(),
  lat: latitude.optional(),
  lng: longitude.optional(),
  /** Whether the hospital is currently accepting emergency intake. */
  acceptsEmergencies: z.boolean().optional()
})

export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>

const specialtyItemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  notes: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional()
})

/** Replaces the hospital's specialty list wholesale (idempotent). */
export const replaceSpecialtiesSchema = z.object({
  specialties: z.array(specialtyItemSchema).max(100)
})

export type ReplaceSpecialtiesInput = z.infer<typeof replaceSpecialtiesSchema>

const serviceItemSchema = z.object({
  service: z.string().trim().min(2).max(120),
  status: hospitalServiceStatusSchema.optional(),
  notes: z.string().trim().max(300).nullable().optional()
})

/** Replaces the hospital's service-availability list wholesale (idempotent). */
export const replaceServicesSchema = z.object({
  services: z.array(serviceItemSchema).max(100)
})

export type ReplaceServicesInput = z.infer<typeof replaceServicesSchema>

/**
 * Capacity/intake. Every field is *maintained by the hospital*; the server
 * stamps `updatedAt` so consumers can judge freshness rather than assume it.
 */
export const updateCapacitySchema = z.object({
  intakeStatus: hospitalIntakeStatusSchema.optional(),
  emergencyBedsAvailable: z.number().int().min(0).max(100000).nullable().optional(),
  icuBedsAvailable: z.number().int().min(0).max(100000).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional()
})

export type UpdateCapacityInput = z.infer<typeof updateCapacitySchema>

/** Authorize an existing user as staff at the caller's hospital. */
export const authorizeStaffSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(200)
})

export type AuthorizeStaffInput = z.infer<typeof authorizeStaffSchema>
