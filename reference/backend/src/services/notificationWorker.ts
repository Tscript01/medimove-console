import { env } from '../config/env'
import { logger } from '../utils/logger'
import { processPendingNotifications, type ProcessBatchResult } from './notificationService'

/**
 * In-process notification worker.
 *
 * There is no external job runner in this deployment, so the queue is drained by
 * a single interval timer inside the API process. The worker is deliberately
 * dumb: it only ever calls `processPendingNotifications`, which owns the retry
 * and failure logic. Three properties matter:
 *
 *  1. **Non-blocking.** The tick is fire-and-forget and a `running` guard stops a
 *     slow provider from piling up overlapping ticks.
 *  2. **Unref'd.** The timer never keeps the process alive on its own, so a
 *     graceful shutdown is not delayed by it.
 *  3. **Disableable.** `NOTIFICATION_WORKER_ENABLED=false` turns it off (used in
 *     tests and when a dedicated worker process is run instead).
 */

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/** Runs one drain cycle. Exposed so an admin endpoint or a script can force it. */
export async function runNotificationWorkerOnce(): Promise<ProcessBatchResult> {
  return processPendingNotifications()
}

/** Starts the interval worker. Idempotent — a second call is a no-op. */
export function startNotificationWorker(): void {
  if (!env.NOTIFICATION_WORKER_ENABLED) {
    logger.info('Notification worker is disabled (NOTIFICATION_WORKER_ENABLED=false)')
    return
  }
  if (timer) return

  const intervalMs = env.NOTIFICATION_POLL_INTERVAL_SECONDS * 1000
  timer = setInterval(() => {
    if (running) return
    running = true
    processPendingNotifications()
      .then((result) => {
        if (result.processed > 0) logger.info({ ...result }, 'Notification worker delivered a batch')
      })
      .catch((err) => logger.error({ err }, 'Notification worker tick failed'))
      .finally(() => {
        running = false
      })
  }, intervalMs)

  // Never keep the process alive solely for the worker.
  timer.unref?.()
  logger.info({ intervalSeconds: env.NOTIFICATION_POLL_INTERVAL_SECONDS }, 'Notification worker started')
}

/** Stops the interval worker (called during graceful shutdown). */
export function stopNotificationWorker(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
  logger.info('Notification worker stopped')
}
