import { Redirect } from 'expo-router'
import type { ReactNode } from 'react'
import { useAuthStore } from '../store/authStore'
import type { Role } from '../types'
import { homeForRole, SIGN_IN } from '../utils/roleRouting'

export interface RoleGateProps {
  /** Roles allowed to see `children`. */
  allow: readonly Role[]
  children: ReactNode
}

/**
 * Client-side route guard. The server already enforces role scope (out-of-scope
 * reads return `404`), but this stops a patient deep-link from briefly rendering
 * a crew screen and vice versa. It never decides what data is visible — that is
 * always the backend's job.
 */
export function RoleGate({ allow, children }: RoleGateProps) {
  const status = useAuthStore((state) => state.status)
  const role = useAuthStore((state) => state.user?.role)

  // AppBootstrap holds the native splash until the session and role are known.
  if (status === 'loading') return null
  if (status === 'unauthenticated') return <Redirect href={SIGN_IN} />
  if (!role || !allow.includes(role)) return <Redirect href={homeForRole(role)} />

  return <>{children}</>
}
