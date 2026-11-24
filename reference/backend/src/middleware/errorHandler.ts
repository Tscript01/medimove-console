import type { ErrorRequestHandler } from 'express'
import { AppError } from '../errors/AppError'
import { env } from '../config/env'
import { logger } from '../utils/logger'

/**
 * Central error handler. Must be registered last, after all routes.
 * Keeps the `{ success, message }` response shape the API already uses, but no
 * longer leaks internal error details in production.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isAppError = err instanceof AppError
  const rawStatus = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode
  const httpStatus =
    typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : undefined

  const status = isAppError ? err.status : (httpStatus ?? 500)
  const message = isAppError
    ? err.message
    : status >= 500
      ? 'Internal server error'
      : 'Request could not be processed.'

  if (status >= 500) {
    logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled request error')
  } else {
    logger.warn({ method: req.method, path: req.originalUrl, status, message }, 'Request rejected')
  }

  const body: Record<string, unknown> = { success: false, message }

  // Structured, safe metadata for known errors (e.g. OTP cooldown seconds).
  if (isAppError && err.details) {
    Object.assign(body, err.details)
  }

  // Expose the underlying message only outside production to aid debugging.
  if (!isAppError && env.NODE_ENV !== 'production' && err instanceof Error) {
    body.detail = err.message
  }

  res.status(status).json(body)
}
