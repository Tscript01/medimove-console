import type {
  DispatchAmbulanceQuery,
  DispatchAmbulancesResponse,
  DispatchBookingQuery,
  DispatchCandidatesResponse,
  DispatchContactRecipient,
  DispatchContactResponse,
  DispatchContactTemplate,
  DispatchDetailResponse,
  DispatchMutationResponse,
  DispatchOffersResponse,
  DispatchQueueResponse,
  DispatchRoundInput,
  DispatchRoundResponse,
  EscalateBookingInput,
  IncomingResponse,
  ManualAssignInput,
  OverviewResponse,
  ProviderResponse
} from '~/types/console'
import { useApi } from './useApi'

/**
 * Typed service layer. Components never contain URLs and never invent
 * endpoints — every path below exists in docs/openapi.yaml.
 */
export function useConsoleService() {
  const api = useApi()

  function queueParams(query: DispatchBookingQuery = {}): Record<string, string | number> {
    const params: Record<string, string | number> = {}
    if (query.status) params.status = query.status
    if (query.escalated) params.escalated = query.escalated
    if (query.active) params.active = query.active
    if (query.limit !== undefined) params.limit = query.limit
    return params
  }

  function ambulanceParams(query: DispatchAmbulanceQuery = {}): Record<string, string | number> {
    const params: Record<string, string | number> = {}
    if (query.stateId) params.stateId = query.stateId
    if (query.providerId) params.providerId = query.providerId
    if (query.limit !== undefined) params.limit = query.limit
    return params
  }

  const bookingPath = (id: string) => `/bookings/${encodeURIComponent(id)}`
  const dispatchBookingPath = (id: string) => `/dispatch/bookings/${encodeURIComponent(id)}`

  return {
    /** GET /dispatch/bookings — dispatcher queue with server-supported filters. */
    dispatchQueue: (query: DispatchBookingQuery = {}) =>
      api.get<DispatchQueueResponse>('/dispatch/bookings', { query: queueParams(query) }),

    /** GET /dispatch/ambulances — available vehicles and crew in the caller's scope. */
    dispatchAmbulances: (query: DispatchAmbulanceQuery = {}) =>
      api.get<DispatchAmbulancesResponse>('/dispatch/ambulances', { query: ambulanceParams(query) }),

    /** GET /dispatch/bookings/:id — status trail, offers, fixes and server ETA. */
    dispatchBookingDetail: (id: string) =>
      api.get<DispatchDetailResponse>(dispatchBookingPath(id)),

    /** GET /bookings/:id/dispatch/candidates — ranked preview; sends no offers. */
    dispatchCandidates: (id: string) =>
      api.get<DispatchCandidatesResponse>(`${bookingPath(id)}/dispatch/candidates`),

    /** GET /bookings/:id/offers — all offers made for a booking. */
    bookingOffers: (id: string) =>
      api.get<DispatchOffersResponse>(`${bookingPath(id)}/offers`),

    /** POST /bookings/:id/dispatch — create a new offer round. */
    startDispatch: (id: string, body: DispatchRoundInput) =>
      api.post<DispatchRoundResponse>(`${bookingPath(id)}/dispatch`, body),

    /** POST /bookings/:id/dispatch/retry — offer the next eligible candidates. */
    retryDispatch: (id: string, body: DispatchRoundInput) =>
      api.post<DispatchRoundResponse>(`${bookingPath(id)}/dispatch/retry`, body),

    /** POST /bookings/:id/assign — manual assign / reassign override. */
    manualAssign: (id: string, body: ManualAssignInput) =>
      api.post<DispatchMutationResponse>(`${bookingPath(id)}/assign`, body),

    /** POST /dispatch/bookings/:id/escalate — flag for manual assignment. */
    escalateBooking: (id: string, body: EscalateBookingInput = {}) =>
      api.post<DispatchMutationResponse>(`${dispatchBookingPath(id)}/escalate`, body),

    /** POST /dispatch/bookings/:id/contact — fixed recipient + template only. */
    contactParty: (id: string, body: {
      recipient: DispatchContactRecipient
      template: DispatchContactTemplate
    }) => api.post<DispatchContactResponse>(`${dispatchBookingPath(id)}/contact`, body),

    /** GET /providers/me — provider admin's own provider profile. */
    myProvider: () => api.get<ProviderResponse>('/providers/me'),

    /** GET /hospitals/me/incoming — inbound patient alerts (minimum detail). */
    incomingPatients: () => api.get<IncomingResponse>('/hospitals/me/incoming'),

    /** GET /admin/reports/overview — aggregate report; missing metrics stay unavailable. */
    overview: () => api.get<OverviewResponse>('/admin/reports/overview')
  }
}
