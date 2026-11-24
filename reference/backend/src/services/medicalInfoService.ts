import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import type { ConsentType } from '../generated/prisma/enums'
import { hasActiveConsent } from './consentService'

/**
 * Basic medical information, gated behind an active MEDICAL_DATA consent.
 *
 * This data is strictly owner-only: every function takes the caller's own
 * `userId` and there is no code path that returns one user's medical record to
 * another user (not even a platform admin). Without consent, reads and writes
 * fail closed with 403 and the record's existence is never revealed.
 */

const MEDICAL_DATA: ConsentType = 'MEDICAL_DATA'

export interface MedicalInfoInput {
  bloodType?: string | null
  allergies?: string | null
  chronicConditions?: string | null
  currentMedications?: string | null
}

async function requireMedicalConsent(userId: string): Promise<void> {
  if (!(await hasActiveConsent(userId, MEDICAL_DATA))) {
    throw new AppError(403, 'Medical information requires an active medical-data consent.', {
      code: 'MEDICAL_CONSENT_REQUIRED'
    })
  }
}

export async function getMedicalInfo(userId: string) {
  await requireMedicalConsent(userId)
  return prisma.patientMedicalInfo.findUnique({ where: { userId } })
}

export async function upsertMedicalInfo(userId: string, input: MedicalInfoInput) {
  await requireMedicalConsent(userId)
  return prisma.patientMedicalInfo.upsert({
    where: { userId },
    create: { userId, ...input },
    update: { ...input }
  })
}

export async function deleteMedicalInfo(userId: string) {
  await requireMedicalConsent(userId)
  await prisma.patientMedicalInfo.deleteMany({ where: { userId } })
}
