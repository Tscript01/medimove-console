import { createRoleGuard } from '~/utils/roleMiddleware'

/** /hospital tree — HOSPITAL_STAFF only. */
export default defineNuxtRouteMiddleware(createRoleGuard(['HOSPITAL_STAFF']))
