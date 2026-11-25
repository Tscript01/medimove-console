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
  pickupAddress: string
  pickupLat: number
  pickupLng: number
  destAddress: string
  destLat: number
  destLng: number
  destinationHospitalId: string | null
  stateId: string | null
  providerId: string
  acceptedById: string | null
  assignedAmbulanceId: string | null
  requestedAt: string | null
  acceptedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DispatchBookingQuery {
  status?: BookingStatus
  escalated?: 'true' | 'false'
  active?: 'true' | 'false'
  limit?: number
}

export interface DispatchAmbulanceQuery {
  stateId?: string
  providerId?: string
  limit?: number
}

export interface DispatchQueueResponse {
  success: boolean
  bookings: DispatchBookingSummary[]
}

export interface DispatchStatusHistoryEntry {
  id: string | null
  bookingId: string
  fromStatus: BookingStatus | null
  toStatus: BookingStatus
  actorId: string | null
  actorRole: string | null
  reason: string | null
  createdAt: string | null
}

export type DispatchOfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED'

/** `isLive` is derived by the server from PENDING status + unexpired deadline. */
export interface DispatchOffer {
  id: string
  bookingId: string
  providerId: string
  ambulanceId: string
  crewProfileId: string
  round: number
  status: DispatchOfferStatus
  isLive: boolean
  distanceKm: number | null
  capabilityMatch: boolean
  offeredAt: string | null
  expiresAt: string | null
  respondedAt: string | null
  rejectionReason: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** Ranked dispatch recommendation; creating candidates sends no offers. */
export interface DispatchCandidate {
  providerId: string
  ambulanceId: string
  crewProfileId: string
  crewUserId: string | null
  vehicleCategory: string | null
  crewRole: string | null
  ambulanceAvailability: string | null
  crewAvailability: string | null
  distanceKm: number | null
  capabilityMatch: boolean
}

export interface TripLocation {
  id: string | null
  bookingId: string | null
  subject: 'CREW' | 'REQUESTER'
  ambulanceId: string | null
  crewProfileId: string | null
  latitude: number | null
  longitude: number | null
  accuracyMeters: number | null
  speedKph: number | null
  headingDeg: number | null
  source: string
  recordedAt: string | null
  ageSeconds: number | null
  staleAfterSeconds: number
  isLive: boolean
  status: 'LIVE' | 'STALE'
}

/** Non-PHI tracking view returned by the dispatch booking detail endpoint. */
export interface DispatchTrackingView {
  bookingId: string | null
  status: string
  isLive: boolean
  isRequesterLocationLive: boolean
  staleAfterSeconds: number
  lastKnownSource: string | null
  location: TripLocation | null
  requesterLocation: TripLocation | null
  nextWaypoint: unknown
  distanceRemainingKm: number | null
  etaMinutes: number | null
  etaAt: string | null
  recentLocations: TripLocation[]
}

export interface AvailableAmbulance {
  id: string
  providerId: string
  registrationNumber: string
  vehicleType: string
  category: string
  status: string
  availability: string
  isActive: boolean
  currentLocation: {
    latitude: number
    longitude: number | null
    updatedAt: string | null
  } | null
  verifiedAt: string | null
  rejectionReason: string | null
  createdAt: string | null
  updatedAt: string | null
  provider: {
    id: string
    name: string
    phone: string | null
    stateId: string | null
  } | null
  crew: {
    crewProfileId: string
    userId: string
    crewRole: string
    availability: string
  } | null
}

export interface DispatchDetailResponse {
  success: boolean
  booking: DispatchBookingSummary
  history: DispatchStatusHistoryEntry[]
  offers: DispatchOffer[]
  tripLocations: TripLocation[]
  tracking: DispatchTrackingView
}

export interface DispatchCandidatesResponse {
  success: boolean
  booking?: Record<string, unknown>
  candidates: DispatchCandidate[]
}

export interface DispatchOffersResponse {
  success: boolean
  offers: DispatchOffer[]
}

export interface DispatchAmbulancesResponse {
  success: boolean
  ambulances: AvailableAmbulance[]
}

export interface DispatchRoundResponse {
  success: boolean
  round: number
  booking?: Record<string, unknown>
  offers: DispatchOffer[]
}

export interface DispatchMutationResponse {
  success: boolean
  booking?: DispatchBookingSummary | Record<string, unknown>
}

export type DispatchContactRecipient = 'REQUESTER' | 'CREW' | 'HOSPITAL'
export type DispatchContactTemplate = 'CALLBACK_REQUESTED' | 'ETA_UPDATE' | 'STATUS_UPDATE' | 'GENERAL'

export interface DispatchContactResponse {
  success: boolean
  contact: {
    recipient: DispatchContactRecipient
    channel: 'SMS' | 'EMAIL'
    template: DispatchContactTemplate
    delivered: boolean
  }
}

/** Dispatcher inputs are limited to counts, crew choice and fixed templates. */
export interface DispatchRoundInput {
  candidateLimit?: number
  ttlSeconds?: number
}

export interface ManualAssignInput {
  crewProfileId: string
  ambulanceId?: string
  reason?: string
}

export interface EscalateBookingInput {
  reason?: string
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
