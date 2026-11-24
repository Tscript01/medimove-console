import type { RequestHandler } from 'express'
import { prisma } from '../utils/prisma'
import { AppError } from '../errors/AppError'
import { currentUser } from '../auth/context'
import { Role, type Role as RoleType } from '../auth/permissions'
import { recordAudit } from '../services/auditService'
import { parseOrThrow } from '../middleware/validate'
import { paginationMeta, parsePagination } from '../utils/pagination'
import { requestMeta } from '../utils/requestMeta'
import { toAdminUser, toBooking } from '../utils/serializers'
import {
  activateUser,
  getOperationalReport,
  getUserForAdmin,
  listAdminBookings,
  suspendUser
} from '../services/adminService'
import {
  adminListBookingsQuerySchema,
  reportQuerySchema,
  suspendUserSchema
} from '../validation/admin.schemas'
import type { UpdateUserRoleInput } from '../validation/admin.schemas'

/** User listing keeps a slightly larger page (default 50) than other lists. */
function parseUserPagination(query: Record<string, unknown>): { page: number; limit: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
  const rawLimit = Number.parseInt(String(query.limit ?? '50'), 10) || 50
  const limit = Math.min(200, Math.max(1, rawLimit))
  return { page, limit }
}

// GET /api/admin/users (requires admin:users:read)
export const listUsersController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { page, limit } = parseUserPagination(req.query as Record<string, unknown>)
  const where: Record<string, unknown> = {}

  if (actor.role === Role.STATE_ADMIN) {
    // A state administrator only ever sees users within their own state.
    if (!actor.stateId) {
      res.json({ success: true, users: [], page, limit, total: 0 })
      return
    }
    where.stateId = actor.stateId
  } else if (actor.role === Role.PLATFORM_ADMIN) {
    if (typeof req.query.stateId === 'string' && req.query.stateId) where.stateId = req.query.stateId
    if (typeof req.query.role === 'string' && req.query.role) where.role = req.query.role
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit })
  ])

  res.json({ success: true, users: users.map(toAdminUser), page, limit, total })
}

/**
 * Resolves the scope columns for a role and validates that the required scope
 * is present and refers to a real record. Scopes that do not apply to the role
 * are cleared so a user can never carry stale, over-broad access.
 */
async function resolveScope(role: RoleType, input: UpdateUserRoleInput) {
  const data: { stateId: string | null; hospitalId: string | null; providerId: string | null } = {
    stateId: null,
    hospitalId: null,
    providerId: null
  }

  if (role === Role.STATE_ADMIN || role === Role.DISPATCHER) {
    if (!input.stateId) throw new AppError(400, 'A stateId is required for this role.', { code: 'SCOPE_REQUIRED', field: 'stateId' })
    const state = await prisma.state.findUnique({ where: { id: input.stateId } })
    if (!state) throw new AppError(400, 'Unknown stateId.', { code: 'SCOPE_INVALID', field: 'stateId' })
    data.stateId = input.stateId
  } else if (role === Role.HOSPITAL_STAFF) {
    if (!input.hospitalId) throw new AppError(400, 'A hospitalId is required for this role.', { code: 'SCOPE_REQUIRED', field: 'hospitalId' })
    const hospital = await prisma.hospital.findUnique({ where: { id: input.hospitalId } })
    if (!hospital) throw new AppError(400, 'Unknown hospitalId.', { code: 'SCOPE_INVALID', field: 'hospitalId' })
    data.hospitalId = input.hospitalId
  } else if (role === Role.CREW || role === Role.PROVIDER_ADMIN) {
    if (!input.providerId) throw new AppError(400, 'A providerId is required for this role.', { code: 'SCOPE_REQUIRED', field: 'providerId' })
    const provider = await prisma.ambulanceProvider.findUnique({ where: { id: input.providerId } })
    if (!provider) throw new AppError(400, 'Unknown providerId.', { code: 'SCOPE_INVALID', field: 'providerId' })
    data.providerId = input.providerId
  }

  return data
}

// PATCH /api/admin/users/:id/role (requires admin:roles:assign)
export const updateUserRoleController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const targetId = String(req.params.id ?? '')
  const input = req.body as UpdateUserRoleInput

  if (targetId === actor.userId) {
    // Prevents an administrator locking themselves (or the platform) out.
    throw new AppError(400, 'You cannot change your own role.', { code: 'SELF_ROLE_CHANGE' })
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target) throw new AppError(404, 'User not found.', { code: 'USER_NOT_FOUND' })

  const scope = await resolveScope(input.role, input)

  // The change and its audit record are committed atomically.
  const updated = await prisma.$transaction(async (tx: any) => {
    const user = await tx.user.update({
      where: { id: targetId },
      data: { role: input.role, ...scope }
    })
    await recordAudit(
      {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'user.role.update',
        resourceType: 'User',
        resourceId: targetId,
        metadata: {
          from: target.role ?? null,
          to: input.role,
          stateId: scope.stateId,
          hospitalId: scope.hospitalId,
          providerId: scope.providerId
        },
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null
      },
      tx,
      true
    )
    return user
  })

  res.json({ success: true, user: toAdminUser(updated) })
}

// GET /api/admin/audit-logs (requires admin:audit:read)
export const listAuditLogsController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const window = parsePagination(req.query as Record<string, unknown>)
  const where: Record<string, unknown> = {}

  if (actor.role === Role.STATE_ADMIN) {
    // A state administrator only sees audit entries produced by users in their
    // own state.
    if (!actor.stateId) {
      res.json({ success: true, logs: [], page: window.page, limit: window.limit, total: 0 })
      return
    }
    const scopedUsers = await prisma.user.findMany({ where: { stateId: actor.stateId }, select: { id: true } })
    const ids = scopedUsers.map((u: { id: string }) => u.id)
    where.actorId = { in: ids.length ? ids : ['__none__'] }
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: window.skip, take: window.take })
  ])

  res.json({ success: true, logs, page: window.page, limit: window.limit, total })
}

// GET /api/admin/users/:id (requires admin:users:read)
export const getUserController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const user = await getUserForAdmin(actor, String(req.params.id ?? ''))
  res.json({ success: true, user: toAdminUser(user) })
}

// POST /api/admin/users/:id/suspend (requires admin:users:manage)
export const suspendUserController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const input = parseOrThrow(suspendUserSchema, req.body ?? {}, 'body')
  const user = await suspendUser(actor, String(req.params.id ?? ''), input.reason, requestMeta(req))
  res.json({ success: true, user: toAdminUser(user) })
}

// POST /api/admin/users/:id/activate (requires admin:users:manage)
export const activateUserController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const user = await activateUser(actor, String(req.params.id ?? ''), requestMeta(req))
  res.json({ success: true, user: toAdminUser(user) })
}

// GET /api/admin/bookings (requires booking:read:all or booking:read:state)
export const listAdminBookingsController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const query = parseOrThrow(adminListBookingsQuerySchema, req.query, 'query')
  const window = parsePagination(query)

  const { items, total } = await listAdminBookings(actor, query, window)
  res.json({
    success: true,
    bookings: items.map(toBooking),
    pagination: paginationMeta(total, window)
  })
}

// GET /api/admin/reports/overview (requires admin:reports:read)
export const getOperationalReportController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const query = parseOrThrow(reportQuerySchema, req.query, 'query')
  const report = await getOperationalReport(actor, query)
  res.json({ success: true, report })
}
