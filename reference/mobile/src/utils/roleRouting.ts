/**
 * Role-aware entry routing.
 *
 * The backend is the source of truth for identity: `user.role` comes from
 * `/auth/me` (or the login/verify response), never from a decoded token. Use
 * these helpers everywhere a successful sign-in needs to choose a destination
 * so the gate, login and verify screens cannot drift apart.
 *
 * The mobile app deliberately implements only PATIENT and CREW. The remaining
 * roles are desktop operations tools and are directed to an explanatory screen
 * rather than being dropped into the requester UI.
 */

import type { ImperativeRouter } from 'expo-router'
import type { Role } from '../types'

type Href = Parameters<ImperativeRouter['navigate']>[0]

export const PATIENT_HOME = '/(tabs)' as Href
export const CREW_HOME = '/(crew)/home' as Href
export const WEB_CONSOLE_NOTICE = '/role-unavailable' as Href
export const SIGN_IN = '/(auth)/login' as Href

/** The mobile app only ships these roles; everything else is a web console. */
export function isMobileRole(role: Role | null | undefined): boolean {
  return role === 'PATIENT' || role === 'CREW'
}

/** Where a user of this role lands after sign-in or on app start. */
export function homeForRole(role: Role | null | undefined): Href {
  switch (role) {
    case 'PATIENT':
      return PATIENT_HOME
    case 'CREW':
      return CREW_HOME
    case 'DISPATCHER':
    case 'HOSPITAL_STAFF':
    case 'PROVIDER_ADMIN':
    case 'STATE_ADMIN':
    case 'PLATFORM_ADMIN':
      return WEB_CONSOLE_NOTICE
    default:
      return SIGN_IN
  }
}
