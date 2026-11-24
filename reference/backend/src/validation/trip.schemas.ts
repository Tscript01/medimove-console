import { z } from 'zod'
import { BOOKING_STATUS_VALUES } from './booking.schemas'

/**
 * Crew trip-operation and tracking validation.
 *
 * The trip state machine lives in `services/bookingService`; these schemas only
 * bound what a crew member may send. A crew can never set a booking *back* to an
 * earlier state (or to `REQUESTED`/`OFFERED`/`ACCEPTED`) through this surface:
 * only the forward milestones below are accepted, and the state machine still
 * authorises each move. Coordinates are always validated; a client can never
 * submit a status, distance, fare or timestamp that the server would trust.
 */

/** The forward milestones a crew member drives during a trip. */
export const CREW_TRIP_STATUS_VALUES = [
  'EN_ROUTE',
  'ARRIVED',
  'PATIENT_ON_BOARD',
  'AT_HOSPITAL',
  'COMPLETED'
] as const

export const crewTripStatusSchema = z.enum(CREW_TRIP_STATUS_VALUES)

const latitude = z.number().min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.')
const longitude = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.')

/** A crew member advancing their own assigned trip. */
export const updateTripStatusSchema = z.object({
  status: crewTripStatusSchema,
  reason: z.string().trim().max(500).optional()
})

/**
 * A GPS fix for an in-progress trip. `recordedAt` is deliberately absent: the
 * server stamps receipt time so a device clock cannot make an old fix look live.
 */
export const tripLocationSchema = z.object({
  latitude,
  longitude,
  accuracyMeters: z.number().nonnegative().max(100_000).optional(),
  speedKph: z.number().nonnegative().max(400).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  source: z.enum(['GPS', 'MAP_PIN']).optional()
})

/**
 * A moving-pickup fix from the booking requester (the person holding the phone
 * that the crew should meet). It shares the coordinate schema with crew fixes,
 * but the service stores it without a vehicle/crew identity and the tracking
 * view exposes it separately, so it can never replace the ambulance ETA.
 */
export const requesterLocationSchema = tripLocationSchema

/** A crew member reporting the patient was not present at the pickup point. */
export const reportNoShowSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'A reason is required when reporting a no-show.')
    .max(500, 'Reason must be 500 characters or fewer.')
})

/** Optional filters for the crew's assigned-trip list. */
export const listTripsQuerySchema = z.object({
  status: z.enum(BOOKING_STATUS_VALUES).optional(),
  /** When false, terminal trips (completed/cancelled/failed) are included too. */
  active: z.enum(['true', 'false']).optional()
})

export type UpdateTripStatusInput = z.infer<typeof updateTripStatusSchema>
export type TripLocationInput = z.infer<typeof tripLocationSchema>
export type RequesterLocationInput = z.infer<typeof requesterLocationSchema>
export type ReportNoShowInput = z.infer<typeof reportNoShowSchema>
export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>
export type CrewTripStatus = (typeof CREW_TRIP_STATUS_VALUES)[number]
