import type { RequestHandler } from 'express'
import { currentUser } from '../auth/context'
import { parseOrThrow } from '../middleware/validate'
import { recordAudit } from '../services/auditService'
import { requestMeta } from '../utils/requestMeta'
import { toNotification, toNotificationEvent } from '../utils/serializers'
import {
  cancelNotification,
  getNotificationWithEvents,
  getUserNotification,
  listAllNotifications,
  listUserNotifications,
  notificationStats,
  retryNotification
} from '../services/notificationService'
import { runNotificationWorkerOnce } from '../services/notificationWorker'
import {
  listNotificationsQuerySchema,
  listMyNotificationsQuerySchema
} from '../validation/notification.schemas'

/**
 * Notification HTTP handlers. All delivery logic lives in
 * `services/notificationService`; these handlers only translate HTTP. The
 * caller's own feed is always scoped to their session — the `userId` in a query
 * is never trusted for the personal endpoints.
 */

// GET /api/notifications (Authenticated) — the caller's own feed
export const listMyNotifications: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const query = parseOrThrow(listMyNotificationsQuerySchema, req.query, 'query')
  const notifications = await listUserNotifications(actor.userId, query)
  res.json({ success: true, notifications: notifications.map(toNotification) })
}

// GET /api/notifications/:id (Authenticated, own)
export const getMyNotification: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const { notification, events } = await getUserNotification(actor.userId, String(req.params.id))
  res.json({
    success: true,
    notification: toNotification(notification),
    events: events.map(toNotificationEvent)
  })
}

// GET /api/admin/notifications (requires notification:read:all)
export const listNotifications: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listNotificationsQuerySchema, req.query, 'query')
  const notifications = await listAllNotifications(query)
  res.json({ success: true, notifications: notifications.map(toNotification) })
}

// GET /api/admin/notifications/stats (requires notification:read:all)
export const getNotificationStats: RequestHandler = async (_req, res) => {
  const stats = await notificationStats()
  res.json({ success: true, stats })
}

// GET /api/admin/notifications/:id (requires notification:read:all)
export const getNotification: RequestHandler = async (req, res) => {
  const { notification, events } = await getNotificationWithEvents(String(req.params.id))
  res.json({
    success: true,
    notification: toNotification(notification),
    events: events.map(toNotificationEvent)
  })
}

// POST /api/admin/notifications/:id/retry (requires notification:manage)
export const retryNotificationController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const notification = await retryNotification(String(req.params.id))

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'notification.retry',
    resourceType: 'Notification',
    resourceId: notification.id,
    ...requestMeta(req)
  })

  res.json({ success: true, notification: toNotification(notification) })
}

// POST /api/admin/notifications/:id/cancel (requires notification:manage)
export const cancelNotificationController: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const notification = await cancelNotification(String(req.params.id))

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'notification.cancel',
    resourceType: 'Notification',
    resourceId: notification.id,
    ...requestMeta(req)
  })

  res.json({ success: true, notification: toNotification(notification) })
}

// POST /api/admin/notifications/process (requires notification:manage) — force a
// worker tick. Useful when the interval worker is disabled or for an operator to
// drain the queue immediately.
export const processNotifications: RequestHandler = async (req, res) => {
  const actor = currentUser(req)
  const result = await runNotificationWorkerOnce()

  await recordAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'notification.process',
    resourceType: 'Notification',
    metadata: { ...result },
    ...requestMeta(req)
  })

  res.json({ success: true, result })
}
