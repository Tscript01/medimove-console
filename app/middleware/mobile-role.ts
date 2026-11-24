import { homeForRole } from '~/utils/roleRouting'

/** Only PATIENT/CREW belong on the mobile-app notice. */
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  const { user, ensureUser } = useAuth()
  try {
    if (!user.value) await ensureUser()
  } catch {
    return navigateTo('/login')
  }

  const role = user.value?.role
  if (!role) return navigateTo('/login')
  if (role !== 'PATIENT' && role !== 'CREW') return navigateTo(homeForRole(role), { replace: true })
})
