import { createRoleGuard } from '~/utils/roleMiddleware'

/** /provider tree — PROVIDER_ADMIN only. */
export default defineNuxtRouteMiddleware(createRoleGuard(['PROVIDER_ADMIN']))
