/**
 * Response serializers. Keep sensitive columns (e.g. passwordHash) out of API
 * responses even if the full record is loaded from the database.
 */

import type { ConsentType, LocationSource, Role } from '../generated/prisma/enums'
import { env } from '../config/env'

type PublicUserInput = {
  id: string
  email: string
  fullName: string
  phone: string
  walletBalanceKobo: number
  role?: Role | null
  emailVerified?: boolean
  emailVerifiedAt?: Date | null
  phoneVerified?: boolean
  phoneVerifiedAt?: Date | null
  createdAt: Date
}

export function toPublicUser(user: PublicUserInput) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    phoneVerified: user.phoneVerified ?? false,
    phoneVerifiedAt: user.phoneVerifiedAt ?? null,
    walletBalanceKobo: user.walletBalanceKobo,
    role: user.role ?? 'PATIENT',
    emailVerified: user.emailVerified ?? false,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    createdAt: user.createdAt
  }
}

/**
 * Administrative view of a user. Exposes role and data scope (which the admin
 * surface manages) but still never the password hash or any token material.
 */
export function toAdminUser(user: {
  id: string
  email: string
  fullName: string
  phone: string
  role?: Role | null
  stateId?: string | null
  hospitalId?: string | null
  providerId?: string | null
  emailVerified?: boolean
  walletBalanceKobo?: number
  isActive?: boolean | null
  suspendedAt?: Date | null
  createdAt: Date
}) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role ?? 'PATIENT',
    stateId: user.stateId ?? null,
    hospitalId: user.hospitalId ?? null,
    providerId: user.providerId ?? null,
    emailVerified: user.emailVerified ?? false,
    walletBalanceKobo: user.walletBalanceKobo ?? 0,
    // Defaults to active: a record that predates the flag is never reported as
    // suspended. The suspension reason is intentionally not exposed here.
    isActive: user.isActive ?? true,
    suspendedAt: user.suspendedAt ?? null,
    createdAt: user.createdAt
  }
}

type PatientProfileInput = {
  dateOfBirth?: Date | null
  preferredLanguage?: string | null
  createdAt?: Date
  updatedAt?: Date
}

/** Patient onboarding profile. Always the caller's own record. */
export function toPatientProfile(profile: PatientProfileInput | null) {
  return {
    dateOfBirth: profile?.dateOfBirth ?? null,
    preferredLanguage: profile?.preferredLanguage ?? 'en',
    createdAt: profile?.createdAt ?? null,
    updatedAt: profile?.updatedAt ?? null
  }
}

export function toEmergencyContact(contact: {
  id: string
  fullName: string
  relationship: string
  phone: string
  email?: string | null
  isPrimary: boolean
  createdAt?: Date
  updatedAt?: Date
}) {
  return {
    id: contact.id,
    fullName: contact.fullName,
    relationship: contact.relationship,
    phone: contact.phone,
    email: contact.email ?? null,
    isPrimary: contact.isPrimary ?? false,
    createdAt: contact.createdAt ?? null,
    updatedAt: contact.updatedAt ?? null
  }
}

export function toConsentRecord(record: {
  id: string
  type: ConsentType
  version: string
  grantedAt: Date
  withdrawnAt?: Date | null
  createdAt?: Date
}) {
  return {
    id: record.id,
    type: record.type,
    version: record.version,
    grantedAt: record.grantedAt,
    withdrawnAt: record.withdrawnAt ?? null,
    isActive: record.withdrawnAt == null,
    createdAt: record.createdAt ?? record.grantedAt
  }
}

/**
 * Basic medical information. Only ever serialized for the record's owner; there
 * is deliberately no serializer for exposing another user's medical data.
 */
export function toMedicalInfo(info: {
  bloodType?: string | null
  allergies?: string | null
  chronicConditions?: string | null
  currentMedications?: string | null
  updatedAt?: Date
} | null) {
  if (!info) return null
  return {
    bloodType: info.bloodType ?? null,
    allergies: info.allergies ?? null,
    chronicConditions: info.chronicConditions ?? null,
    currentMedications: info.currentMedications ?? null,
    updatedAt: info.updatedAt ?? null
  }
}

/**
 * A user's location. `source` tells the client whether the point is a GPS fix,
 * a map pin or a described place — it is never inferred or defaulted here.
 */
export function toUserLocation(location: {
  id: string
  label?: string | null
  source: LocationSource
  latitude?: number | null
  longitude?: number | null
  accuracyMeters?: number | null
  address?: string | null
  landmark?: string | null
  stateId?: string | null
  serviceAreaId?: string | null
  isPrimary: boolean
  createdAt?: Date
  updatedAt?: Date
}) {
  return {
    id: location.id,
    label: location.label ?? null,
    source: location.source,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    accuracyMeters: location.accuracyMeters ?? null,
    address: location.address ?? null,
    landmark: location.landmark ?? null,
    stateId: location.stateId ?? null,
    serviceAreaId: location.serviceAreaId ?? null,
    isPrimary: location.isPrimary ?? false,
    createdAt: location.createdAt ?? null,
    updatedAt: location.updatedAt ?? null
  }
}

/** A configured service area, with its coverage shape normalised. */
export function toServiceArea(area: {
  id: string
  name: string
  stateId: string
  centerLat?: number | null
  centerLng?: number | null
  radiusKm?: number | null
  polygon?: unknown
  isActive: boolean
  state?: { id: string; name: string; code: string } | null
  createdAt?: Date
  updatedAt?: Date
}) {
  const polygon = Array.isArray(area.polygon) ? area.polygon : null
  return {
    id: area.id,
    name: area.name,
    stateId: area.stateId,
    state: area.state ?? null,
    isActive: area.isActive,
    coverage: polygon
      ? { type: 'polygon' as const, polygon }
      : {
          type: 'radius' as const,
          centerLat: area.centerLat ?? null,
          centerLng: area.centerLng ?? null,
          radiusKm: area.radiusKm ?? null
        },
    createdAt: area.createdAt ?? null,
    updatedAt: area.updatedAt ?? null
  }
}

export function toState(state: { id: string; name: string; code: string; createdAt?: Date }) {
  return {
    id: state.id,
    name: state.name,
    code: state.code,
    createdAt: state.createdAt ?? null
  }
}

/** A provider as seen by its own admin (no internal-only columns). */
export function toProvider(provider: Record<string, any>) {
  return {
    id: provider.id,
    name: provider.name,
    phone: provider.phone,
    email: provider.email ?? null,
    address: provider.address ?? null,
    contactName: provider.contactName ?? null,
    registrationNumber: provider.registrationNumber ?? null,
    vehicleType: provider.vehicleType,
    baseFareKobo: provider.baseFareKobo,
    ratePerKmKobo: provider.ratePerKmKobo,
    latitude: provider.latitude,
    longitude: provider.longitude,
    stateId: provider.stateId ?? null,
    status: provider.status ?? 'PENDING',
    verificationStatus: provider.verificationStatus ?? 'PENDING',
    availableStatus: provider.availableStatus ?? false,
    isSimulated: provider.isSimulated ?? false,
    verifiedAt: provider.verifiedAt ?? null,
    suspendedAt: provider.suspendedAt ?? null,
    suspensionReason: provider.suspensionReason ?? null,
    rejectionReason: provider.rejectionReason ?? null,
    createdAt: provider.createdAt ?? null,
    updatedAt: provider.updatedAt ?? null
  }
}

export function toProviderLocation(location: Record<string, any>) {
  return {
    id: location.id,
    label: location.label ?? null,
    latitude: location.latitude,
    longitude: location.longitude,
    address: location.address ?? null,
    landmark: location.landmark ?? null,
    stateId: location.stateId ?? null,
    serviceAreaId: location.serviceAreaId ?? null,
    isPrimary: location.isPrimary ?? false,
    createdAt: location.createdAt ?? null,
    updatedAt: location.updatedAt ?? null
  }
}

export function toAmbulance(ambulance: Record<string, any>) {
  return {
    id: ambulance.id,
    providerId: ambulance.providerId,
    registrationNumber: ambulance.registrationNumber,
    vehicleType: ambulance.vehicleType,
    category: ambulance.category,
    status: ambulance.status ?? 'PENDING',
    availability: ambulance.availability ?? 'OFFLINE',
    isActive: ambulance.isActive ?? true,
    currentLocation:
      ambulance.currentLatitude !== null && ambulance.currentLatitude !== undefined
        ? {
            latitude: ambulance.currentLatitude,
            longitude: ambulance.currentLongitude,
            updatedAt: ambulance.currentLocationUpdatedAt ?? null
          }
        : null,
    verifiedAt: ambulance.verifiedAt ?? null,
    rejectionReason: ambulance.rejectionReason ?? null,
    createdAt: ambulance.createdAt ?? null,
    updatedAt: ambulance.updatedAt ?? null
  }
}

export function toCrewProfile(profile: Record<string, any>) {
  return {
    id: profile.id,
    userId: profile.userId,
    providerId: profile.providerId,
    crewRole: profile.crewRole,
    status: profile.status ?? 'PENDING_VERIFICATION',
    verificationStatus: profile.verificationStatus ?? 'PENDING',
    availability: profile.availability ?? 'OFFLINE',
    licenseNumber: profile.licenseNumber ?? null,
    yearsExperience: profile.yearsExperience ?? null,
    assignedAmbulanceId: profile.assignedAmbulanceId ?? null,
    verifiedAt: profile.verifiedAt ?? null,
    deactivatedAt: profile.deactivatedAt ?? null,
    deactivationReason: profile.deactivationReason ?? null,
    createdAt: profile.createdAt ?? null,
    updatedAt: profile.updatedAt ?? null
  }
}

export function toCrewDocument(document: Record<string, any>) {
  return {
    id: document.id,
    crewProfileId: document.crewProfileId,
    type: document.type,
    fileUrl: document.fileUrl,
    status: document.status ?? 'PENDING',
    reviewedAt: document.reviewedAt ?? null,
    rejectionReason: document.rejectionReason ?? null,
    expiresAt: document.expiresAt ?? null,
    createdAt: document.createdAt ?? null,
    updatedAt: document.updatedAt ?? null
  }
}

export function toCrewInvitation(invitation: Record<string, any>, token?: string) {
  return {
    id: invitation.id,
    providerId: invitation.providerId,
    email: invitation.email,
    phone: invitation.phone ?? null,
    crewRole: invitation.crewRole,
    status: invitation.status ?? 'PENDING',
    expiresAt: invitation.expiresAt ?? null,
    acceptedAt: invitation.acceptedAt ?? null,
    revokedAt: invitation.revokedAt ?? null,
    createdAt: invitation.createdAt ?? null,
    // Only ever present in the response that creates the invitation.
    ...(token ? { token } : {})
  }
}

/** Statuses from which a booking counts as dispatched to the requester. */
const DISPATCHED_BOOKING_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PATIENT_ON_BOARD', 'AT_HOSPITAL', 'COMPLETED']

/**
 * Emergency booking. The shape stays flat for compatibility with the existing
 * client, with the new requester/patient, category and lifecycle fields added.
 * `isDispatched` is derived — it is only ever true once a crew has accepted.
 */
export function toBooking(booking: Record<string, any>) {
  const status = booking.status ?? 'REQUESTED'
  return {
    id: booking.id,
    reference: booking.reference,
    userId: booking.userId,
    providerId: booking.providerId,
    stateId: booking.stateId ?? null,
    destinationHospitalId: booking.destinationHospitalId ?? null,
    // Incident / pickup
    pickupAddress: booking.pickupAddress,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    landmark: booking.landmark ?? null,
    // Destination
    destAddress: booking.destAddress,
    destLat: booking.destLat,
    destLng: booking.destLng,
    // Requester & patient
    isForSelf: booking.isForSelf ?? true,
    patientName: booking.patientName ?? null,
    patientPhone: booking.patientPhone ?? null,
    patientAge: booking.patientAge ?? null,
    patientGender: booking.patientGender ?? null,
    callbackPhone: booking.callbackPhone ?? null,
    // Request details
    emergencyCategory: booking.emergencyCategory ?? null,
    notes: booking.notes ?? null,
    requestedAt: booking.requestedAt ?? booking.createdAt ?? null,
    // Money
    distanceKm: booking.distanceKm,
    estimatedFare: booking.estimatedFare,
    fareBreakdown: booking.fareBreakdown ?? null,
    pricingConfigId: booking.pricingConfigId ?? null,
    paidAt: booking.paidAt ?? null,
    // Lifecycle
    status,
    isDispatched: DISPATCHED_BOOKING_STATUSES.includes(status),
    acceptedAt: booking.acceptedAt ?? null,
    acceptedById: booking.acceptedById ?? null,
    assignedAmbulanceId: booking.assignedAmbulanceId ?? null,
    // Trip event timeline (denormalised; history remains the source of truth)
    enRouteAt: booking.enRouteAt ?? null,
    arrivedAt: booking.arrivedAt ?? null,
    patientOnBoardAt: booking.patientOnBoardAt ?? null,
    atHospitalAt: booking.atHospitalAt ?? null,
    completedAt: booking.completedAt ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    failedAt: booking.failedAt ?? null,
    noShowAt: booking.noShowAt ?? null,
    noShowReason: booking.noShowReason ?? null,
    isNoShow: booking.noShowAt != null,
    createdAt: booking.createdAt ?? null,
    updatedAt: booking.updatedAt ?? null
  }
}

/** One entry in a booking's append-only status history. */
export function toBookingStatusHistory(entry: Record<string, any>) {
  return {
    id: entry.id,
    bookingId: entry.bookingId,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    reason: entry.reason ?? null,
    createdAt: entry.createdAt ?? null
  }
}

/**
 * A dispatch offer. `isLive` is derived: an offer is only actionable while it is
 * still `PENDING` and has not passed its deadline, so a stale offer is never
 * shown as if it could still be accepted.
 */
export function toDispatchOffer(offer: Record<string, any>, now: Date = new Date()) {
  const status = offer.status ?? 'PENDING'
  const expiresAt = offer.expiresAt ?? null
  const isLive = status === 'PENDING' && expiresAt != null && new Date(expiresAt).getTime() > now.getTime()
  return {
    id: offer.id,
    bookingId: offer.bookingId,
    providerId: offer.providerId,
    ambulanceId: offer.ambulanceId,
    crewProfileId: offer.crewProfileId,
    round: offer.round ?? 1,
    status,
    isLive,
    distanceKm: offer.distanceKm ?? null,
    capabilityMatch: offer.capabilityMatch ?? false,
    offeredAt: offer.offeredAt ?? null,
    expiresAt,
    respondedAt: offer.respondedAt ?? null,
    rejectionReason: offer.rejectionReason ?? null,
    createdAt: offer.createdAt ?? null,
    updatedAt: offer.updatedAt ?? null
  }
}

/** A recommended dispatch candidate (dispatcher preview; no offer yet). */
export function toDispatchCandidate(candidate: Record<string, any>) {
  return {
    providerId: candidate.providerId,
    ambulanceId: candidate.ambulanceId,
    crewProfileId: candidate.crewProfileId,
    crewUserId: candidate.crewUserId ?? null,
    vehicleCategory: candidate.vehicleCategory ?? null,
    crewRole: candidate.crewRole ?? null,
    ambulanceAvailability: candidate.ambulanceAvailability ?? null,
    crewAvailability: candidate.crewAvailability ?? null,
    distanceKm: candidate.distanceKm ?? null,
    capabilityMatch: candidate.capabilityMatch ?? false
  }
}

/**
 * A trip tracking fix. `isLive` is derived from the server-recorded time and the
 * staleness threshold, so an old fix is never presented as a live position: it
 * is returned as `STALE` with the last-known point intact. `ageSeconds` is
 * computed against the supplied `now` so a caller can render a countdown.
 */
export function toTripLocation(
  location: Record<string, any>,
  options: { now?: Date; staleAfterSeconds?: number; subject?: 'CREW' | 'REQUESTER' } = {}
) {
  const now = options.now ?? new Date()
  const staleAfterSeconds = options.staleAfterSeconds ?? env.TRACKING_STALE_AFTER_SECONDS
  const recordedAt = location.recordedAt ?? location.createdAt ?? null
  const ageSeconds =
    recordedAt != null ? Math.max(0, Math.round((now.getTime() - new Date(recordedAt).getTime()) / 1000)) : null
  const isLive = ageSeconds != null && ageSeconds <= staleAfterSeconds
  return {
    id: location.id ?? null,
    bookingId: location.bookingId ?? null,
    subject: options.subject ?? 'CREW',
    ambulanceId: location.ambulanceId ?? null,
    crewProfileId: location.crewProfileId ?? null,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    accuracyMeters: location.accuracyMeters ?? null,
    speedKph: location.speedKph ?? null,
    headingDeg: location.headingDeg ?? null,
    source: location.source ?? 'GPS',
    recordedAt,
    ageSeconds,
    staleAfterSeconds,
    isLive,
    status: isLive ? ('LIVE' as const) : ('STALE' as const)
  }
}

/**
 * The minimal, non-PHI tracking view derived from the tracking service result.
 * Deliberately drops the raw booking record (which carries patient details) so
 * the view is safe for crew and state-scoped operators alike.
 */
export function toTrackingView(tracking: Record<string, any>, options: { now?: Date } = {}) {
  const now = options.now ?? tracking.now ?? new Date()
  const staleAfterSeconds = tracking.staleAfterSeconds ?? env.TRACKING_STALE_AFTER_SECONDS
  const serialize = (loc: Record<string, any>, subject: 'CREW' | 'REQUESTER' = 'CREW') =>
    toTripLocation(loc, { now, staleAfterSeconds, subject })
  const location = tracking.lastKnown ? serialize(tracking.lastKnown) : null
  const requesterLocation = tracking.requesterLocation
    ? serialize(tracking.requesterLocation, 'REQUESTER')
    : null
  return {
    bookingId: tracking.booking?.id ?? tracking.bookingId ?? null,
    status: tracking.status,
    // Derived from server-recorded time; a stale fix is never reported live.
    isLive: Boolean(location?.isLive),
    isRequesterLocationLive: Boolean(requesterLocation?.isLive),
    staleAfterSeconds,
    lastKnownSource: tracking.lastKnownSource ?? null,
    location,
    requesterLocation,
    nextWaypoint: tracking.nextWaypoint ?? null,
    distanceRemainingKm: tracking.distanceRemainingKm ?? null,
    etaMinutes: tracking.etaMinutes ?? null,
    etaAt: tracking.etaAt ?? null,
    recentLocations: (tracking.recentLocations ?? []).map(serialize)
  }
}

/**
 * A configurable pricing rule. Amounts are returned as stored (integer kobo);
 * the raw `extraCharges`/`discounts` JSON is normalised into arrays so clients
 * do not have to defend against a null/object/string shape.
 */
export function toPricingConfig(config: Record<string, any>) {
  return {
    id: config.id,
    name: config.name,
    providerId: config.providerId ?? null,
    stateId: config.stateId ?? null,
    serviceAreaId: config.serviceAreaId ?? null,
    vehicleCategory: config.vehicleCategory ?? null,
    baseFareKobo: config.baseFareKobo ?? 0,
    perKmKobo: config.perKmKobo ?? 0,
    perMinuteKobo: config.perMinuteKobo ?? 0,
    minimumFareKobo: config.minimumFareKobo ?? 0,
    extraCharges: Array.isArray(config.extraCharges) ? config.extraCharges : [],
    discounts: Array.isArray(config.discounts) ? config.discounts : [],
    currency: config.currency ?? 'NGN',
    priority: config.priority ?? 0,
    isActive: config.isActive ?? true,
    effectiveFrom: config.effectiveFrom ?? null,
    effectiveTo: config.effectiveTo ?? null,
    createdById: config.createdById ?? null,
    createdAt: config.createdAt ?? null,
    updatedAt: config.updatedAt ?? null
  }
}

/**
 * A payment record. Card data is never stored, so there is nothing sensitive to
 * strip; the shape is deliberately explicit so internal columns can never leak
 * into a response by accident.
 */
export function toPayment(payment: Record<string, any>) {
  return {
    id: payment.id,
    transactionRef: payment.transactionRef,
    providerReference: payment.providerReference ?? null,
    amountKobo: payment.amountKobo,
    amountNGN: (payment.amountKobo ?? 0) / 100,
    currency: payment.currency ?? 'NGN',
    status: payment.status ?? 'PENDING',
    type: payment.type ?? 'BOOKING',
    method: payment.method ?? 'CARD',
    bookingId: payment.bookingId ?? null,
    savingsGoalId: payment.savingsGoalId ?? null,
    userId: payment.userId ?? null,
    responseCode: payment.responseCode ?? null,
    responseDescription: payment.responseDescription ?? null,
    verifiedAt: payment.verifiedAt ?? null,
    refundStatus: payment.refundStatus ?? 'NONE',
    refundedAmountKobo: payment.refundedAmountKobo ?? 0,
    receiptNumber: payment.receiptNumber ?? null,
    receiptIssuedAt: payment.receiptIssuedAt ?? null,
    createdAt: payment.createdAt ?? null,
    updatedAt: payment.updatedAt ?? null
  }
}

/** One entry in a payment's append-only timeline / audit trail. */
export function toPaymentEvent(event: Record<string, any>) {
  return {
    id: event.id,
    paymentId: event.paymentId ?? null,
    type: event.type,
    source: event.source ?? 'SYSTEM',
    actorId: event.actorId ?? null,
    message: event.message ?? null,
    reference: event.reference ?? null,
    metadata: event.metadata ?? null,
    createdAt: event.createdAt ?? null
  }
}

/**
 * A queued notification. The persisted payload holds template variables only —
 * never an OTP code or card data — so there is nothing sensitive to strip here;
 * the shape is explicit so an internal column can never leak by accident.
 */
export function toNotification(notification: Record<string, any>) {
  return {
    id: notification.id,
    userId: notification.userId ?? null,
    channel: notification.channel,
    eventType: notification.eventType,
    status: notification.status ?? 'PENDING',
    recipient: notification.recipient,
    payload: notification.payload ?? null,
    attempts: notification.attempts ?? 0,
    maxAttempts: notification.maxAttempts ?? 0,
    lastError: notification.lastError ?? null,
    sentAt: notification.sentAt ?? null,
    createdAt: notification.createdAt ?? null,
    updatedAt: notification.updatedAt ?? null
  }
}

// --- Hospital operations (Stage 13) ----------------------------------------

/**
 * A hospital profile. Contact/location fields are self-maintained by the
 * hospital. Specialties, services and capacity are attached only when loaded,
 * and are always labelled as maintained (not real-time) by `maintainedAt`.
 */
export function toHospital(hospital: Record<string, any>) {
  return {
    id: hospital.id,
    name: hospital.name,
    city: hospital.city,
    stateId: hospital.stateId ?? null,
    state: hospital.state ?? null,
    lat: hospital.lat,
    lng: hospital.lng,
    category: hospital.category ?? null,
    phone: hospital.phone ?? null,
    email: hospital.email ?? null,
    address: hospital.address ?? null,
    landmark: hospital.landmark ?? null,
    isActive: hospital.isActive ?? true,
    acceptsEmergencies: hospital.acceptsEmergencies ?? true,
    suspendedAt: hospital.suspendedAt ?? null,
    suspensionReason: hospital.suspensionReason ?? null,
    ...(hospital.specialties ? { specialties: hospital.specialties.map(toHospitalSpecialty) } : {}),
    ...(hospital.services ? { services: hospital.services.map(toHospitalService) } : {}),
    ...(hospital.capacity !== undefined ? { capacity: toHospitalCapacity(hospital.capacity) } : {}),
    createdAt: hospital.createdAt ?? null,
    updatedAt: hospital.updatedAt ?? null
  }
}

export function toHospitalSpecialty(specialty: Record<string, any>) {
  return {
    id: specialty.id,
    hospitalId: specialty.hospitalId,
    name: specialty.name,
    notes: specialty.notes ?? null,
    isActive: specialty.isActive ?? true,
    createdAt: specialty.createdAt ?? null,
    updatedAt: specialty.updatedAt ?? null
  }
}

export function toHospitalService(service: Record<string, any>) {
  return {
    id: service.id,
    hospitalId: service.hospitalId,
    service: service.service,
    status: service.status ?? 'AVAILABLE',
    notes: service.notes ?? null,
    createdAt: service.createdAt ?? null,
    updatedAt: service.updatedAt ?? null
  }
}

/**
 * A hospital's self-reported capacity/intake. `maintainedAt` is the last time
 * the hospital updated it — consumers must present this as *maintained*, never
 * as real-time. Absent (`null`) means the hospital has not maintained it.
 */
export function toHospitalCapacity(capacity: Record<string, any> | null) {
  if (!capacity) return null
  return {
    hospitalId: capacity.hospitalId,
    intakeStatus: capacity.intakeStatus ?? 'OPEN',
    emergencyBedsAvailable: capacity.emergencyBedsAvailable ?? null,
    icuBedsAvailable: capacity.icuBedsAvailable ?? null,
    notes: capacity.notes ?? null,
    updatedById: capacity.updatedById ?? null,
    maintainedAt: capacity.updatedAt ?? null,
    updatedAt: capacity.updatedAt ?? null
  }
}

/** An authorized hospital staff account (no wallet/balance internals). */
export function toHospitalStaff(user: Record<string, any>) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role ?? 'HOSPITAL_STAFF',
    hospitalId: user.hospitalId ?? null,
    emailVerified: user.emailVerified ?? false,
    createdAt: user.createdAt ?? null
  }
}

/**
 * An inbound patient alert for a hospital. Deliberately minimal: a reference,
 * the emergency category, status and ETA — never the patient's name, phone,
 * notes or any medical detail.
 */
export function toIncomingPatient(entry: Record<string, any>) {
  return {
    bookingId: entry.bookingId,
    reference: entry.reference,
    emergencyCategory: entry.emergencyCategory ?? null,
    status: entry.status,
    isInbound: entry.isInbound ?? true,
    requestedAt: entry.requestedAt ?? null,
    acceptedAt: entry.acceptedAt ?? null,
    atHospitalAt: entry.atHospitalAt ?? null,
    distanceRemainingKm: entry.distanceRemainingKm ?? null,
    etaMinutes: entry.etaMinutes ?? null,
    etaAt: entry.etaAt ?? null
  }
}

/**
 * A dispatch-oriented booking summary. Excludes patient name/phone/notes and
 * any medical detail, because a dispatcher contacts parties through approved
 * channels rather than by reading PHI off the screen.
 */
export function toDispatchBookingSummary(booking: Record<string, any>) {
  const status = booking.status ?? 'REQUESTED'
  return {
    id: booking.id,
    reference: booking.reference,
    status,
    isDispatched: DISPATCHED_BOOKING_STATUSES.includes(status),
    emergencyCategory: booking.emergencyCategory ?? null,
    pickupAddress: booking.pickupAddress,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    destAddress: booking.destAddress,
    destLat: booking.destLat,
    destLng: booking.destLng,
    destinationHospitalId: booking.destinationHospitalId ?? null,
    stateId: booking.stateId ?? null,
    providerId: booking.providerId,
    acceptedById: booking.acceptedById ?? null,
    assignedAmbulanceId: booking.assignedAmbulanceId ?? null,
    dispatchRound: booking.dispatchRound ?? 0,
    dispatchEscalatedAt: booking.dispatchEscalatedAt ?? null,
    isEscalated: booking.dispatchEscalatedAt != null,
    requestedAt: booking.requestedAt ?? booking.createdAt ?? null,
    acceptedAt: booking.acceptedAt ?? null,
    createdAt: booking.createdAt ?? null,
    updatedAt: booking.updatedAt ?? null
  }
}

/** An available ambulance, with its provider and (optional) assigned crew. */
export function toAvailableAmbulance(ambulance: Record<string, any>, provider?: Record<string, any> | null, crew?: Record<string, any> | null) {
  return {
    ...toAmbulance(ambulance),
    provider: provider
      ? { id: provider.id, name: provider.name, phone: provider.phone ?? null, stateId: provider.stateId ?? null }
      : null,
    crew: crew
      ? {
          crewProfileId: crew.id,
          userId: crew.userId,
          crewRole: crew.crewRole,
          availability: crew.availability ?? 'OFFLINE'
        }
      : null
  }
}

/** One entry in a notification's append-only delivery log (retry/failure trail). */
export function toNotificationEvent(event: Record<string, any>) {
  return {
    id: event.id,
    notificationId: event.notificationId ?? null,
    type: event.type,
    message: event.message ?? null,
    attempt: event.attempt ?? null,
    provider: event.provider ?? null,
    createdAt: event.createdAt ?? null
  }
}

// --- Trip history, feedback & complaints (Stage 14) ------------------------

/** A trip rating/comment. The author is the caller or a scoped operator. */
export function toFeedback(feedback: Record<string, any>) {
  return {
    id: feedback.id,
    bookingId: feedback.bookingId,
    userId: feedback.userId,
    providerId: feedback.providerId ?? null,
    stateId: feedback.stateId ?? null,
    rating: feedback.rating,
    comment: feedback.comment ?? null,
    createdAt: feedback.createdAt ?? null,
    updatedAt: feedback.updatedAt ?? null
  }
}

/**
 * A complaint. `events` (the handling trail) is attached only when loaded.
 * Internal handling notes are included because only the complainant and the
 * managing operators can read a complaint at all.
 */
export function toComplaint(complaint: Record<string, any>) {
  return {
    id: complaint.id,
    reference: complaint.reference,
    userId: complaint.userId,
    bookingId: complaint.bookingId ?? null,
    stateId: complaint.stateId ?? null,
    category: complaint.category,
    subject: complaint.subject,
    description: complaint.description,
    status: complaint.status ?? 'OPEN',
    resolution: complaint.resolution ?? null,
    assignedToId: complaint.assignedToId ?? null,
    resolvedAt: complaint.resolvedAt ?? null,
    closedAt: complaint.closedAt ?? null,
    ...(complaint.events ? { events: complaint.events.map(toComplaintEvent) } : {}),
    createdAt: complaint.createdAt ?? null,
    updatedAt: complaint.updatedAt ?? null
  }
}

/** One entry in a complaint's append-only handling trail. */
export function toComplaintEvent(event: Record<string, any>) {
  return {
    id: event.id,
    complaintId: event.complaintId,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus,
    actorId: event.actorId ?? null,
    actorRole: event.actorRole ?? null,
    note: event.note ?? null,
    createdAt: event.createdAt ?? null
  }
}
