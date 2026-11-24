import type {
  DispatchQueueResponse,
  IncomingResponse,
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

  return {
    /** GET /dispatch/bookings — dispatcher queue (reference/status only). */
    dispatchQueue: () => api.get<DispatchQueueResponse>('/dispatch/bookings'),
    /** GET /providers/me — provider admin's own provider profile. */
    myProvider: () => api.get<ProviderResponse>('/providers/me'),
    /** GET /hospitals/me/incoming — inbound patient alerts (minimum detail). */
    incomingPatients: () => api.get<IncomingResponse>('/hospitals/me/incoming'),
    /** GET /admin/reports/overview — aggregate report; missing metrics stay unavailable. */
    overview: () => api.get<OverviewResponse>('/admin/reports/overview')
  }
}
