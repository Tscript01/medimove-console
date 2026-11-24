import { z } from 'zod'

/**
 * Shared pagination helpers.
 *
 * Lists are paginated so a caller can never pull an unbounded set of records.
 * `page` is 1-based and `limit` is clamped, so a hostile query string can never
 * ask for an enormous page. Every paginated response carries a `pagination`
 * object describing the window and the total, so a client can page
 * deterministically.
 */

export interface Pagination {
  page: number
  limit: number
  skip: number
  take: number
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/** Zod fragment for `page`/`limit`, reusable inside any list query schema. */
export const paginationQueryFields = {
  page: z.coerce.number().int().min(1).max(100000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
} as const

export interface ParsePaginationOptions {
  defaultLimit?: number
  maxLimit?: number
}

/**
 * Normalises `page`/`limit` from an untrusted query object. Tolerant of junk
 * (falls back to the default) but never returns an out-of-range window.
 */
export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  options: ParsePaginationOptions = {}
): Pagination {
  const defaultLimit = options.defaultLimit ?? 20
  const maxLimit = options.maxLimit ?? 100

  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
  const rawLimit = Number.parseInt(String(query.limit ?? String(defaultLimit)), 10) || defaultLimit
  const limit = Math.min(maxLimit, Math.max(1, rawLimit))

  return { page, limit, skip: (page - 1) * limit, take: limit }
}

/** Builds the response `pagination` block from a total and the parsed window. */
export function paginationMeta(total: number, window: Pick<Pagination, 'page' | 'limit'>): PaginationMeta {
  const totalPages = window.limit > 0 ? Math.ceil(total / window.limit) : 0
  return {
    page: window.page,
    limit: window.limit,
    total,
    totalPages,
    hasNext: window.page < totalPages,
    hasPrev: window.page > 1
  }
}
