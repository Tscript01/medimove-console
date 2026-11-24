# 2. Database Relationship Overview

PostgreSQL via Prisma 7. The schema (`prisma/schema.prisma`) defines **38 models**
and **32 enums**. All primary keys are UUIDs unless noted. Foreign-key actions are
chosen deliberately: child/evidence rows cascade with their parent, while
*actor* references use `SetNull` so an audit trail survives user deletion.

## Entity groups

```
Identity & access            Patient & consent           Location & coverage
  User                         PatientProfile              State
  Session                      EmergencyContact            ServiceArea
  EmailOtp                     PatientMedicalInfo          UserLocation
  AuditLog                     ConsentRecord               ProviderOperatingLocation
                               InsuranceProfile            ProviderServiceArea
                               ReminderPreference
                               SavingsGoal / SavingsContribution

Provider / fleet / crew      Booking & dispatch          Trip & tracking
  AmbulanceProvider            Booking                     TripLocation
  Ambulance                    BookingStatusHistory
  CrewProfile                  DispatchOffer
  CrewInvitation
  CrewDocument

Payments                     Notifications               Hospital & quality
  Payment                      Notification                Hospital
  PaymentEvent                 NotificationEvent           HospitalSpecialty
  PricingConfig                                            HospitalService
                                                           HospitalCapacity
                                                           Feedback
                                                           Complaint / ComplaintEvent
```

## Core relationships

### Identity, scope and sessions

- **`User` → `State?` / `Hospital?` / `AmbulanceProvider?`** — a user carries one
  **role** (`Role` enum) and optional scope keys: `stateId` (STATE_ADMIN,
  DISPATCHER), `hospitalId` (HOSPITAL_STAFF), `providerId` (CREW,
  PROVIDER_ADMIN). Scope is re-read per request; a scope-less role matches no
  records.
- **`User.isActive` / `suspendedAt` / `suspensionReason`** — administrative
  suspension. A suspended account cannot authenticate, refresh or verify; the
  suspension also revokes every session in the same transaction.
- **`Session` (1 user → many)** — one row per device/login. Stores
  `refreshTokenHash` (SHA-256, unique), a `familyId` grouping a rotation chain,
  `expiresAt` (sliding) and `absoluteExpiresAt` (hard cap),
  `replacedBySessionId` for rotation lineage, and `revokedAt`/`revokedReason`.
  Reuse of an already-rotated token revokes the whole family.
- **`EmailOtp` (1 user → many)** — a challenge for an email or phone destination
  (`purpose` distinguishes flows). Only `codeHash` (HMAC-SHA256 keyed with
  `OTP_HASH_SECRET`) is stored; `attempts`/`maxAttempts` and `consumedAt` gate
  replay.
- **`AuditLog` → `User?`** — append-only; `metadata` is JSON. Indexed by actor,
  action, `(resourceType, resourceId)` and time. No update/delete path exists.

### Patient profile & consent (all owner-scoped, `onDelete: Cascade`)

- **`PatientProfile`** (unique `userId`) — date of birth, preferred language.
- **`EmergencyContact`** (many per user) — at most one primary, enforced by the
  service inside a transaction.
- **`PatientMedicalInfo`** (unique `userId`) — minimal health data, consent-gated
  and owner-only.
- **`ConsentRecord`** — append-only history; withdrawing stamps `withdrawnAt` on
  the active row, rows are never deleted.
- **`InsuranceProfile`** (unique `userId`), **`ReminderPreference`** (unique
  `userId`).

### Location & coverage

- **`State`** is the top-level isolation axis: it parents `User`, `Hospital`,
  `AmbulanceProvider`, `Booking`, `ServiceArea`, `UserLocation`,
  `ProviderOperatingLocation` and `PricingConfig`.
- **`ServiceArea` → `State`** — a coverage zone, either a circle
  (`centerLat`/`centerLng`/`radiusKm`) or a polygon (`polygon` JSON). Unique per
  `(stateId, name)`.
- **`UserLocation` → `User`** (cascade), optional `State` and `ServiceArea`
  (`SetNull`). `source` (`LocationSource`) records GPS / MAP_PIN / MANUAL; a
  MANUAL location may have null coordinates but always a landmark.
- **`ProviderOperatingLocation` → `AmbulanceProvider`** (cascade) — a provider
  base (distinct from a personal `UserLocation`).
- **`ProviderServiceArea`** — join table, unique `(providerId, serviceAreaId)`,
  both sides cascade.

### Provider, fleet & crew

- **`AmbulanceProvider` → `State?`** — lifecycle `status` (`ProviderStatus`) and
  `verificationStatus`; parents `Ambulance`, `CrewProfile`, `CrewInvitation`,
  `ProviderOperatingLocation`, `ProviderServiceArea`, `PricingConfig`,
  `DispatchOffer` and `Booking`. `registrationNumber` is globally unique.
- **`Ambulance` → `AmbulanceProvider`** (cascade) — unique
  `registrationNumber`; `status` (`VerificationStatus`), `availability`
  (`AvailabilityStatus`), current position columns. Only `VERIFIED` + `isActive`
  vehicles are dispatchable.
- **`CrewProfile` → `User`** (unique, cascade) + `AmbulanceProvider` (cascade) +
  optional `Ambulance` (`SetNull`). One profile per user; `crewRole` is the
  professional role (distinct from platform `Role`).
- **`CrewInvitation` → `AmbulanceProvider`** (cascade) + inviter/accepter
  (`SetNull`). The raw token is shown once; only `tokenHash` (unique) is stored.
- **`CrewDocument` → `CrewProfile`** (cascade) + reviewer (`SetNull`) — document
  review is separate from crew verification.

### Booking, dispatch & trips

- **`Booking`** is the hub. It references `User` (requester), `AmbulanceProvider`,
  optional `State`, optional destination `Hospital`, optional accepted-by `User`
  (`SetNull`), optional assigned `Ambulance` (`SetNull`) and optional
  `PricingConfig` (`SetNull`). Children: `BookingStatusHistory`, `DispatchOffer`,
  `TripLocation`, `Payment`, `Feedback`, `Complaint`.
  - `@@unique([userId, idempotencyKey])` makes a retried create idempotent
    **per requester**.
  - Money is integer kobo (`estimatedFare`), with a `fareBreakdown` JSON
    snapshot and the resolved `pricingConfigId`.
  - Milestone timestamps (`enRouteAt`, `arrivedAt`, `patientOnBoardAt`,
    `atHospitalAt`, `completedAt`, `cancelledAt`, `failedAt`, `noShowAt`) are
    denormalised for fast rendering; the history table remains the source of
    truth.
- **`BookingStatusHistory`** — append-only, `(bookingId)` + actor (`SetNull`).
  Records `fromStatus` → `toStatus`, actor, role and reason.
- **`DispatchOffer`** — one row per (booking, crew, round): unique
  `(bookingId, crewProfileId, round)`. References booking, provider, ambulance
  and crew (all cascade) plus creator (`SetNull`). `status`
  (`DispatchOfferStatus`), `expiresAt` and `capabilityMatch` drive the
  time-boxed offer. The acceptance path guards on `status = PENDING` so two crews
  cannot win the same booking.
- **`TripLocation`** — append-only GPS fixes; references booking (cascade),
  optional ambulance/crew (`SetNull`) and recorder (`SetNull`). `recordedAt` is
  **server-set** so a device clock cannot fake freshness. Indexed by
  `(bookingId, recordedAt)` and `(ambulanceId, recordedAt)`.

### Payments & pricing

- **`Payment`** — unique `transactionRef` and `receiptNumber`; references
  optional `User`, `Booking` and `SavingsGoal`. `status`, `type`, `method`,
  `refundStatus` enums; `providerReference`/`verifiedAt` capture independent
  gateway verification. No card data is stored.
- **`PaymentEvent`** — append-only timeline; unique `dedupeKey` guarantees a
  provider callback is processed once.
- **`SavingsGoal` → `User`** (cascade); **`SavingsContribution`** links a goal and
  a payment.
- **`PricingConfig`** — scoped rule with nullable `providerId` / `stateId` /
  `serviceAreaId` / `vehicleCategory` (null = wildcard). Charges are kobo;
  `extraCharges`/`discounts` are JSON; `effectiveFrom`/`effectiveTo` and
  `priority` decide resolution. Referenced by `Booking.pricingConfigId`.

### Notifications

- **`Notification`** — the outbox row: recipient, channel, event type, template
  `payload` (JSON, never secrets/PHI), `status`, `attempts`/`maxAttempts`,
  `nextAttemptAt` for backoff and a unique `dedupeKey`. Indexed by
  `(status, nextAttemptAt)` for the worker claim.
- **`NotificationEvent`** — append-only delivery log (`NotificationLogType`),
  `SetNull` on notification.

### Hospital & quality

- **`Hospital`** — `id` deliberately matches the public reference dataset
  (e.g. `hosp-1`). Belongs to a `State`; parents `User` staff, `Booking`
  (destination), `HospitalSpecialty`, `HospitalService`, `HospitalCapacity`
  (one-to-one). Self-maintained profile + administrative lifecycle
  (`isActive`/`suspendedAt`).
- **`HospitalSpecialty`** unique `(hospitalId, name)`; **`HospitalService`**
  unique `(hospitalId, service)`; both cascade.
- **`HospitalCapacity`** unique `hospitalId` — self-reported intake/beds with an
  `updatedBy` (`SetNull`).
- **`Feedback`** — unique `(bookingId, userId)` so a trip is rated at most once;
  `providerId`/`stateId` are **snapshots** for scoped reads. References booking
  and author (cascade).
- **`Complaint`** — unique `reference`; optional `Booking` (`SetNull`), raiser
  (cascade) and assignee (`SetNull`); `stateId` snapshot. **`ComplaintEvent`** is
  the append-only handling trail.

## State machines (enforced in services, not the DB)

| Machine | Values | Enforced in |
|---|---|---|
| `BookingStatus` | REQUESTED → OFFERED → ACCEPTED → EN_ROUTE → ARRIVED → PATIENT_ON_BOARD → AT_HOSPITAL → COMPLETED, with CANCELLED / FAILED branches | `bookingService.applyBookingTransition` |
| `DispatchOfferStatus` | PENDING → ACCEPTED / REJECTED / EXPIRED / CANCELLED | `dispatchService` |
| `ComplaintStatus` | OPEN → IN_REVIEW → RESOLVED / REJECTED → CLOSED (+ reopen) | `complaintService` |
| `PaymentStatus` / `RefundStatus` | PENDING → SUCCESSFUL / FAILED / CANCELLED; refund NONE → PENDING → REFUNDED / FAILED | `paymentService` |
| Provider / crew / ambulance | PENDING → VERIFIED / REJECTED, ACTIVE / SUSPENDED | provider/crew/ambulance services |

## Index & constraint strategy

- **Uniqueness** encodes business invariants: `User.email`, `Ambulance.registrationNumber`,
  `Booking.reference`, `Payment.transactionRef`, `Payment.receiptNumber`,
  `Session.refreshTokenHash`, `EmailOtp` (hashed), `Notification.dedupeKey`,
  `PaymentEvent.dedupeKey`, `Feedback (bookingId,userId)`,
  `DispatchOffer (bookingId,crewProfileId,round)`,
  `Booking (userId,idempotencyKey)`, `ServiceArea (stateId,name)`.
- **Scope indexes** — every scoping column is indexed (`stateId`, `providerId`,
  `hospitalId`, `userId`) so scoped lists stay fast.
- **Hot-path composite indexes** — `Notification (status,nextAttemptAt)` for the
  worker, `TripLocation (bookingId,recordedAt)` / `(ambulanceId,recordedAt)` for
  tracking, `UserLocation (userId,isPrimary)` and
  `EmergencyContact (userId,isPrimary)` for primary uniqueness checks.
- **Time indexes** on append-only tables (`createdAt`) for range queries and
  reports.

## Migration history

20 migrations are applied (see [MIGRATIONS.md](./MIGRATIONS.md) for the workflow):

| # | Migration | Adds |
|---|---|---|
| 1–5 | `20261029…` / `20261030…` | Legacy foundations: users, funds, payments (`add_payment_user_id`) |
| 6 | `20261118000000_auth_sessions_and_email_otp` | `Session`, `EmailOtp` |
| 7 | `20261118010000_roles_and_access_control` | Role/scope columns |
| 8 | `20261118020000_patient_profile_and_consent` | `PatientProfile`, `EmergencyContact`, `PatientMedicalInfo`, `ConsentRecord` |
| 9 | `20261118030000_location_and_service_coverage` | `ServiceArea`, `UserLocation` |
| 10 | `20261118040000_provider_ambulance_crew` | `AmbulanceProvider`, `Ambulance`, `CrewProfile`, `CrewInvitation`, `CrewDocument`, `ProviderOperatingLocation`, `ProviderServiceArea` |
| 11 | `20261118050000_emergency_booking_workflow` | `Booking`, `BookingStatusHistory` |
| 12 | `20261118050001_booking_idempotency_scope` | `(userId,idempotencyKey)` unique |
| 13 | `20261118060000_dispatch_engine` | `DispatchOffer`, dispatch fields |
| 14 | `20261118070000_crew_trip_operations_and_tracking` | `TripLocation`, trip timestamps |
| 15 | `20261118080000_configurable_pricing` | `PricingConfig` |
| 16 | `20261118090000_payment_transactions` | `Payment`, `PaymentEvent` |
| 17 | `20261118100000_notifications` | `Notification`, `NotificationEvent` |
| 18 | `20261118110000_hospital_and_dispatcher_operations` | `Hospital` + specialties/services/capacity |
| 19 | `20261118120000_trip_history_feedback_complaints` | `Feedback`, `Complaint`, `ComplaintEvent` |
| 20 | `20261118130000_platform_administration_and_audit` | `User.isActive`/suspension, `Hospital` suspension, `AuditLog` |
