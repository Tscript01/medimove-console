import type { AuthResponse, MeResponse, PublicUser } from '~/types/auth'
import { clearTokens, getRefreshToken, hasSession, setTokens } from '~/utils/tokenStore'

/** Shared across middleware and pages; never trust a stored role. */
let meInFlight: Promise<PublicUser> | null = null

export function useAuth() {
  const user = useState<PublicUser | null>('medimove:user', () => null)
  const sessionReason = useState<string | null>('medimove:session-reason', () => null)

  /**
   * Role/scope always come from GET /auth/me (database-backed), not from a
   * decoded token or the login response's cached user.
   */
  async function ensureUser(): Promise<PublicUser | null> {
    if (user.value) return user.value
    if (!hasSession()) return null

    if (!meInFlight) {
      meInFlight = useApi()
        .get<MeResponse>('/auth/me')
        .then((response) => response.user)
        .finally(() => {
          meInFlight = null
        })
    }

    user.value = await meInFlight
    return user.value
  }

  async function login(email: string, password: string): Promise<PublicUser> {
    const api = useApi()
    sessionReason.value = null

    // Public endpoint: a 401 here means bad credentials, never "refresh".
    const tokens = await api.post<AuthResponse>(
      '/auth/login',
      { email: email.trim().toLowerCase(), password },
      { auth: false }
    )
    setTokens({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })

    const me = await api.get<MeResponse>('/auth/me')
    user.value = me.user
    return me.user
  }

  async function logout(): Promise<void> {
    const refreshToken = getRefreshToken()
    try {
      // Real endpoint; local cleanup happens even if the server is unreachable.
      await useApi().post('/auth/logout', { refreshToken }, { auth: false })
    } catch {
      // A failed revocation must not leave the console "signed in" locally.
    }
    clearTokens()
    user.value = null
    sessionReason.value = null
  }

  function clearUser(reason?: string): void {
    user.value = null
    sessionReason.value = reason ?? null
  }

  return { user, sessionReason, ensureUser, login, logout, clearUser }
}
