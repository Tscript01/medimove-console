import { hasSession } from '~/utils/tokenStore'

/** Every protected page runs this before its role-specific guard. */
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  const nuxtApp = useNuxtApp()
  const { user, ensureUser } = useAuth()

  if (!hasSession()) return navigateTo('/login')

  if (!user.value) {
    try {
      await ensureUser()
    } catch {
      return nuxtApp.runWithContext(() => navigateTo('/login'))
    }
  }

  if (!user.value) return navigateTo('/login')
})
