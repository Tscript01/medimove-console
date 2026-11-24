import * as SecureStore from 'expo-secure-store'

/**
 * Central place for token persistence. Both the auth store and the API
 * interceptors read/write tokens through here so the storage keys live in one
 * spot (and the legacy `userToken` key is cleaned up).
 *
 * The backend issues a short-lived access token (~15 min) plus a rotating
 * refresh token. Both must be persisted; the refresh token is single-use, so a
 * failed write would log the user out on the next rotation.
 */

const ACCESS_TOKEN_KEY = 'medimove.accessToken'
const REFRESH_TOKEN_KEY = 'medimove.refreshToken'
const LEGACY_TOKEN_KEY = 'userToken'

export interface StoredTokens {
  accessToken: string | null
  refreshToken: string | null
}

export async function getTokens(): Promise<StoredTokens> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ])
  return { accessToken, refreshToken }
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY)
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
}

export async function setTokens(tokens: {
  accessToken: string
  refreshToken: string
}): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
    SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
  ])
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
  ])
}
