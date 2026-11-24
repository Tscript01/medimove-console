/**
 * Browser token storage. This console is client-rendered (Nuxt `ssr: false`),
 * so tokens never pass through a server render. Refresh tokens rotate on every
 * use — always overwrite both values from every token response.
 *
 * The frontend gate is UX only. The backend re-reads role/scope from the
 * database on every request and is the security boundary.
 */
const ACCESS_KEY = 'medimove.console.accessToken'
const REFRESH_KEY = 'medimove.console.refreshToken'

function storage(): Storage | null {
  return import.meta.client ? window.localStorage : null
}

export function getAccessToken(): string | null {
  return storage()?.getItem(ACCESS_KEY) ?? null
}

export function getRefreshToken(): string | null {
  return storage()?.getItem(REFRESH_KEY) ?? null
}

export function hasSession(): boolean {
  return Boolean(getAccessToken() || getRefreshToken())
}

export function setTokens(tokens: { accessToken: string; refreshToken: string }): void {
  const store = storage()
  if (!store) return
  store.setItem(ACCESS_KEY, tokens.accessToken)
  store.setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearTokens(): void {
  const store = storage()
  if (!store) return
  store.removeItem(ACCESS_KEY)
  store.removeItem(REFRESH_KEY)
}
