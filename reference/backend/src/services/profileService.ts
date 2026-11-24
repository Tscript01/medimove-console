import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { issueOtp, verifyOtp } from './otpService'
import { deliverOtp } from './notificationService'

/**
 * Patient profile & onboarding.
 *
 * The profile is an aggregate over `User` (identity + verification status),
 * `PatientProfile` (onboarding fields) and `EmergencyContact`. Completion is
 * derived on read so it can never drift from the underlying data.
 */

export interface ProfileUpdate {
  fullName?: string
  phone?: string
  dateOfBirth?: Date
  preferredLanguage?: string
}

interface CompletionStep {
  key: string
  label: string
  done: boolean
}

export interface Completion {
  percentage: number
  completed: number
  total: number
  isComplete: boolean
  steps: CompletionStep[]
}

/** Derives onboarding completion from the user, their profile and contacts. */
export function computeCompletion(
  user: { fullName?: string | null; emailVerified?: boolean | null; phoneVerified?: boolean | null },
  profile: { dateOfBirth?: Date | null; preferredLanguage?: string | null } | null,
  contacts: Array<{ isPrimary?: boolean | null }>
): Completion {
  const steps: CompletionStep[] = [
    { key: 'fullName', label: 'Full name', done: Boolean(user.fullName?.trim()) },
    { key: 'email', label: 'Email verified', done: Boolean(user.emailVerified) },
    { key: 'phone', label: 'Phone verified', done: Boolean(user.phoneVerified) },
    { key: 'dateOfBirth', label: 'Date of birth', done: Boolean(profile?.dateOfBirth) },
    { key: 'preferredLanguage', label: 'Preferred language', done: Boolean(profile?.preferredLanguage) },
    { key: 'emergencyContact', label: 'Emergency contact', done: contacts.length > 0 },
    {
      key: 'primaryEmergencyContact',
      label: 'Primary emergency contact',
      done: contacts.some((c) => c.isPrimary)
    }
  ]

  const completed = steps.filter((s) => s.done).length
  return {
    percentage: Math.round((completed / steps.length) * 100),
    completed,
    total: steps.length,
    isComplete: completed === steps.length,
    steps
  }
}

export async function getProfileAggregate(userId: string) {
  const [user, profile, contacts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.patientProfile.findUnique({ where: { userId } }),
    prisma.emergencyContact.findMany({ where: { userId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] })
  ])

  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })

  return { user, profile, contacts, completion: computeCompletion(user, profile, contacts) }
}

export async function updateProfile(userId: string, input: ProfileUpdate) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })

  const userData: {
    fullName?: string
    phone?: string
    phoneVerified?: boolean
    phoneVerifiedAt?: Date | null
  } = {}
  if (input.fullName !== undefined) userData.fullName = input.fullName
  if (input.phone !== undefined && input.phone !== user.phone) {
    userData.phone = input.phone
    // A new number is unverified until it is proven again.
    userData.phoneVerified = false
    userData.phoneVerifiedAt = null
  }

  const profileData: { dateOfBirth?: Date; preferredLanguage?: string } = {}
  if (input.dateOfBirth !== undefined) profileData.dateOfBirth = input.dateOfBirth
  if (input.preferredLanguage !== undefined) profileData.preferredLanguage = input.preferredLanguage

  const updatedUser = Object.keys(userData).length
    ? await prisma.user.update({ where: { id: userId }, data: userData })
    : user

  let profile = await prisma.patientProfile.findUnique({ where: { userId } })
  if (!profile) {
    // Persist the language explicitly (rather than relying on the column
    // default) so the stored row is identical everywhere.
    profile = await prisma.patientProfile.create({
      data: { userId, preferredLanguage: 'en', ...profileData }
    })
  } else if (Object.keys(profileData).length) {
    profile = await prisma.patientProfile.update({ where: { userId }, data: profileData })
  }

  return { user: updatedUser, profile }
}

/** Issues a PHONE_VERIFICATION code for the number currently on the account. */
export async function requestPhoneVerification(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })

  if (user.phoneVerified) {
    return { alreadyVerified: true as const }
  }

  const otp = await issueOtp({ userId, purpose: 'PHONE_VERIFICATION', phone: user.phone })
  await deliverOtp({
    userId,
    channel: 'SMS',
    to: user.phone,
    code: otp.code,
    purpose: 'PHONE_VERIFICATION',
    expiresInMinutes: otp.expiresInMinutes
  })

  return {
    alreadyVerified: false as const,
    expiresAt: otp.expiresAt,
    expiresInMinutes: otp.expiresInMinutes
  }
}

/**
 * Verifies the code and marks the phone verified. The code is bound to the exact
 * number it was issued for, so a phone change between request and verify cannot
 * be used to verify the new number.
 */
export async function verifyPhone(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })

  await verifyOtp({ userId, purpose: 'PHONE_VERIFICATION', code, expectedPhone: user.phone })

  return prisma.user.update({
    where: { id: userId },
    data: { phoneVerified: true, phoneVerifiedAt: new Date() }
  })
}
