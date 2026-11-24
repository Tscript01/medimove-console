import { prisma } from '../utils/prisma'
import { logger } from '../utils/logger'
import { AppError } from '../errors/AppError'
import type { Role } from '../auth/permissions'

/**
 * Append-only audit trail for sensitive and administrative operations.
 *
 * `recordAudit` is best-effort by default: an audit failure is logged loudly but
 * never breaks the request. Pass `strict` (and, for atomicity, a transaction
 * client) for operations where a missing audit record must abort the change.
 */

export interface AuditInput {
  actorId?: string | null
  actorRole?: Role | null
  action: string
  resourceType: string
  resourceId?: string | null
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

export async function recordAudit(input: AuditInput, client: any = prisma, strict = false): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null
      }
    })
  } catch (err) {
    logger.error({ err, action: input.action, resourceType: input.resourceType }, 'Failed to write audit log')
    if (strict) {
      throw new AppError(500, 'Failed to record audit log.')
    }
  }
}
