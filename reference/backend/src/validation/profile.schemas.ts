import { z } from 'zod'

/**
 * Request schemas for patient profile & onboarding.
 *
 * Schemas strip unknown keys by default, so a client can never smuggle extra
 * fields (role, wallet balance, userId, …) into an update — the parsed value
 * replaces the request body.
 */

/** Languages the app ships copy for. Extend alongside the frontend. */
export const SUPPORTED_LANGUAGES = ['en', 'ha', 'ig', 'yo', 'pcm'] as const

/** Kept in sync with the `ConsentType` Prisma enum. */
export const CONSENT_TYPES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MEDICAL_DATA', 'MARKETING'] as const

const phone = z
  .string()
  .trim()
  .min(7, 'Enter a valid phone number.')
  .max(20, 'Enter a valid phone number.')
  .regex(/^[+0-9()\-\s]+$/, 'Enter a valid phone number.')

const dateOfBirth = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date (e.g. 1990-05-20).')
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() <= Date.now(), 'Date of birth cannot be in the future.')
  .refine((d) => d.getUTCFullYear() >= 1900, 'Enter a valid date of birth.')

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required.').max(120).optional(),
    phone: phone.optional(),
    dateOfBirth: dateOfBirth.optional(),
    preferredLanguage: z.enum(SUPPORTED_LANGUAGES, {
      message: `Preferred language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}.`
    }).optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.'
  })

export const verifyPhoneSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.')
})

export const createEmergencyContactSchema = z.object({
  fullName: z.string().trim().min(2, 'Contact name is required.').max(120),
  relationship: z.string().trim().min(2, 'Relationship is required.').max(60),
  phone,
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(160).optional(),
  isPrimary: z.boolean().optional()
})

export const updateEmergencyContactSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Contact name is required.').max(120).optional(),
    relationship: z.string().trim().min(2, 'Relationship is required.').max(60).optional(),
    phone: phone.optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(160).nullable().optional(),
    isPrimary: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.'
  })

export const grantConsentSchema = z.object({
  type: z.enum(CONSENT_TYPES, {
    message: `Consent type must be one of: ${CONSENT_TYPES.join(', ')}.`
  }),
  version: z.string().trim().min(1, 'A consent version is required.').max(40)
})

const medicalField = z.string().trim().max(1000).nullable().optional()

export const medicalInfoSchema = z
  .object({
    bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(),
    allergies: medicalField,
    chronicConditions: medicalField,
    currentMedications: medicalField
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.'
  })

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type CreateEmergencyContactInput = z.infer<typeof createEmergencyContactSchema>
export type UpdateEmergencyContactInput = z.infer<typeof updateEmergencyContactSchema>
export type GrantConsentInput = z.infer<typeof grantConsentSchema>
export type MedicalInfoInput = z.infer<typeof medicalInfoSchema>
