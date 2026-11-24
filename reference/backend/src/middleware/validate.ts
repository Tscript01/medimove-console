import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'
import { AppError } from '../errors/AppError'

/**
 * Parses `value` with `schema`, throwing a 400 `VALIDATION_ERROR` with a
 * field-level message on failure. Used for query strings and other inputs that
 * cannot be replaced in place (Express 5 makes `req.query` read-only).
 */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, source = 'request'): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue?.path.join('.') || source
    throw new AppError(400, `${field}: ${issue?.message ?? 'Invalid request.'}`, {
      code: 'VALIDATION_ERROR',
      field
    })
  }
  return result.data
}

/**
 * Validates `req.body` against a zod schema and replaces it with the parsed
 * (and normalised) value. Invalid input is rejected by the central error
 * handler as a 400 with a field-level message.
 */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const issue = result.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return next(
        new AppError(400, `${field}: ${issue?.message ?? 'Invalid request body.'}`, {
          code: 'VALIDATION_ERROR',
          field
        })
      )
    }
    req.body = result.data
    next()
  }
}
