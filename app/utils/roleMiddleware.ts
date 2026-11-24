import type { RouteLocationNormalized } from 'vue-router'
import type { Role } from '~/types/auth'
import { hasSession } from './tokenStore'
import { homeForRole, SIGN_IN } from './roleRouting'

/**
 * Shared implementation behind the named middleware for each role tree.
 * Role comes only from GET /auth/me; a wrong role is sent to its own home page.
 */
export function createRoleGuard(allowed: readonly Role[]) {
  return async (to: RouteLocationNormalized) => {
    if (import.meta.server) return
    // `to` is intentionally unused here; guards must not call useRoute().
    void to
    const nuxtApp = useNuxtApp()
    const { user, ensureUser } = useAuth()

    if (!user.value && hasSession()) {
      try {
        await ensureUser()
      } catch {
        return nuxtApp.runWithContext(() => navigateTo(SIGN_IN))
      }
    }

    const role = user.value?.role ?? null
    if (!role) return navigateTo(SIGN_IN)
    if (!allowed.includes(role)) return navigateTo(homeForRole(role))
  }
}
