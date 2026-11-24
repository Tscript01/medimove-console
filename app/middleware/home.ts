import { hasSession } from '~/utils/tokenStore'
import { homeForRole, SIGN_IN } from '~/utils/roleRouting'

/** `/` is only a router: one helper decides every post-sign-in destination. */
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  if (!hasSession()) return navigateTo(SIGN_IN, { replace: true })

  const nuxtApp = useNuxtApp()
  const { user, ensureUser } = useAuth()
  try {
    if (!user.value) await ensureUser()
  } catch {
    return nuxtApp.runWithContext(() => navigateTo(SIGN_IN, { replace: true }))
  }

  return navigateTo(homeForRole(user.value?.role), { replace: true })
})
