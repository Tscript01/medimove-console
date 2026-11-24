/** Roles are the exact enum values from the backend (see permissions.ts). */
export type Role =
  | 'PATIENT'
  | 'CREW'
  | 'DISPATCHER'
  | 'HOSPITAL_STAFF'
  | 'PROVIDER_ADMIN'
  | 'STATE_ADMIN'
  | 'PLATFORM_ADMIN'

/** Mirrors PublicUser in openapi.yaml. Scope is authoritative on the server. */
export interface PublicUser {
  id: string
  email: string
  fullName?: string
  phone?: string | null
  role: Role
  stateId?: string | null
  hospitalId?: string | null
  providerId?: string | null
  emailVerified?: boolean
  phoneVerified?: boolean
  walletBalanceKobo?: number
  createdAt?: string
}

export interface AuthResponse {
  success: boolean
  user: PublicUser
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: string
  refreshTokenExpiresAt?: string
}

export interface RefreshResponse {
  success: boolean
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: string
  refreshTokenExpiresAt?: string
}

export interface MeResponse {
  success: boolean
  user: PublicUser
}
