import type { PublicUser } from '~/types/auth'
import { onAuthExpired } from '~/utils/authEvents'
import { clearTokens } from '~/utils/tokenStore'

/** The HTTP layer can end the session without importing UI code. */
export default defineNuxtPlugin((nuxtApp) => {
  onAuthExpired((reason) => {
    clearTokens()
    nuxtApp.runWithContext(() => {
      useState<PublicUser | null>('medimove:user').value = null
      useState<string | null>('medimove:session-reason').value = reason
      return navigateTo(`/login?reason=${encodeURIComponent(reason)}`)
    })
  })
})
