import { prisma } from '../utils/prisma'
import type { ConsentType } from '../generated/prisma/enums'
import { CONSENT_TYPES } from '../validation/profile.schemas'

/**
 * Consent records are append-only. Granting appends a row; withdrawing stamps
 * `withdrawnAt` on every still-active row for that type. Nothing is ever
 * hard-deleted, so the full history (grants, version changes, withdrawals) is
 * preserved for audit and privacy reporting.
 */

export interface ConsentMeta {
  ipAddress?: string | null
  userAgent?: string | null
}

export function isConsentType(value: string): value is ConsentType {
  return (CONSENT_TYPES as readonly string[]).includes(value)
}

export async function listConsents(userId: string) {
  return prisma.consentRecord.findMany({ where: { userId }, orderBy: [{ grantedAt: 'desc' }] })
}

/** Current state (newest record wins) for a single consent type. */
export async function getConsentState(userId: string, type: ConsentType) {
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, type },
    orderBy: [{ grantedAt: 'desc' }]
  })

  return {
    type,
    granted: Boolean(latest && latest.withdrawnAt == null),
    version: latest?.version ?? null,
    grantedAt: latest?.grantedAt ?? null,
    withdrawnAt: latest?.withdrawnAt ?? null
  }
}

/** Current state for every consent type (so the client always sees all four). */
export async function getConsentSummary(userId: string) {
  return Promise.all(CONSENT_TYPES.map((type) => getConsentState(userId, type)))
}

export async function hasActiveConsent(userId: string, type: ConsentType): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, type },
    orderBy: [{ grantedAt: 'desc' }]
  })
  return Boolean(latest && latest.withdrawnAt == null)
}

/** Grants consent. Idempotent when the same version is already active. */
export async function grantConsent(
  userId: string,
  type: ConsentType,
  version: string,
  meta: ConsentMeta = {}
) {
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, type },
    orderBy: [{ grantedAt: 'desc' }]
  })

  if (latest && latest.withdrawnAt == null && latest.version === version) {
    return latest
  }

  return prisma.consentRecord.create({
    data: {
      userId,
      type,
      version,
      grantedAt: new Date(),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null
    }
  })
}

/** Withdraws consent for a type. Idempotent: withdrawing when inactive is a no-op. */
export async function withdrawConsent(userId: string, type: ConsentType) {
  await prisma.consentRecord.updateMany({
    where: { userId, type, withdrawnAt: null },
    data: { withdrawnAt: new Date() }
  })
  return getConsentState(userId, type)
}
