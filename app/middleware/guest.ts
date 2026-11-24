import { hasSession } from '~/utils/tokenStore'
import { homeForRole } from '~/utils/roleRouting'

/** Signed-in users should not sit on the sign-in form. */
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  if (!hasSession()) return

  const nuxtApp = useNuxtApp()
  const { user, ensureUser } = useAuth()
  try {
    if (!user.value) await ensureUser()
  } catch {
    // Session is no longer valid — let the login form handle it.
    return
  }

  if (user.value) {
    return nuxtApp.runWithContext(() => navigateTo(homeForRole(user.value?.role)))
  }
})
