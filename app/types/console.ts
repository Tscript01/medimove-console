import type { Pagination } from './api'

/**
 * Read models for the first slice. Every field below is taken from a real
 * backend response (openapi.yaml + src/utils/serializers.ts) — no invented
 * fields, and no client-computed metrics.
 */

export type BookingStatus =
  | 'REQUESTED'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'PATIENT_ON_BOARD'
  | 'AT_HOSPITAL'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'

/** GET /dispatch/bookings — patient identifiers are deliberately absent. */
export interface DispatchBookingSummary {
  id: string
  reference: string
  status: BookingStatus
  isDispatched: boolean
  isEscalated: boolean
  dispatchRound: number
  dispatchEscalatedAt: string | null
  emergencyCategory: string | null
  stateId: string | null
  requestedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DispatchQueueResponse {
  success: boolean
  bookings: DispatchBookingSummary[]
}

/** GET /providers/me (toProvider serializer). */
export interface ProviderProfile {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  contactName: string | null
  registrationNumber: string | null
  vehicleType: string
  baseFareKobo: number | null
  ratePerKmKobo: number | null
  latitude: number | null
  longitude: number | null
  stateId: string | null
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED'
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'
  availableStatus: boolean
  isSimulated: boolean
  verifiedAt: string | null
  suspendedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface ProviderResponse {
  success: boolean
  provider: ProviderProfile | null
}

/** GET /hospitals/me/incoming (toIncomingPatient serializer). */
export interface IncomingPatient {
  bookingId: string
  reference: string
  emergencyCategory: string | null
  status: BookingStatus
  isInbound: boolean
  requestedAt: string | null
  acceptedAt: string | null
  atHospitalAt: string | null
  distanceRemainingKm: number | null
  etaMinutes: number | null
  etaAt: string | null
}

export interface IncomingResponse {
  success: boolean
  incoming: IncomingPatient[]
}

/** GET /admin/reports/overview (getOperationalReport service). */
export interface OperationalReport {
  generatedAt: string
  scope: { role: string; stateId: string | null }
  range: { from: string | null; to: string | null }
  bookings: { total: number; byStatus: Record<string, number> }
  payments: {
    total: number
    successfulCount: number
    successfulAmountKobo: number
    byStatus: Record<string, number>
    byMethod: Record<string, number>
  }
  providers: {
    total: number
    byStatus: Record<string, number>
    byVerificationStatus: Record<string, number>
  }
  crew: { total: number; verified: number }
  hospitals: { total: number; active: number }
  users: { total: number; byRole: Record<string, number> }
  complaints: { total: number; byStatus: Record<string, number> }
  feedback: { total: number; averageRating: number | null }
  serviceAreas: { total: number }
}

export interface OverviewResponse {
  success: boolean
  report: OperationalReport
}

/** GET /admin/bookings — only used as a paged list shape for later slices. */
export interface AdminBooking {
  id: string
  reference: string
  status: BookingStatus
  [key: string]: unknown
}

export interface AdminBookingsResponse {
  success: boolean
  bookings?: AdminBooking[]
  data?: AdminBooking[]
  pagination?: Pagination
}
