import { AxiosError, create, type InternalAxiosRequestConfig } from 'axios'
import { emitAuthExpired } from './authEvents'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokenStorage'

// Base URL comes from .env; falls back to the deployed backend.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://interbackend.onrender.com/api'

export const api = create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000, // 15s
})

// A bare client used only for token rotation. It has no interceptors, so a 401
// from /auth/refresh can never trigger another refresh (which would loop).
const refreshClient = create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

// A 401 on these endpoints means "bad credentials", not "expired access token",
// so we must never try to refresh-and-retry them.
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/register', '/auth/verify-email', '/auth/password/']

function isAuthEndpoint(url?: string): boolean {
  if (!url) return false
  return AUTH_ENDPOINTS.some((path) => url.includes(path))
}

export interface ApiError extends Error {
  status?: number
  code?: string
  field?: string
  details?: unknown
}

function toError(error: AxiosError): ApiError {
  if (error.response) {
    const data = error.response.data as
      | { message?: string; error?: string; code?: string; field?: string; details?: unknown }
      | undefined
    const message = data?.message || data?.error || `Request failed with status ${error.response.status}`
    const normalized = new Error(message) as ApiError
    normalized.status = error.response.status
    normalized.code = data?.code
    normalized.field = data?.field
    normalized.details = data?.details
    return normalized
  }

  if (error.request) {
    // Request made but no response received (network down / cold start).
    return new Error('Unable to reach the MediMove server. Check your connection and try again.') as ApiError
  }

  return new Error(error.message || 'An unexpected error occurred') as ApiError
}

// Attach the stored Bearer access token to every request.
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await getAccessToken()
      if (token) config.headers.Authorization = `Bearer ${token}`
    } catch (error) {
      console.error('Failed to retrieve auth token from SecureStore:', error)
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Single-flight refresh: concurrent 401s share one rotation. The backend
// rotates (and invalidates) the refresh token on every use, so two parallel
// rotations would revoke the whole session family.
let refreshPromise: Promise<string> | null = null

async function rotateTokens(): Promise<string> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) throw new Error('No refresh token stored.')

  const response = await refreshClient.post('/auth/refresh', { refreshToken })
  const data = response.data as { accessToken?: string; refreshToken?: string }
  if (!data?.accessToken || !data?.refreshToken) throw new Error('Token refresh failed.')

  await setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
  return data.accessToken
}

// Unwrap the payload, and on a 401 transparently rotate the refresh token once
// and replay the original request.
api.interceptors.response.use(
  (response) => response.data,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
    const status = error.response?.status

    if (status === 401 && original && !original._retry && !isAuthEndpoint(original.url)) {
      original._retry = true
      try {
        if (!refreshPromise) {
          refreshPromise = rotateTokens().finally(() => {
            refreshPromise = null
          })
        }
        const accessToken = await refreshPromise
        original.headers.Authorization = `Bearer ${accessToken}`
        return api(original)
      } catch {
        // Refresh token is gone/revoked/expired: end the session.
        await clearTokens()
        emitAuthExpired()
        return Promise.reject(toError(error))
      }
    }

    return Promise.reject(toError(error))
  }
)

/**
 * Typed request helpers. The response interceptor resolves to the unwrapped
 * payload, so `http.get<T>` genuinely resolves to `T` (not an AxiosResponse).
 */
export const http = {
  get: <T>(url: string, config?: Parameters<typeof api.get>[1]) => api.get<T, T>(url, config),
  post: <T>(url: string, data?: unknown, config?: Parameters<typeof api.post>[2]) => api.post<T, T>(url, data, config),
  put: <T>(url: string, data?: unknown, config?: Parameters<typeof api.put>[2]) => api.put<T, T>(url, data, config),
  patch: <T>(url: string, data?: unknown, config?: Parameters<typeof api.patch>[2]) =>
    api.patch<T, T>(url, data, config),
  delete: <T>(url: string, config?: Parameters<typeof api.delete>[1]) => api.delete<T, T>(url, config),
}
