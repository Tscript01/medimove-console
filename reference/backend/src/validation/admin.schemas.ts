import { z } from 'zod'
import { paginationQueryFields } from '../utils/pagination'

/** The seven platform roles. Kept in sync with the Prisma `Role` enum. */
export const roleSchema = z.enum([
  'PATIENT',
  'CREW',
  'DISPATCHER',
  'HOSPITAL_STAFF',
  'PROVIDER_ADMIN',
  'PLATFORM_ADMIN',
  'STATE_ADMIN'
])

/**
 * Role assignment. Scope fields are optional here and validated for
 * consistency with the target role in the controller (e.g. a HOSPITAL_STAFF
 * user must have a `hospitalId`).
 */
export const updateUserRoleSchema = z.object({
  role: roleSchema,
  stateId: z.string().trim().min(1).max(120).optional(),
  hospitalId: z.string().trim().min(1).max(120).optional(),
  providerId: z.string().trim().min(1).max(120).optional()
})

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>

/**
 * Account suspension. The reason is optional free text, but it is recorded on
 * the user and in the immutable audit trail, so operators should be encouraged
 * to supply one.
 */
export const suspendUserSchema = z.object({
  reason: z.string().trim().max(300).optional()
})

export type SuspendUserInput = z.infer<typeof suspendUserSchema>

const latitude = z.number().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.')
const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.')

/**
 * Administrative creation of a hospital. The `id` deliberately matches the
 * public reference dataset so the same identifier is used across the API.
 */
export const adminCreateHospitalSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(120),
  stateId: z.string().trim().min(1).max(120),
  category: z.string().trim().min(2).max(120),
  lat: latitude,
  lng: longitude,
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  email: z.string().trim().email('Enter a valid email address.').max(200).nullable().optional(),
  address: z.string().trim().min(2).max(300).nullable().optional(),
  landmark: z.string().trim().min(2).max(200).nullable().optional(),
  acceptsEmergencies: z.boolean().optional(),
  isActive: z.boolean().optional()
})

export type AdminCreateHospitalInput = z.infer<typeof adminCreateHospitalSchema>

/** Administrative edit of a hospital. `id`/`stateId` are not editable here. */
export const adminUpdateHospitalSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  city: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().min(2).max(120).optional(),
  lat: latitude.optional(),
  lng: longitude.optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  email: z.string().trim().email('Enter a valid email address.').max(200).nullable().optional(),
  address: z.string().trim().min(2).max(300).nullable().optional(),
  landmark: z.string().trim().min(2).max(200).nullable().optional(),
  acceptsEmergencies: z.boolean().optional()
})

export type AdminUpdateHospitalInput = z.infer<typeof adminUpdateHospitalSchema>

export const adminListHospitalsQuerySchema = z.object({
  stateId: z.string().trim().min(1).max(120).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  // Explicit string enum: `z.coerce.boolean()` would treat "false" as truthy.
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  ...paginationQueryFields
})

export type AdminListHospitalsQuery = z.infer<typeof adminListHospitalsQuerySchema>

/** Booking oversight filters. Only ever *narrows* the caller's data scope. */
export const adminListBookingsQuerySchema = z.object({
  status: z
    .enum([
      'REQUESTED',
      'OFFERED',
      'ACCEPTED',
      'EN_ROUTE',
      'ARRIVED',
      'PATIENT_ON_BOARD',
      'AT_HOSPITAL',
      'COMPLETED',
      'CANCELLED',
      'FAILED'
    ])
    .optional(),
  stateId: z.string().trim().min(1).max(120).optional(),
  providerId: z.string().trim().min(1).max(120).optional(),
  userId: z.string().trim().min(1).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationQueryFields
})

export type AdminListBookingsQuery = z.infer<typeof adminListBookingsQuerySchema>

/** Operational report window. Both bounds are optional. */
export const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  stateId: z.string().trim().min(1).max(120).optional()
})

export type ReportQuery = z.infer<typeof reportQuerySchema>
