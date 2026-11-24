import { Role } from '../generated/prisma/enums'

/**
 * Single source of truth for roles and permissions.
 *
 * A user holds exactly one primary role. Each role maps to a set of
 * permissions, and each permission implies a *data scope* (own / provider /
 * hospital / state / platform) enforced by `src/utils/access.ts`.
 *
 * Keep this file declarative: it must not import Express or the database.
 */

export { Role }
export type { Role as RoleType }

/** Every permission the platform understands. */
export const PERMISSIONS = {
  // Bookings
  BOOKING_CREATE: 'booking:create',
  BOOKING_READ_OWN: 'booking:read:own',
  BOOKING_READ_PROVIDER: 'booking:read:provider',
  BOOKING_READ_HOSPITAL: 'booking:read:hospital',
  BOOKING_READ_STATE: 'booking:read:state',
  BOOKING_READ_ALL: 'booking:read:all',
  BOOKING_UPDATE_STATUS: 'booking:update:status',
  BOOKING_CANCEL_OWN: 'booking:cancel:own',
  // Dispatch engine
  DISPATCH_MANAGE: 'dispatch:manage',
  DISPATCH_READ_OWN: 'dispatch:read:own',
  DISPATCH_RESPOND: 'dispatch:respond',
  /** Contact a relevant party through an approved notification template. */
  DISPATCH_CONTACT: 'dispatch:contact',
  // Trip operations (crew) & live tracking
  TRIP_READ_OWN: 'trip:read:own',
  TRIP_UPDATE: 'trip:update',
  TRACKING_READ_OWN: 'tracking:read:own',
  TRACKING_READ: 'tracking:read',
  TRACKING_UPDATE: 'tracking:update',
  /** Share the requester's own moving position for a rendezvous with their crew. */
  TRACKING_SHARE_OWN: 'tracking:share:own',
  // Payments / money
  PAYMENT_INITIATE: 'payment:initiate',
  PAYMENT_READ_OWN: 'payment:read:own',
  PAYMENT_READ_ALL: 'payment:read:all',
  PAYMENT_RETRY_OWN: 'payment:retry:own',
  PAYMENT_REFUND: 'payment:refund',
  PAYMENT_COLLECT_CASH: 'payment:collect:cash',
  SAVINGS_READ_OWN: 'savings:read:own',
  WALLET_READ_OWN: 'wallet:read:own',
  WALLET_FUND: 'wallet:fund',
  // Configurable pricing (fare rules)
  PRICING_ESTIMATE: 'pricing:estimate',
  PRICING_READ: 'pricing:read',
  PRICING_MANAGE: 'pricing:manage',
  // Notifications (in-app feed for the caller; queue management for admins)
  NOTIFICATION_READ_OWN: 'notification:read:own',
  NOTIFICATION_READ_ALL: 'notification:read:all',
  NOTIFICATION_MANAGE: 'notification:manage',
  // Profile & onboarding (always scoped to the caller's own record)
  PROFILE_READ_OWN: 'profile:read:own',
  PROFILE_UPDATE_OWN: 'profile:update:own',
  PHONE_VERIFY: 'phone:verify',
  EMERGENCY_CONTACT_MANAGE: 'emergency-contact:manage',
  CONSENT_MANAGE: 'consent:manage',
  MEDICAL_READ_OWN: 'medical:read:own',
  MEDICAL_WRITE_OWN: 'medical:write:own',
  // Location & coverage (own records; coverage is readable by any signed-in user)
  LOCATION_READ_OWN: 'location:read:own',
  LOCATION_MANAGE_OWN: 'location:manage:own',
  SERVICE_AREA_READ: 'service-area:read',
  SERVICE_AREA_MANAGE: 'service-area:manage',
  // Providers, vehicles & crew
  PROVIDER_APPLY: 'provider:apply',
  PROVIDER_READ_OWN: 'provider:read:own',
  PROVIDER_UPDATE_OWN: 'provider:update:own',
  PROVIDER_READ_STATE: 'provider:read:state',
  PROVIDER_LOCATION_MANAGE: 'provider-location:manage',
  PROVIDER_SERVICE_AREA_MANAGE: 'provider-service-area:manage',
  PROVIDER_VERIFY: 'provider:verify',
  AMBULANCE_READ_OWN: 'ambulance:read:own',
  AMBULANCE_MANAGE: 'ambulance:manage',
  AMBULANCE_VERIFY: 'ambulance:verify',
  CREW_READ_OWN: 'crew:read:own',
  CREW_SELF_MANAGE: 'crew:self:manage',
  CREW_READ_PROVIDER: 'crew:read:provider',
  CREW_MANAGE: 'crew:manage',
  CREW_VERIFY: 'crew:verify',
  DOCUMENT_REVIEW: 'document:review',
  // Hospital operations (scoped to the caller's own hospital)
  HOSPITAL_PROFILE_READ: 'hospital:profile:read',
  HOSPITAL_PROFILE_MANAGE: 'hospital:profile:manage',
  HOSPITAL_STAFF_MANAGE: 'hospital:staff:manage',
  // Trip history, feedback & complaints
  FEEDBACK_CREATE_OWN: 'feedback:create:own',
  FEEDBACK_READ_OWN: 'feedback:read:own',
  FEEDBACK_READ_PROVIDER: 'feedback:read:provider',
  FEEDBACK_READ_STATE: 'feedback:read:state',
  COMPLAINT_CREATE_OWN: 'complaint:create:own',
  COMPLAINT_READ_OWN: 'complaint:read:own',
  COMPLAINT_READ_ALL: 'complaint:read:all',
  COMPLAINT_MANAGE: 'complaint:manage',
  // Administration
  ADMIN_USERS_READ: 'admin:users:read',
  ADMIN_USERS_MANAGE: 'admin:users:manage',
  ADMIN_ROLES_ASSIGN: 'admin:roles:assign',
  ADMIN_AUDIT_READ: 'admin:audit:read',
  ADMIN_REPORTS_READ: 'admin:reports:read',
  PROVIDER_MANAGE: 'provider:manage',
  STATE_MANAGE: 'state:manage',
  // Platform-level hospital administration (distinct from a hospital managing
  // its own profile via `hospital:profile:manage`).
  HOSPITAL_MANAGE: 'hospital:manage'
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/**
 * Every permission that grants *some* read access to a booking. Used as a
 * route-level guard; the actual row scope is always applied from the session.
 */
export const BOOKING_READ_PERMISSIONS = [
  PERMISSIONS.BOOKING_READ_OWN,
  PERMISSIONS.BOOKING_READ_PROVIDER,
  PERMISSIONS.BOOKING_READ_HOSPITAL,
  PERMISSIONS.BOOKING_READ_STATE,
  PERMISSIONS.BOOKING_READ_ALL
] as const

const P = PERMISSIONS

/**
 * Permissions that act only on the caller's *own* record. Every authenticated
 * user — regardless of role — may maintain their own profile, so these are
 * granted to all roles rather than to patients alone.
 */
const SELF_SERVICE: readonly Permission[] = [
  P.PROFILE_READ_OWN,
  P.PROFILE_UPDATE_OWN,
  P.PHONE_VERIFY,
  P.EMERGENCY_CONTACT_MANAGE,
  P.CONSENT_MANAGE,
  P.MEDICAL_READ_OWN,
  P.MEDICAL_WRITE_OWN,
  P.LOCATION_READ_OWN,
  P.LOCATION_MANAGE_OWN,
  P.SERVICE_AREA_READ,
  P.PROVIDER_APPLY,
  P.CREW_READ_OWN,
  P.CREW_SELF_MANAGE,
  P.NOTIFICATION_READ_OWN,
  P.FEEDBACK_CREATE_OWN,
  P.FEEDBACK_READ_OWN,
  P.COMPLAINT_CREATE_OWN,
  P.COMPLAINT_READ_OWN
]

/**
 * Role -> permissions.
 *
 * Scope is implicit in the read permission: e.g. `BOOKING_READ_PROVIDER` means
 * "read bookings belonging to my provider", never all bookings.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.PATIENT]: [
    ...SELF_SERVICE,
    P.BOOKING_CREATE,
    P.BOOKING_READ_OWN,
    P.BOOKING_CANCEL_OWN,
    P.PAYMENT_INITIATE,
    P.PAYMENT_READ_OWN,
    P.PAYMENT_RETRY_OWN,
    P.SAVINGS_READ_OWN,
    P.WALLET_READ_OWN,
    P.WALLET_FUND,
    P.TRACKING_READ_OWN,
    P.TRACKING_SHARE_OWN,
    P.PRICING_ESTIMATE
  ],
  [Role.CREW]: [
    ...SELF_SERVICE,
    P.BOOKING_READ_PROVIDER,
    P.BOOKING_UPDATE_STATUS,
    P.DISPATCH_READ_OWN,
    P.DISPATCH_RESPOND,
    P.TRIP_READ_OWN,
    P.TRIP_UPDATE,
    P.TRACKING_READ_OWN,
    P.TRACKING_UPDATE,
    P.PAYMENT_COLLECT_CASH
  ],
  [Role.DISPATCHER]: [
    ...SELF_SERVICE,
    P.BOOKING_READ_STATE,
    P.BOOKING_UPDATE_STATUS,
    P.DISPATCH_MANAGE,
    P.DISPATCH_CONTACT,
    P.TRACKING_READ,
    P.COMPLAINT_READ_ALL,
    P.COMPLAINT_MANAGE
  ],
  [Role.HOSPITAL_STAFF]: [
    ...SELF_SERVICE,
    P.BOOKING_READ_HOSPITAL,
    P.TRACKING_READ,
    P.HOSPITAL_PROFILE_READ,
    P.HOSPITAL_PROFILE_MANAGE,
    P.HOSPITAL_STAFF_MANAGE
  ],
  [Role.PROVIDER_ADMIN]: [
    ...SELF_SERVICE,
    P.BOOKING_READ_PROVIDER,
    P.BOOKING_UPDATE_STATUS,
    P.DISPATCH_MANAGE,
    P.DISPATCH_CONTACT,
    P.TRACKING_READ,
    P.PROVIDER_MANAGE,
    P.PROVIDER_READ_OWN,
    P.PROVIDER_UPDATE_OWN,
    P.PROVIDER_LOCATION_MANAGE,
    P.PROVIDER_SERVICE_AREA_MANAGE,
    P.AMBULANCE_READ_OWN,
    P.AMBULANCE_MANAGE,
    P.CREW_READ_PROVIDER,
    P.CREW_MANAGE,
    P.PAYMENT_COLLECT_CASH,
    P.FEEDBACK_READ_PROVIDER
  ],
  [Role.STATE_ADMIN]: [
    ...SELF_SERVICE,
    P.BOOKING_READ_STATE,
    P.BOOKING_UPDATE_STATUS,
    P.DISPATCH_MANAGE,
    P.DISPATCH_CONTACT,
    P.TRACKING_READ,
    P.HOSPITAL_PROFILE_READ,
    P.HOSPITAL_PROFILE_MANAGE,
    P.HOSPITAL_STAFF_MANAGE,
    P.PROVIDER_MANAGE,
    P.PROVIDER_READ_STATE,
    P.PROVIDER_VERIFY,
    P.AMBULANCE_VERIFY,
    P.CREW_VERIFY,
    P.DOCUMENT_REVIEW,
    P.SERVICE_AREA_MANAGE,
    P.PRICING_READ,
    P.PRICING_MANAGE,
    P.PAYMENT_READ_ALL,
    P.PAYMENT_REFUND,
    P.NOTIFICATION_READ_ALL,
    P.NOTIFICATION_MANAGE,
    P.FEEDBACK_READ_STATE,
    P.COMPLAINT_READ_ALL,
    P.COMPLAINT_MANAGE,
    P.ADMIN_USERS_READ,
    P.ADMIN_USERS_MANAGE,
    P.ADMIN_AUDIT_READ,
    P.ADMIN_REPORTS_READ,
    P.HOSPITAL_MANAGE
  ],
  // The platform administrator can do everything.
  [Role.PLATFORM_ADMIN]: Object.values(P)
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission)
}

/** The authenticated identity attached to `req.user` by the auth middleware. */
export interface AuthUser {
  userId: string
  /** Alias of `userId`, kept for backwards compatibility with older handlers. */
  id: string
  email: string
  role: Role
  sessionId: string
  /** State scope (DISPATCHER / STATE_ADMIN). */
  stateId: string | null
  /** Hospital scope (HOSPITAL_STAFF). */
  hospitalId: string | null
  /** Provider scope (CREW / PROVIDER_ADMIN). */
  providerId: string | null
}

export const ALL_ROLES: readonly Role[] = Object.values(Role)
