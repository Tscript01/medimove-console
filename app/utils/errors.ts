import type { ApiError } from '~/composables/useApi'

/** A 404 may mean "not in your scope" — never reveal that another record exists. */
export function isOutOfScope(error: ApiError | null | undefined): boolean {
  return Boolean(error && (error.status === 403 || error.status === 404))
}

export function isNetworkError(error: ApiError | null | undefined): boolean {
  return Boolean(error?.isNetworkError || error?.code === 'NETWORK_ERROR')
}

/** Show the real backend message, plus its code when present. */
export function errorMessage(error: ApiError | null | undefined, fallback: string): string {
  if (!error) return fallback
  return error.code ? `${error.message} (${error.code})` : error.message
}
