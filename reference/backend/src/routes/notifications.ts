import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { requirePermission } from '../middleware/authorize'
import { PERMISSIONS } from '../auth/permissions'
import {
  cancelNotificationController,
  getMyNotification,
  getNotification,
  getNotificationStats,
  listMyNotifications,
  listNotifications,
  processNotifications,
  retryNotificationController
} from '../controllers/notificationController'

const router = Router()

// --- Caller's own feed ------------------------------------------------------

// GET /api/notifications (Authenticated) — always scoped to the caller.
router.get(
  '/notifications',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_READ_OWN),
  listMyNotifications
)

// GET /api/notifications/:id (Authenticated, own)
router.get(
  '/notifications/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_READ_OWN),
  getMyNotification
)

// --- Administration ---------------------------------------------------------

// GET /api/admin/notifications (state/platform admin)
router.get(
  '/admin/notifications',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_READ_ALL),
  listNotifications
)

// GET /api/admin/notifications/stats (state/platform admin)
router.get(
  '/admin/notifications/stats',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_READ_ALL),
  getNotificationStats
)

// POST /api/admin/notifications/process (admin) — force a worker tick
router.post(
  '/admin/notifications/process',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_MANAGE),
  processNotifications
)

// GET /api/admin/notifications/:id (state/platform admin)
router.get(
  '/admin/notifications/:id',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_READ_ALL),
  getNotification
)

// POST /api/admin/notifications/:id/retry (admin)
router.post(
  '/admin/notifications/:id/retry',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_MANAGE),
  retryNotificationController
)

// POST /api/admin/notifications/:id/cancel (admin)
router.post(
  '/admin/notifications/:id/cancel',
  authenticateToken,
  requirePermission(PERMISSIONS.NOTIFICATION_MANAGE),
  cancelNotificationController
)

export default router
