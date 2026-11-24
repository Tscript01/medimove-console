import type { Role } from '~/types/auth'

/**
 * Single source of truth for console routing. The backend supplies `user.role`
 * from GET /auth/me; never decode a token or infer a role from stored data.
 */
export const SIGN_IN = '/login'
export const MOBILE_APP_NOTICE = '/mobile-app'
export const DISPATCH_HOME = '/dispatch'
export const PROVIDER_HOME = '/provider'
export const HOSPITAL_HOME = '/hospital'
export const ADMIN_HOME = '/admin'

/** Exactly one console route per role tree (two roles share /admin). */
export const ROLE_HOME: Record<Role, string> = {
  PATIENT: MOBILE_APP_NOTICE,
  CREW: MOBILE_APP_NOTICE,
  DISPATCHER: DISPATCH_HOME,
  PROVIDER_ADMIN: PROVIDER_HOME,
  HOSPITAL_STAFF: HOSPITAL_HOME,
  STATE_ADMIN: ADMIN_HOME,
  PLATFORM_ADMIN: ADMIN_HOME
}

export const CONSOLE_ROLES: readonly Role[] = [
  'DISPATCHER',
  'PROVIDER_ADMIN',
  'HOSPITAL_STAFF',
  'STATE_ADMIN',
  'PLATFORM_ADMIN'
]

/** The only place that decides where a role lands after sign-in. */
export function homeForRole(role: Role | null | undefined): string {
  return role ? ROLE_HOME[role] : SIGN_IN
}

export function isConsoleRole(role: Role | null | undefined): boolean {
  return Boolean(role && CONSOLE_ROLES.includes(role))
}

export function rolesForPath(path: string): readonly Role[] {
  if (path === DISPATCH_HOME || path.startsWith(`${DISPATCH_HOME}/`)) return ['DISPATCHER']
  if (path === PROVIDER_HOME || path.startsWith(`${PROVIDER_HOME}/`)) return ['PROVIDER_ADMIN']
  if (path === HOSPITAL_HOME || path.startsWith(`${HOSPITAL_HOME}/`)) return ['HOSPITAL_STAFF']
  if (path === ADMIN_HOME || path.startsWith(`${ADMIN_HOME}/`)) return ['STATE_ADMIN', 'PLATFORM_ADMIN']
  return []
}

/** Human-readable role label for UI chrome only; enum strings remain the source. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Not signed in'
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
