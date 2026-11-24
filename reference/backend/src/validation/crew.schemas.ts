import { z } from 'zod'

/**
 * Request schemas for crew invitations, profiles and documents. Kept in sync
 * with the Prisma `CrewRole`, `AvailabilityStatus`, `DocumentType` and
 * `DocumentStatus` enums.
 */

export const CREW_ROLES = ['DRIVER', 'EMT', 'PARAMEDIC', 'NURSE', 'DOCTOR', 'ATTENDANT'] as const
export const AVAILABILITY_STATUSES = ['AVAILABLE', 'ON_DUTY', 'OFFLINE', 'UNAVAILABLE'] as const
export const DOCUMENT_TYPES = [
  'IDENTITY',
  'DRIVERS_LICENSE',
  'MEDICAL_LICENSE',
  'CERTIFICATION',
  'VEHICLE_REGISTRATION',
  'VEHICLE_INSURANCE',
  'ROADWORTHINESS'
] as const
export const DOCUMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const

/** Invite someone to join a provider as crew. */
export const inviteCrewSchema = z.object({
  email: z.string().trim().email('Enter a valid email.').max(200),
  phone: z.string().trim().min(7, 'A phone number is required.').max(20),
  crewRole: z.enum(CREW_ROLES, { message: `Crew role must be one of: ${CREW_ROLES.join(', ')}.` })
})

/**
 * Accept an invitation. The caller must be authenticated and the invitation
 * must have been issued to the caller's email address, so a leaked token can
 * never be used to take over someone else's account.
 */
export const acceptInvitationSchema = z.object({
  licenseNumber: z.string().trim().max(60).optional(),
  yearsExperience: z.number().int().min(0).max(70).optional()
})

/** A crew member editing their own profile. */
export const updateCrewProfileSchema = z
  .object({
    licenseNumber: z.string().trim().max(60).nullable().optional(),
    yearsExperience: z.number().int().min(0).max(70).nullable().optional(),
    availability: z.enum(AVAILABILITY_STATUSES).optional()
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update.' })

export const crewAvailabilitySchema = z.object({ availability: z.enum(AVAILABILITY_STATUSES) })

export const submitDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES, { message: `Document type must be one of: ${DOCUMENT_TYPES.join(', ')}.` }),
  fileUrl: z.string().trim().url('A valid document URL is required.').max(500),
  expiresAt: z.coerce.date().optional()
})

export const reviewDocumentSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED'], { message: 'Status must be APPROVED or REJECTED.' }),
    rejectionReason: z.string().trim().max(300).optional()
  })
  .refine((data) => data.status !== 'REJECTED' || Boolean(data.rejectionReason), {
    message: 'A reason is required when rejecting a document.',
    path: ['rejectionReason']
  })

export const assignAmbulanceSchema = z.object({ ambulanceId: z.string().trim().min(1, 'An ambulance is required.') })

export const deactivateCrewSchema = z.object({ reason: z.string().trim().max(300).optional() })

export type InviteCrewInput = z.infer<typeof inviteCrewSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
export type UpdateCrewProfileInput = z.infer<typeof updateCrewProfileSchema>
export type SubmitDocumentInput = z.infer<typeof submitDocumentSchema>
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>
