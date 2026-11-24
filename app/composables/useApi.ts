import { ofetch, type FetchError, type FetchOptions } from 'ofetch'
import type { ApiErrorBody } from '~/types/api'
import type { RefreshResponse } from '~/types/auth'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '~/utils/tokenStore'
import { emitAuthExpired } from '~/utils/authEvents'

/**
 * The single ofetch-based API client.
 *
 * - Bearer injection from the browser token store
 * - refresh-token rotation on every 401, retry the original request exactly once
 * - single-flight rotation (a rotated refresh token is single-use; parallel
 *   refreshes would revoke the session family)
 * - 403 ACCOUNT_SUSPENDED ends the session with no retry
 * - typed errors carrying the backend envelope { success, message, code }
 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly field?: string
  readonly details?: unknown
  readonly isNetworkError: boolean

  constructor(message: string, options: {
    status?: number
    code?: string
    field?: string
    details?: unknown
    isNetworkError?: boolean
  } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status ?? 0
    this.code = options.code
    this.field = options.field
    this.details = options.details
    this.isNetworkError = options.isNetworkError ?? false
  }
}

export interface ApiRequestOptions extends Omit<FetchOptions<'json'>, 'baseURL'> {
  /** Set false for public auth endpoints (login/refresh/etc.). */
  auth?: boolean
}

const AUTH_ENDPOINTS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/register',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/auth/password/'
]

function isAuthEndpoint(path: string): boolean {
  return AUTH_ENDPOINTS.some((prefix) => path.startsWith(prefix))
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const fetchError = error as FetchError
  const status = fetchError?.response?.status ?? 0
  const body = fetchError?.data as ApiErrorBody | undefined

  if (status === 0) {
    return new ApiError('Unable to reach the MediMove server. Check your connection and try again.', {
      code: 'NETWORK_ERROR',
      isNetworkError: true
    })
  }

  return new ApiError(body?.message || fetchError?.message || 'Request failed.', {
    status,
    code: body?.code,
    field: body?.field,
    details: body?.details
  })
}

let refreshInFlight: Promise<string> | null = null

async function rotateTokens(baseURL: string): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) throw new ApiError('No refresh token stored.', { code: 'UNAUTHORIZED', status: 401 })

      // Bare client: a 401 from /auth/refresh must never trigger another refresh.
      const data = await ofetch<RefreshResponse>(`${baseURL}/auth/refresh`, {
        method: 'POST',
        body: { refreshToken },
        retry: 0,
        timeout: 15_000
      })

      if (!data?.accessToken || !data?.refreshToken) {
        throw new ApiError('Token refresh did not return a new token pair.', { code: 'UNAUTHORIZED', status: 401 })
      }

      // Rotate: the previous refresh token is now invalid.
      setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
      return data.accessToken
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function request<T>(baseURL: string, path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { auth = true, headers: requestHeaders, ...fetchOptions } = options
  const send = (token?: string) => {
    const headers = new Headers(requestHeaders as HeadersInit | undefined)
    if (auth && token) headers.set('Authorization', `Bearer ${token}`)
    return ofetch<T>(path, {
      ...fetchOptions,
      baseURL,
      headers,
      // We implement our own single retry on 401; ofetch's own retries are off.
      retry: 0,
      timeout: 15_000
    })
  }

  try {
    return await send(auth ? getAccessToken() ?? undefined : undefined)
  } catch (error) {
    const apiError = normalizeError(error)

    if (apiError.status === 403 && apiError.code === 'ACCOUNT_SUSPENDED') {
      clearTokens()
      emitAuthExpired('Your account has been suspended. Your session has ended.')
      throw apiError
    }

    if (apiError.status === 401 && auth && !isAuthEndpoint(path)) {
      try {
        const accessToken = await rotateTokens(baseURL)
        return await send(accessToken)
      } catch (refreshError) {
        clearTokens()
        emitAuthExpired('Your session has expired. Please sign in again.')
        throw normalizeError(refreshError)
      }
    }

    throw apiError
  }
}

/** Call inside setup/composables so Nuxt runtime config is available. */
export function useApi() {
  const config = useRuntimeConfig()
  const baseURL = String(config.public.apiBaseUrl).replace(/\/$/, '')

  return {
    baseURL,
    get: <T>(path: string, options?: ApiRequestOptions) => request<T>(baseURL, path, { ...options, method: 'GET' }),
    post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      request<T>(baseURL, path, { ...options, method: 'POST', body: body as Record<string, unknown> | undefined }),
    put: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      request<T>(baseURL, path, { ...options, method: 'PUT', body: body as Record<string, unknown> | undefined }),
    patch: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      request<T>(baseURL, path, { ...options, method: 'PATCH', body: body as Record<string, unknown> | undefined }),
    delete: <T>(path: string, options?: ApiRequestOptions) => request<T>(baseURL, path, { ...options, method: 'DELETE' })
  }
}
