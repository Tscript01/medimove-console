import { createRoleGuard } from '~/utils/roleMiddleware'

/** /admin tree — STATE_ADMIN and PLATFORM_ADMIN share this route. */
export default defineNuxtRouteMiddleware(createRoleGuard(['STATE_ADMIN', 'PLATFORM_ADMIN']))
