import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'

/**
 * Emergency contacts are strictly owner-scoped: every function takes the caller's
 * `userId` and every lookup re-checks ownership. A contact id alone is never
 * enough to read or mutate a row.
 */

export interface EmergencyContactCreate {
  fullName: string
  relationship: string
  phone: string
  email?: string | null
  isPrimary?: boolean
}

export interface EmergencyContactUpdate {
  fullName?: string
  relationship?: string
  phone?: string
  email?: string | null
  isPrimary?: boolean
}

function notFound(): AppError {
  return new AppError(404, 'Emergency contact not found.', { code: 'EMERGENCY_CONTACT_NOT_FOUND' })
}

/** Loads a contact only if it belongs to `userId`; otherwise 404 (never 403). */
async function loadOwned(userId: string, id: string) {
  const contact = await prisma.emergencyContact.findUnique({ where: { id } })
  if (!contact || contact.userId !== userId) throw notFound()
  return contact
}

export async function listEmergencyContacts(userId: string) {
  return prisma.emergencyContact.findMany({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
  })
}

export async function createEmergencyContact(userId: string, input: EmergencyContactCreate) {
  const existing = await prisma.emergencyContact.count({ where: { userId } })
  // The first contact is primary by default; otherwise honour the request.
  const isPrimary = input.isPrimary === true || existing === 0

  return prisma.$transaction(async (tx: any) => {
    if (isPrimary) {
      await tx.emergencyContact.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })
    }
    return tx.emergencyContact.create({
      data: {
        userId,
        fullName: input.fullName,
        relationship: input.relationship,
        phone: input.phone,
        email: input.email ?? null,
        isPrimary
      }
    })
  })
}

export async function updateEmergencyContact(userId: string, id: string, input: EmergencyContactUpdate) {
  await loadOwned(userId, id)

  return prisma.$transaction(async (tx: any) => {
    if (input.isPrimary === true) {
      await tx.emergencyContact.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })
    }
    return tx.emergencyContact.update({ where: { id }, data: { ...input } })
  })
}

export async function deleteEmergencyContact(userId: string, id: string) {
  const contact = await loadOwned(userId, id)

  await prisma.$transaction(async (tx: any) => {
    await tx.emergencyContact.delete({ where: { id } })
    if (contact.isPrimary) {
      // Keep a sensible default: promote the oldest remaining contact.
      const remaining = await tx.emergencyContact.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }]
      })
      if (remaining[0]) {
        await tx.emergencyContact.update({ where: { id: remaining[0].id }, data: { isPrimary: true } })
      }
    }
  })
}

export async function setPrimaryEmergencyContact(userId: string, id: string) {
  await loadOwned(userId, id)

  return prisma.$transaction(async (tx: any) => {
    await tx.emergencyContact.updateMany({ where: { userId, isPrimary: true }, data: { isPrimary: false } })
    return tx.emergencyContact.update({ where: { id }, data: { isPrimary: true } })
  })
}
