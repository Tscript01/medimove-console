import { z } from 'zod'

/**
 * Dispatch-engine request validation.
 *
 * All matching, ranking, eligibility and the offer state machine live in
 * `services/dispatchService`; these schemas only bound and normalise input. Note
 * that a dispatcher can never supply a distance, fare or status — only *which*
 * crew/vehicle to assign.
 */

const positiveInt = z.number().int().positive()

/** Start or restart dispatch (recommendations are sent as offers). */
export const createDispatchSchema = z.object({
  /** How many of the best-ranked candidates to offer in this round. */
  candidateLimit: positiveInt.max(20).optional(),
  /** Override the offer lifetime for this round (seconds). */
  ttlSeconds: positiveInt.min(10).max(300).optional()
})

/** Retry dispatch with the next batch of candidates. */
export const retryDispatchSchema = createDispatchSchema

/** Manual assign / reassign override. */
export const manualAssignSchema = z.object({
  crewProfileId: z.string().trim().min(1, 'A crew member is required.'),
  /** Defaults to the crew member's assigned vehicle when omitted. */
  ambulanceId: z.string().trim().min(1).optional(),
  reason: z.string().trim().max(500).optional()
})

/** A crew declining an offer. */
export const rejectOfferSchema = z.object({
  reason: z.string().trim().max(500).optional()
})

// --- Dispatcher operations (Stage 13) --------------------------------------

export const DISPATCH_BOOKING_STATUS_VALUES = [
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

/** Filter for the dispatcher's incoming/operational booking list. */
export const listDispatchBookingsQuerySchema = z.object({
  status: z.enum(DISPATCH_BOOKING_STATUS_VALUES).optional(),
  /** When true, only bookings flagged for manual assignment. */
  escalated: z.enum(['true', 'false']).optional(),
  /** When true (default), only non-terminal bookings. */
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
})

/** Available-ambulance filter. */
export const listDispatchAmbulancesQuerySchema = z.object({
  stateId: z.string().trim().min(1).max(120).optional(),
  providerId: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
})

/** Escalate a booking for manual assignment. */
export const escalateBookingSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional()
})

/**
 * Contact a relevant party through an approved template. Free text is
 * deliberately not accepted — only a fixed recipient and template — so the
 * notification queue can never carry PHI.
 */
export const DISPATCH_CONTACT_RECIPIENTS = ['REQUESTER', 'CREW', 'HOSPITAL'] as const
export const DISPATCH_CONTACT_TEMPLATES = ['CALLBACK_REQUESTED', 'ETA_UPDATE', 'STATUS_UPDATE', 'GENERAL'] as const

export const contactPartySchema = z.object({
  recipient: z.enum(DISPATCH_CONTACT_RECIPIENTS),
  template: z.enum(DISPATCH_CONTACT_TEMPLATES)
})

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>
export type RetryDispatchInput = z.infer<typeof retryDispatchSchema>
export type ManualAssignInput = z.infer<typeof manualAssignSchema>
export type RejectOfferInput = z.infer<typeof rejectOfferSchema>
export type ListDispatchBookingsQuery = z.infer<typeof listDispatchBookingsQuerySchema>
export type ListDispatchAmbulancesQuery = z.infer<typeof listDispatchAmbulancesQuerySchema>
export type EscalateBookingInput = z.infer<typeof escalateBookingSchema>
export type ContactPartyInput = z.infer<typeof contactPartySchema>
