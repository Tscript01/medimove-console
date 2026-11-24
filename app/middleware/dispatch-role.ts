import { createRoleGuard } from '~/utils/roleMiddleware'

/** /dispatch tree — DISPATCHER only. */
export default defineNuxtRouteMiddleware(createRoleGuard(['DISPATCHER']))
