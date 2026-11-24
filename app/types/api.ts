/** Backend envelope: { success: false, message, code } (openapi.yaml). */
export interface ApiErrorBody {
  success?: false
  message?: string
  code?: string
  field?: string
  details?: unknown
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface Paginated<T> {
  success: boolean
  data: T[]
  pagination?: Pagination
}
