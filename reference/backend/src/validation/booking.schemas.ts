import { z } from 'zod'
import { paginationQueryFields } from '../utils/pagination'

/**
 * Booking request validation.
 *
 * The emergency state machine and the requester/patient distinction live in
 * `services/bookingService`; this file only validates and normalises input.
 * Client-supplied `distanceKm`/`estimatedFare` are deliberately **not** part of
 * the schema: zod strips unknown keys, so a client can never set the payable
 * amount.
 */

export const BOOKING_STATUS_VALUES = [
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
] as const

export const EMERGENCY_CATEGORY_VALUES = [
  'MEDICAL',
  'TRAUMA',
  'CARDIAC',
  'RESPIRATORY',
  'OBSTETRIC',
  'PEDIATRIC',
  'PSYCHIATRIC',
  'ACCIDENT',
  'OTHER'
] as const

export const GENDER_VALUES = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'] as const

export const bookingStatusSchema = z.enum(BOOKING_STATUS_VALUES)
export const emergencyCategorySchema = z.enum(EMERGENCY_CATEGORY_VALUES)
export const genderSchema = z.enum(GENDER_VALUES)

const latitude = z.number().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.')
const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.')

const phone = z.string().trim().min(7, 'A valid phone number is required.').max(20, 'A valid phone number is required.')

/**
 * Booking creation. The requester is the signed-in user; the patient may be
 * someone else (`isForSelf: false`), in which case patient details are required.
 */
export const createBookingSchema = z
  .object({
    providerId: z.string().trim().min(1, 'A provider is required.'),
    // Incident / pickup location
    pickupLat: latitude,
    pickupLng: longitude,
    pickupAddress: z.string().trim().max(300).optional(),
    landmark: z.string().trim().max(200).optional(),
    // Destination
    destLat: latitude.optional(),
    destLng: longitude.optional(),
    destAddress: z.string().trim().max(300).optional(),
    destinationHospitalId: z.string().trim().min(1).optional(),
    // Requester vs patient
    isForSelf: z.boolean().default(true),
    patientName: z.string().trim().max(120).optional(),
    patientPhone: phone.optional(),
    patientAge: z.number().int().min(0, 'Age must be between 0 and 130.').max(130, 'Age must be between 0 and 130.').optional(),
    patientGender: genderSchema.optional(),
    // Request details
    callbackPhone: phone,
    emergencyCategory: emergencyCategorySchema,
    notes: z.string().trim().max(1000).optional(),
    // Idempotency
    idempotencyKey: z.string().trim().min(1).max(120).optional()
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
    if (data.isForSelf === false) {
      if (!data.patientName) {
        ctx.addIssue({ code: 'custom', path: ['patientName'], message: 'Patient name is required when requesting for another person.' })
      }
      if (!data.patientPhone) {
        ctx.addIssue({ code: 'custom', path: ['patientPhone'], message: 'Patient phone is required when requesting for another person.' })
      }
    }
  })

/** Status transition. `reason` is mandatory for FAILED (and operator cancels). */
export const updateBookingStatusSchema = z.object({
  status: bookingStatusSchema,
  reason: z.string().trim().max(500).optional(),
  /** Required only when an operator records a crew's acceptance. */
  crewProfileId: z.string().trim().min(1).optional()
})

/** Requester-initiated cancellation. */
export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional()
})

/**
 * Paginated booking/trip list. `status` and the date range only ever *narrow*
 * the caller's scope; the scope itself is applied from the session.
 */
export const listBookingsQuerySchema = z.object({
  status: bookingStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationQueryFields
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>
export type BookingStatusValue = (typeof BOOKING_STATUS_VALUES)[number]
export type EmergencyCategoryValue = (typeof EMERGENCY_CATEGORY_VALUES)[number]
