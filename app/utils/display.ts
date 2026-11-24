import type { BookingStatus } from '~/types/console'

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Requested',
  OFFERED: 'Offered',
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'En route',
  ARRIVED: 'Arrived',
  PATIENT_ON_BOARD: 'Patient on board',
  AT_HOSPITAL: 'At hospital',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  AVAILABLE: 'Available',
  ON_DUTY: 'On duty',
  OFFLINE: 'Offline',
  UNAVAILABLE: 'Unavailable',
  PENDING_VERIFICATION: 'Pending verification',
  MEDICAL: 'Medical',
  TRAUMA: 'Trauma',
  CARDIAC: 'Cardiac',
  RESPIRATORY: 'Respiratory',
  OBSTETRIC: 'Obstetric',
  PEDIATRIC: 'Pediatric',
  PSYCHIATRIC: 'Psychiatric',
  ACCIDENT: 'Accident',
  OTHER: 'Other'
}

/** Humanise a backend enum without changing its meaning. */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unavailable'
  return STATUS_LABELS[status] ?? status
}

export function statusTone(status: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'VERIFIED':
    case 'ACTIVE':
    case 'AVAILABLE':
    case 'ON_DUTY':
    case 'COMPLETED':
    case 'SUCCESSFUL':
      return 'success'
    case 'PENDING':
    case 'PENDING_VERIFICATION':
    case 'OFFERED':
    case 'REQUESTED':
      return 'warning'
    case 'REJECTED':
    case 'SUSPENDED':
    case 'CANCELLED':
    case 'FAILED':
    case 'DIVERTING':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Only display an ETA the server returned. */
export function formatEta(etaMinutes: number | null | undefined, etaAt: string | null | undefined): string {
  if (etaMinutes === null || etaMinutes === undefined) {
    if (etaAt) return `ETA at ${formatTimestamp(etaAt)} (server provided)`
    return 'ETA unavailable'
  }
  return `${etaMinutes} min (server provided)`
}

/** Server timestamps are shown verbatim as UTC; no client-generated ETA. */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(date) + ' UTC'
}

export function statusIsTerminal(status: BookingStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED'
}
