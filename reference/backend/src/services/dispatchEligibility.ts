/**
 * Dispatch eligibility rules, in one place.
 *
 * A provider, vehicle or crew member is only ever offered a real emergency job
 * when it has been *verified* by a reviewer AND is active/available. These
 * helpers are pure so they can be reused by the booking/dispatch layer (Stage 7)
 * and unit-tested without a database.
 *
 * Note the deliberate separation between *submission* and *verification*:
 * submitting an application or a document never makes a resource dispatchable.
 */

export function isProviderDispatchable(provider: {
  status?: string | null
  verificationStatus?: string | null
  availableStatus?: boolean | null
}): boolean {
  return provider.status === 'ACTIVE' && provider.verificationStatus === 'VERIFIED' && provider.availableStatus !== false
}

/** True when a vehicle may be dispatched: verified and active. */
export function isAmbulanceDispatchable(ambulance: { status?: string | null; isActive?: boolean | null }): boolean {
  return ambulance.status === 'VERIFIED' && ambulance.isActive !== false
}

/**
 * True when a crew member may be assigned to a vehicle / receive offers: active,
 * verified and currently assigned to a vehicle.
 */
export function isCrewDispatchable(crew: {
  status?: string | null
  verificationStatus?: string | null
  assignedAmbulanceId?: string | null
}): boolean {
  return crew.status === 'ACTIVE' && crew.verificationStatus === 'VERIFIED' && Boolean(crew.assignedAmbulanceId)
}
