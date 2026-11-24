# MediMove — AI-Ready Frontend Handoff & Prompt Pack

This is a **copy/paste brief** for a frontend developer or an AI code generator. It explains the product, roles, API rules, and exact prompts for generating:

1. an **Admin Panel**,
2. a **Dispatcher Console**,
3. a **Crew App**,
4. a **Provider Admin Portal**,
5. a **Hospital Staff Portal**, and
6. the **Patient/Requester Mobile App**.

It is intentionally strict about fake data, fake live tracking, and invented endpoints. MediMove is an emergency medical transport product; a polished UI that lies about dispatch state is worse than an empty state.

---

## 0. How to use this guide

Give the AI these files along with the prompt you choose below:

| File | Why |
|---|---|
| `docs/API.md` | Full endpoint table, auth/error/pagination conventions |
| `docs/openapi.yaml` | Machine-readable API contract; generate types if possible |
| `prisma/schema.prisma` | Exact enum values and field names |
| `docs/DATABASE.md` | Relationships, state machines, scope rules |
| `docs/ARCHITECTURE.md` | Request lifecycle and layering |
| `README.md` | Product narrative, roles, dispatch/payment/tracking semantics |
| Mobile: `medimove/src/theme/tokens.ts` | Approved light palette, spacing, type scale |
| Mobile: `medimove/src/components/ui/*` | Existing component conventions |
| Mobile: `medimove/src/app/location-picker.tsx` | Correct pickup-search UX reference |

Recommended order:

1. Paste **Prompt 0 — Universal brief** once.
2. Paste **one** role-specific prompt.
3. Ask the AI to output a file tree first, then implement screen by screen.
4. Ask it to list any required-but-missing backend endpoints instead of inventing them.

### Prompt index

| Prompt | Generates |
|---|---|
| 0 | Universal brief — paste once before all others |
| 1 | Admin panel |
| 2 | Dispatcher console |
| 3 | Crew app |
| 4 | Provider admin portal |
| 5 | Hospital staff portal |
| 6 | Patient/requester mobile app |
| 7 | Shared design system for any generated UI |

---

# Prompt 0 — Universal brief (paste first)

```text
You are building a production UI for MediMove, a Nigerian emergency medical
transport and ambulance coordination platform. The backend is an Express 5 API
under the base path /api. Treat docs/openapi.yaml and docs/API.md as the source
of truth for every endpoint, request body, response shape, enum, permission, and
status code.

PRODUCT
- MediMove coordinates emergency ambulance requests, dispatch offers, crew trips,
  hospital intake, payments, and operational oversight.
- Emergency action must be immediately reachable. The requester flow is
  map-first and emergency-first.
- The platform is used in Nigeria. NGN is the currency. All API money values are
  integer kobo. Format to naira only at the display layer (amountKobo / 100).
- The server computes distance and fare. The client must never send or calculate
  a price. Client-supplied amounts are stripped by validation.

NON-NEGOTIABLE RULES
1. No mock APIs in production code. No fake journeys, fake ETAs, fake ambulance
   availability, fake provider verification, or "request submitted" messages
   before the backend confirms it.
2. Skeleton/loading states are allowed. Fake "live" data is not.
3. Never invent an endpoint. If a screen needs data that is not in the API,
   create a clearly marked `BACKEND GAP` TODO and use an honest empty state.
4. Auth: send `Authorization: Bearer <accessToken>`. Access tokens expire in
   ~15 minutes. Refresh tokens rotate on every use; store the NEW refresh token
   from every refresh response. On 401, refresh once and retry once. On 403 with
   `ACCOUNT_SUSPENDED`, stop and show a session-ended screen; do not retry.
5. Role and scope are read from the database on every request. A 404 on a
   single record may mean "out of scope". Never expose that a record exists.
6. Live tracking is only live when the backend says it is live. If a fix is
   stale, show "LAST KNOWN" plus the server timestamp. Never present stale
   coordinates as live. Never calculate or invent an ETA; only display one if
   the tracking response contains it.
7. Requester pickup must be explicitly confirmed. Never silently use a
   hardcoded, previous, failed, or stale location. Manual map pins must include
   a landmark/building description.
8. Foreground location only, with explicit user action and clear consent.
   Stop watching when the screen/flow ends.
9. Use the approved light palette and Manrope (or the closest available font in
   the target stack). Minimum touch target 44px. Every interactive element needs
   an accessible label and visible focus state.
10. Out-of-scope data must never be rendered, even if an API response accidentally
    contains it. Filter by the authenticated user's role/scope on the client too.

ERROR/EMPTY STATES
- Always implement loading, empty, error, and offline states.
- Use the backend error envelope: `{ success: false, message, code }`.
- Validation errors may include `field`/`details`. Show field-level errors.
- Do not turn an API error into a success state.

OUTPUT EXPECTATIONS
- Generate TypeScript types from `docs/openapi.yaml` where possible.
- Keep API calls in a service layer; components must not hard-code URLs.
- Use a single HTTP client with auth refresh, retry-once, and typed errors.
- Prefer tables/drawers for admin data and large tap targets for field users.
- Include a short README explaining how to run the generated app and which env
  variable holds the API base URL.
```

---

## Files and facts to attach

If the AI can read files, attach these. If not, paste the relevant sections.

```text
interbackend/docs/API.md
interbackend/docs/openapi.yaml
interbackend/docs/DATABASE.md
interbackend/docs/ARCHITECTURE.md
interbackend/README.md
interbackend/prisma/schema.prisma
medimove/src/theme/tokens.ts
medimove/AGENTS.md
medimove/src/app/location-picker.tsx
```

API base URL examples:

```text
Local:      http://localhost:5000/api
Production: https://<your-render-service>.onrender.com/api
```

There is **no `/health` endpoint**. Swagger UI is at `GET /api/docs` when enabled; raw spec at `GET /api/docs/openapi.json`.

---

## Role matrix

A user has exactly one role. Scope is re-read from the database on every request.

| Role | Scope | What the UI should allow |
|---|---|---|
| `PATIENT` | own records | Create/cancel own emergency request, estimate fare, pay, wallet/savings, track own booking, trip history, feedback, complaints |
| `CREW` | their provider / own accepted trips | See offers, accept/reject, drive assigned trips, post GPS fixes, milestone status, no-show, cash collection, own profile/documents/availability |
| `DISPATCHER` | their state | Operational queue, candidates, dispatch/retry, manual assign/reassign, escalate, contact templates, tracking, complaints |
| `HOSPITAL_STAFF` | their hospital | Maintain hospital profile/specialties/services/capacity/staff; view inbound patient alerts and backend-provided ETA |
| `PROVIDER_ADMIN` | their provider | Provider profile, locations, service areas, ambulances, availability, crew invitations/assignment, provider bookings, feedback |
| `STATE_ADMIN` | their state | State-scoped admin: users, hospitals, providers, vehicles, crew, documents, pricing, payments, notifications, reports, audit, complaints |
| `PLATFORM_ADMIN` | whole platform | Everything above, platform-wide pricing, role assignment, all users/hospitals, whole-platform reports and audit |

Role routing after login:

```ts
const me = await api.get('/auth/me')
// route by me.user.role
// PATIENT         -> /app
// CREW            -> /crew
// DISPATCHER      -> /dispatch
// HOSPITAL_STAFF  -> /hospital
// PROVIDER_ADMIN  -> /provider
// STATE_ADMIN     -> /admin
// PLATFORM_ADMIN  -> /admin
```

---

## API contract cheat sheet

### Auth

```text
POST /auth/register              create account + OTP email
POST /auth/verify-email          OTP -> token pair
POST /auth/resend-verification
POST /auth/login                 email + password -> token pair
POST /auth/refresh               rotate refresh token -> new token pair
POST /auth/logout
POST /auth/logout-all
GET  /auth/me
GET  /auth/sessions
DELETE /auth/sessions/:id
POST /auth/password/change
POST /auth/password/forgot
POST /auth/password/reset
```

Refresh response shape includes at least:

```json
{
  "success": true,
  "user": { "id": "...", "role": "PATIENT" },
  "accessToken": "...",
  "refreshToken": "...",
  "tokenType": "Bearer",
  "expiresIn": "15m"
}
```

### Error envelope

```json
{ "success": false, "message": "Human-readable message", "code": "MACHINE_CODE" }
```

Common codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `CONCURRENT_MODIFICATION`, `INVALID_STATUS_TRANSITION`, `ACCOUNT_SUSPENDED`, `OTP_MAX_ATTEMPTS`, `CREW_OFFLINE`, `INVALID_SIGNATURE`.

### Pagination

List endpoints use `page` (1-based) and `limit`, returning either a `pagination` block or `page`/`limit`/`total` fields depending on endpoint. Always read the shape from the API docs instead of assuming.

### Money

```text
amountKobo: 150000  ->  ₦1,500.00
```

Never display raw kobo as naira without dividing by 100. Never send a client-computed fare to the backend.

### Geocoding

```text
GET /locations/search?q=<min 3 chars>&limit=1..10&latitude=<optional>&longitude=<optional>
GET /locations/reverse-geocode?...
```

`latitude` and `longitude` must be sent together when used. They only bias ranking; they are not a confirmed pickup. Response includes `provider` and `results[].detail` (area/state context). Rate-limited. The backend uses Google Places API (New) Text Search for pickup search and Google Geocoding API for reverse lookup; `provider` is `google`. Google auth/billing failures return an empty result and never fall back to another provider or invent coordinates. Display Google Maps attribution wherever these results are shown.

---

## Exact enum values

Use these strings exactly. Do not create your own status labels.

```text
Role:
PATIENT, CREW, DISPATCHER, HOSPITAL_STAFF, PROVIDER_ADMIN, PLATFORM_ADMIN, STATE_ADMIN

BookingStatus:
REQUESTED, OFFERED, ACCEPTED, EN_ROUTE, ARRIVED, PATIENT_ON_BOARD,
AT_HOSPITAL, COMPLETED, CANCELLED, FAILED

EmergencyCategory:
MEDICAL, TRAUMA, CARDIAC, RESPIRATORY, OBSTETRIC, PEDIATRIC,
PSYCHIATRIC, ACCIDENT, OTHER

DispatchOfferStatus:
PENDING, ACCEPTED, REJECTED, EXPIRED, CANCELLED

PaymentStatus:
PENDING, SUCCESSFUL, FAILED

PaymentType:
BOOKING, SAVINGS, WALLET_FUNDING, WALLET_PAYMENT

PaymentMethod:
CARD, BANK_TRANSFER, WALLET, CASH, OTHER

RefundStatus:
NONE, PENDING, SUCCESSFUL, FAILED

ProviderStatus:
PENDING, ACTIVE, SUSPENDED, REJECTED

VerificationStatus:
PENDING, VERIFIED, REJECTED

VehicleCategory:
BASIC_LIFE_SUPPORT, ADVANCED_LIFE_SUPPORT, NEONATAL,
PATIENT_TRANSPORT, MORTUARY

AvailabilityStatus:
AVAILABLE, ON_DUTY, OFFLINE, UNAVAILABLE

CrewStatus:
INVITED, PENDING_VERIFICATION, ACTIVE, SUSPENDED, DEACTIVATED

CrewRole:
DRIVER, EMT, PARAMEDIC, NURSE, DOCTOR, ATTENDANT

DocumentStatus:
PENDING, APPROVED, REJECTED

LocationSource:
GPS, MAP_PIN, MANUAL

HospitalServiceStatus:
AVAILABLE, LIMITED, UNAVAILABLE

HospitalIntakeStatus:
OPEN, LIMITED, DIVERTING, CLOSED

ComplaintStatus:
OPEN, IN_REVIEW, RESOLVED, REJECTED, CLOSED

NotificationStatus:
PENDING, SENT, FAILED, CANCELLED
```

Important status semantics:

- A provider is dispatchable only when `status = ACTIVE` **and** `verificationStatus = VERIFIED`. Do not show `PENDING`/`REJECTED` providers as available, and do not relax filters to fill a UI.
- A vehicle is dispatchable only when verified, active, and `availability` is `AVAILABLE` or `ON_DUTY`.
- A dispatch offer is actionable only while `PENDING`.
- An offer is **not** a dispatch. A booking is dispatched only after a crew accepts its own still-live offer or a dispatcher manually assigns one.
- `escalate` flags a booking for manual assignment; it does **not** change booking status.
- `LocationSource` has no "unknown" default. If GPS fails, the user must choose `MAP_PIN` or `MANUAL` with a landmark.

---

# Prompt 1 — Admin Panel

```text
Generate a production-quality ADMIN PANEL for MediMove using React + TypeScript
(adapt to my stack if I specify one). Use the universal brief I already gave you
and docs/openapi.yaml as the source of truth.

GOAL
A fast, calm operations back office for STATE_ADMIN and PLATFORM_ADMIN. Dense
tables are acceptable, but emergency status must never be visually buried.
The panel must be light-mode, Manrope (or nearest), and use the approved palette
from medimove/src/theme/tokens.ts.

INFORMATION ARCHITECTURE
Create these routes/sections:

1. /login
   - Email + password via POST /auth/login.
   - Handle OTP/suspended/session-ended states honestly.
   - Route by role from /auth/me.

2. /overview
   - Use GET /admin/reports/overview.
   - Show aggregate cards: bookings by status, payment totals/counts, providers
     by status, crew/hospital/user/complaint counts, average rating, service-area
     count.
   - If a metric is absent from the response, render "Unavailable" — do not
     calculate or invent it.
   - Use GET /admin/notifications/stats for queue health.
   - Recent activity may use GET /admin/audit-logs and GET /admin/bookings.

3. /operations/live
   - Map-first view of active bookings, dispatch state, and available ambulances.
   - Data: GET /dispatch/bookings, GET /dispatch/ambulances,
     GET /bookings/:id/tracking, GET /dispatch/bookings/:id.
   - There is no global live-fleet endpoint. Assemble the view only from those
     scoped endpoints and describe markers as snapshots. If a true all-vehicles
     live map is required, return `BACKEND GAP: add a scoped live-fleet endpoint`.
   - Show a marker as LIVE only when backend tracking says isLive = true.
     Otherwise label LAST KNOWN with the server timestamp.
   - Never invent routes, markers, ETAs, or ambulance positions.

4. /dispatch
   - Queue: GET /dispatch/bookings with status/escalated/active filters.
   - Detail drawer: GET /dispatch/bookings/:id (status trail, offers, trip fixes,
     tracking).
   - Actions: GET /bookings/:id/dispatch/candidates,
     POST /bookings/:id/dispatch, POST /bookings/:id/dispatch/retry,
     POST /bookings/:id/assign, POST /dispatch/bookings/:id/escalate,
     POST /dispatch/bookings/:id/contact.
   - Contact must use the fixed recipient + template contract. No free-text PHI.
   - Show offer status with exact enum values and expiry time from the response.

5. /bookings
   - Paginated/filterable table via GET /admin/bookings.
   - Filters: status, state, provider, user, date range where supported.
   - Detail: GET /bookings/:id, GET /bookings/:id/history, GET /trips/:id.
   - Actions: cancel, status update only where the role allows it.

6. /providers
   - List/read via GET /admin/providers and GET /admin/providers/:id.
   - Verification queue first: PENDING items at the top.
   - Actions: POST /admin/providers/:id/verify (verify/reject),
     activate/suspend.
   - Never show PENDING/REJECTED providers as dispatchable.

7. /fleet
   - Vehicle verification via POST /admin/ambulances/:id/verify.
   - If no admin ambulance LIST endpoint exists in the API, render a BACKEND GAP
     note and link to the parent provider detail. Do not invent a list endpoint.

8. /crew
   - Crew verification via POST /admin/crew/:id/verify.
   - Document review via POST /admin/crew-documents/:id/review.
   - If no admin crew list exists, flag BACKEND GAP instead of inventing one.
   - There is no pending-document queue/list endpoint; build from parent records
     where possible or return `BACKEND GAP: add GET /admin/crew-documents`.

9. /hospitals
   - GET/POST /admin/hospitals, GET/PATCH /admin/hospitals/:id,
     suspend/activate.

10. /users
    - GET /admin/users, GET /admin/users/:id.
    - PATCH /admin/users/:id/role with correct scope fields:
      STATE_ADMIN/DISPATCHER require stateId;
      HOSPITAL_STAFF requires hospitalId;
      CREW/PROVIDER_ADMIN require providerId.
    - POST suspend/activate. Prevent self-suspension and self-role-change in UI.

11. /service-areas
    - GET/POST /admin/states; PATCH /admin/states/:id.
    - GET/POST /admin/service-areas; PATCH/DELETE /admin/service-areas/:id.

12. /pricing
    - GET/POST/PATCH /admin/pricing and status toggle.
    - Show kobo amounts and the resolved rule fields. Never edit fares on a booking.

13. /payments
    - GET /admin/payments and GET /payments/:id.
    - Refund only via the documented refund flow. Show refundStatus separately
      from paymentStatus.

14. /notifications
    - GET /admin/notifications, /stats, /:id.
    - Retry/cancel/process via documented endpoints.

15. /feedback-and-complaints
    - GET /feedback, GET /feedback/:id — read-only; there is no moderation write.
    - GET /complaints, GET /complaints/:id, PATCH /complaints/:id/status.
    - Complaint status changes may include `note`, `resolution`, `assignedToId`.

16. /audit
    - GET /admin/audit-logs. Read-only. Never offer edit/delete.

SHARED BEHAVIOUR
- Global search for booking reference, user email, provider name where the API
  supports filtering. Do not client-side-search unloaded pages and call it global.
- Every destructive/verification action needs a confirmation dialog stating the
  exact record and resulting state.
- Every mutation shows success only after the backend response.
- Every table supports sort/filter/pagination using server params where available.
- Show scope badge: PLATFORM or STATE <name>. State admins never see controls
  that would widen their scope.
- Include an empty state for "No records in your scope".

DELIVERABLES
- Route/file tree first, then components.
- Typed API client + generated types from openapi.yaml.
- Reusable DataTable, DetailDrawer, StatusBadge, ConfirmDialog, ScopeGuard.
- README with env var for API base URL and demo role notes.
- A BACKEND GAP section listing any screen above that lacks a list/detail endpoint.
```

---

# Prompt 2 — Dispatcher Console

```text
Generate a DISPATCHER CONSOLE for MediMove using the universal brief and the API
spec. This is for role DISPATCHER, scoped to their state. Dispatch permissions are
also granted to PROVIDER_ADMIN, STATE_ADMIN and PLATFORM_ADMIN, but each role's
row scope differs; always apply ScopeGuard.

DESIGN
- Operations-first single page with three panes:
  left: incoming/escalated queue;
  centre: map + tracking;
  right: booking detail and actions.
- Fast keyboard flow, compact rows, visible countdown for live offers.
- Light mode, approved palette, 44px minimum actions.

DATA
- GET /dispatch/bookings (filters: status, escalated, active)
- GET /dispatch/ambulances
- GET /dispatch/bookings/:id
- GET /bookings/:id/dispatch/candidates
- GET /bookings/:id/offers
- GET /bookings/:id/tracking
- GET /trips/history where needed

ACTIONS
- POST /bookings/:id/dispatch
- POST /bookings/:id/dispatch/retry
- POST /bookings/:id/assign
- POST /dispatch/bookings/:id/escalate
- POST /dispatch/bookings/:id/contact
- PATCH /bookings/:id/status only if permitted by role/state machine

RULES
- The dispatcher booking summary deliberately omits patient name, phone, notes
  and medical detail. Show reference/status only and use the contact action.
- `GET /dispatch/bookings/:id` already includes status trail, offers, trip fixes
  and ETA. Do not invent an additional "rich booking" endpoint.
- There is no global live-fleet endpoint. Build the centre map from the scoped
  queue, available ambulances and per-booking tracking only; label snapshots.
- An offer is actionable only while PENDING. Show exact expiry from backend.
- Do not auto-refresh into a "live" claim. Poll tracking; use isLive/isStale from
  the response.
- Retry must not re-offer crews who rejected/timed out; the backend handles that.
- Escalate does not change booking status. Label it "Flagged for manual assignment".
- Contact uses fixed recipient + template. No free text or PHI.
- If no candidates remain, show "Escalated — manual assignment required", not
  "No ambulances available" unless the backend explicitly says so.

Generate typed views, action buttons with optimistic-disabled states (never
optimistic success), and an audit-friendly activity strip.
```

---

# Prompt 3 — Crew App

```text
Generate a CREW MOBILE APP for MediMove using Expo Router + TypeScript, the
universal brief, and the mobile design system in medimove/src/theme/tokens.ts.
This is for role CREW. It must work one-handed, in bright daylight, on a phone.

SCREENS
1. /crew/login
   - POST /auth/login; route by /auth/me role.

2. /crew/home
   - Availability toggle via POST /crew/me/availability.
   - Active offer cards from GET /dispatch/offers/me.
   - Assigned active trips from GET /crew/me/trips.

3. /crew/offer/:id
   - Offer detail from the offer list / booking summary available to the crew.
   - Accept: POST /dispatch/offers/:id/accept
   - Reject: POST /dispatch/offers/:id/reject
   - Only enable while status = PENDING and not expired.
   - Acceptance success only after backend confirms.

4. /crew/trip/:id
   - Trip from GET /crew/me/trips/:id.
   - Milestones via PATCH /crew/me/trips/:id/status:
     EN_ROUTE -> ARRIVED -> PATIENT_ON_BOARD -> AT_HOSPITAL -> COMPLETED.
   - GPS sharing: POST /crew/me/trips/:id/location. Explicit Start/Stop control,
     foreground only, clear privacy copy, stop on unmount/background.
   - No-show: POST /crew/me/trips/:id/no-show with mandatory reason, only from
     ARRIVED.
   - Cash: POST /payments/cash after on-scene collection.
   - Navigation cue uses the pickup/destination coordinates from the trip; never
     invent a route or ETA.

5. /crew/profile
   - GET/PATCH /crew/me
   - GET/POST /crew/me/documents
   - GET /crew/me/documents status badges: PENDING/APPROVED/REJECTED.

DESIGN RULES
- Large primary buttons (56px+), high contrast, 44px minimum touch targets.
- Show "OFFER" vs "ASSIGNED TRIP" clearly; they are different states.
- Show verification status of the crew/vehicle if present. PENDING is not active.
- Location permission denied -> explain and keep manual/status flow usable.
- Stale or absent GPS -> "Location not shared" rather than a fake live dot.
- No invented ambulance availability, no fake offers, no fake ETAs.

Generate Expo Router files, typed service layer, and accessibility labels.
```

---

# Prompt 4 — Provider Admin Portal

```text
Generate a PROVIDER ADMIN PORTAL for MediMove using the universal brief and
docs/openapi.yaml. Role: PROVIDER_ADMIN, scoped to their provider.

SECTIONS
- /provider/overview: profile completeness, verification status, vehicle count,
  crew count, active bookings (only if the API returns counts; otherwise show
  "Unavailable").
- /provider/profile: GET/PATCH /providers/me.
- /provider/locations: GET/POST/PATCH/DELETE /providers/me/locations.
- /provider/service-areas: GET/POST/DELETE /providers/me/service-areas.
- /provider/fleet:
  GET/POST/PATCH/DELETE /providers/me/ambulances
  POST /providers/me/ambulances/:id/location
  POST /providers/me/ambulances/:id/availability
- /provider/crew:
  GET/POST /providers/me/crew/invitations
  POST /providers/me/crew/invitations/:id/revoke
  GET /providers/me/crew
  POST /providers/me/crew/:id/assign
  POST /providers/me/crew/:id/deactivate|suspend|reactivate
- /provider/bookings: provider-scoped booking list/tracking where permitted.
- /provider/feedback: GET feedback scoped to provider.

RULES
- Verification and activation of the provider/vehicles/crew are platform-admin
  actions; this portal only maintains its own records and submits for review.
- Provider admins also have dispatch-management permissions scoped to their
  provider. Reuse dispatcher components with a ProviderAdmin scope guard if a
  `/provider/dispatch` area is required; do not broaden the scope.
- A vehicle cannot be offered for dispatch unless VERIFIED + active + available.
- A crew member cannot receive offers unless VERIFIED/ACTIVE and assigned.
- PENDING verification is an honest review state, not a failure and not approval.
- Availability values are exact: AVAILABLE, ON_DUTY, OFFLINE, UNAVAILABLE.
- Do not let the portal submit a vehicle location on behalf of a crew trip; that
  is the crew app's job via /crew/me/trips/:id/location.
- All mutations require confirmation and real backend success.

Use tables + drawers; light mode; approved palette; typed client; BACKEND GAP
notes where a count/list endpoint is missing.
```

---

# Prompt 5 — Hospital Staff Portal

```text
Generate a HOSPITAL STAFF PORTAL for MediMove using the universal brief and
docs/openapi.yaml. Role: HOSPITAL_STAFF, scoped to their hospital.

SECTIONS
- /hospital/incoming:
  GET /hospitals/me/incoming. Show inbound patient alerts and backend-provided
  ETA only. No invented arrival times. Minimum-necessary patient detail only.
- /hospital/profile: GET/PATCH /hospitals/me.
- /hospital/specialties: GET/PUT /hospitals/me/specialties.
- /hospital/services: GET/PUT /hospitals/me/services.
- /hospital/capacity:
  GET/PATCH /hospitals/me/capacity.
  HospitalIntakeStatus is maintained/self-reported, NOT real-time:
  OPEN, LIMITED, DIVERTING, CLOSED. Show its updatedAt timestamp.
- /hospital/staff:
  GET/POST /hospitals/me/staff, DELETE /hospitals/me/staff/:id.

RULES
- Never expose full patient medical records. The backend does not provide them to
  hospital staff; do not invent a field for them.
- Capacity/intake is self-reported. Label it "Last updated by hospital".
- Service status exact values: AVAILABLE, LIMITED, UNAVAILABLE.
- Tracking/ETA only when the backend returns it; otherwise "ETA unavailable".

Generate typed screens, service layer, loading/empty/error states, and accessible
components.
```

---

# Prompt 6 — Patient / Requester Mobile App

```text
Generate/refine the PATIENT/REQUESTER MOBILE APP for MediMove using Expo Router,
TypeScript, the universal brief, medimove/AGENTS.md, and the existing mobile
design system. This is an emergency-first, map-first consumer app.

EXPO-SPECIFIC RULES
- The project is Expo SDK 58. Before using any Expo/EAS/RN API, read
  package.json, fetch https://docs.expo.dev/versions/v58.0.0/, and follow
  https://docs.expo.dev/llms.txt for corrections. Do not answer from memory.
- Navigation is Expo Router only. Screens live in src/app/; non-route code stays
  outside src/app/. Use `npx expo install` for dependencies.
- Run `npx tsc --noEmit` and `npx expo lint` before declaring any mobile task done.
- Native folders are generated; configure app.json/plugins, never hand-edit them.
- Expo Go cannot render native Mapbox tiles or the Interswitch WebView; say so
  in docs rather than pretending those flows work in Go.

CURRENT IMPLEMENTATION STATUS
- Only the requester role is implemented in the mobile app today. The role union
  exists in types but there are no dispatcher/crew/provider/hospital/admin mobile
  screens yet. Do not claim otherwise.
- Current routes: (auth)/welcome|login|register|verify; (tabs) home/activity/
  wallet/vault/profile; location-picker; journey/setup; journey/live;
  request/[mode]; booking/checkout; booking/[id]; test-api.
- Profile sections for Medical ID, emergency contacts, language and help are
  explicit "not built yet" stubs. Preserve that honesty if regenerating them.
  Password forgot/reset/change service calls exist but have no screens yet.
- The README's old "dark-first" and "Ado-Ekiti fallback" notes are stale. The
  source of truth is the current working tree: light mode only and no fallback
  location.

ROUTES / FLOWS
- /(tabs)/index : Home map, emergency action immediately reachable, current
  location shortcut.
- /location-picker : familiar autocomplete-style pickup search (Google Places
  API (New), with Google Geocoding API for reverse lookup):
  * debounced GET /locations/search after 3 characters;
  * loading spinner, clear button, stale-response protection;
  * tappable suggestion rows showing place name + area detail;
  * visible `Google Maps` attribution when results are Google-provided;
  * prominent "Use my current location";
  * manual coordinates collapsed behind "Enter coordinates instead";
  * map pin placement with reverse geocoding;
  * explicit "Confirm this pickup point";
  * manual pins require a landmark/building description;
  * never silently use GPS/previous/failed location;
  * mobile store sources are `gps | manual | address`; map them to backend
    `LocationSource` values `GPS | MAP_PIN | MANUAL` where the API requires them.
- /journey/setup and /journey/live : independent, device-local journey tracking.
  It has a destination/hospital but no dispatch, no ETA, no patient details and
  no external sharing. Never imply an ambulance was sent.
- /request/[mode] : destination/hospital, emergency category, patient details,
  final review and POST /bookings. When isForSelf = false, backend requires
  patientName + patientPhone. Use a stable idempotencyKey until success. Never
  send price, distance, or status from the client. `providerId` IS required and
  must come from the selected verified provider.
  Provider cards must be filtered to `availableStatus`, `status === ACTIVE`,
  `verificationStatus === VERIFIED`, and `!isSimulated`. Urgency chips are
  guidance only; dispatch applies its own safety/operational rules.
- /booking/checkout : POST /payments/initialize or pay-with-wallet. Never treat a
  browser redirect as settlement; settlement is backend/webhook confirmed.
- /booking/[id] : status timeline, tracking, requester moving-pickup sharing.
  Show LIVE only from backend isLive; stale fixes show timestamp and LAST KNOWN.
- /(tabs)/bookings (Activity), /(tabs)/wallet, /(tabs)/vault, /(tabs)/profile :
  existing scoped surfaces.

TRACKING / PRIVACY
- "Track My Journey" is device-local only: no dispatch, no backend upload, no ETA.
  The store is not persisted; never imply an ambulance was sent or that anyone
  else can see the trail.
- Requester location sharing uses
  POST /bookings/:id/tracking/requester-location, explicit consent, foreground
  only, visible sharing badge, and a Stop action. Only offer it in moving-pickup
  statuses ACCEPTED, EN_ROUTE and ARRIVED.
- The existing hook watches at ~5s / 15m, serialises POSTs, and stamps time on
  the server. Do not add background location or invent speed/heading.
- Requester fixes are separate from ambulance fixes and never feed ambulance ETA.
- Booking tracking polls every 3s only while the screen is mounted and the
  booking is non-terminal; Home polls active requests every 10s.
- Follow-camera engages only when `tracking.isLive && location.isLive`; heading
  comes from backend fixes/bearingDeg, never estimated movement.
- Web and no-token Mapbox output must use the exact caption prefix
  `PREVIEW · …`. There is no `PREWEB` token.

DESIGN
- Light mode only, Manrope, approved palette, 44px touch targets, Ionicons only,
  accessibility labels.
- Native Mapbox when a token exists; web/no-token map output must explicitly say
  PREVIEW.
- Emergency button is reserved for the emergency action, not decoration.

Generate screens that reuse src/components/ui and src/components/MapCanvas rather
than replacing them. Do not add fake providers, fake ambulances, or fake ETAs to
make the map look alive.
```

---

# Prompt 7 — Shared design system for any generated UI

```text
Apply this design system to every screen generated above.

PALETTE
Primary:        #145B63
Secondary:      #087F8C
Canvas:         #F4F7F8
Surface:        #FFFFFF
Highlight:      #EAF3F5
Text:           #172B3A
Text muted:     #64748B
Text faint:     #94A3B8
Border:         #E2E8F0
Success:        #16845B
Warning:        #D97706
Emergency:      #D92D20

SPACING (4pt scale)
4, 8, 12, 16, 20, 24, 32, 40

RADIUS
10, 14, 18, 22, 28, pill

TYPE
Manrope. Display 28/34 700, Title 24/30 700, Heading 19/25 700,
Subheading 16/22 650, Body 15/22 400, BodyStrong 600, Caption/Micro smaller.
Only headings, buttons, labels are heavy. Body copy stays regular.

COMPONENTS
Minimum touch target 44px. Buttons 56px. Inputs 54px. List rows 56px.
Screen padding 20. Section spacing 24.

ACCESSIBILITY
Every button/input/marker needs an accessibility label. Visible focus states.
Do not rely on colour alone for status: pair with text/icon. Emergency red is
reserved for urgent user-initiated actions, not general errors.

STATUS BADGES
Use exact backend enum strings as the source, but humanise the label:
REQUESTED -> Requested, PENDING VERIFICATION -> Pending verification,
LAST KNOWN -> Last known. Never turn PENDING into "Live" or "Verified".
```

---

## Endpoint map by role

### Admin / state admin

```text
GET  /admin/reports/overview
GET  /admin/notifications, /stats, /:id, POST /:id/retry, /:id/cancel, /process
GET  /admin/users, /:id
PATCH /admin/users/:id/role
POST /admin/users/:id/suspend, /:id/activate
GET  /admin/audit-logs
GET  /admin/bookings
GET  /admin/payments
GET  /admin/hospitals; POST /admin/hospitals
GET  /admin/hospitals/:id; PATCH /admin/hospitals/:id
POST /admin/hospitals/:id/suspend, /:id/activate
GET/POST /admin/states; PATCH /admin/states/:id
GET/POST /admin/service-areas; PATCH/DELETE /admin/service-areas/:id
GET/POST /admin/providers, GET /admin/providers/:id
POST /admin/providers/:id/verify, /:id/activate, /:id/suspend
POST /admin/ambulances/:id/verify
POST /admin/crew/:id/verify
POST /admin/crew-documents/:id/review
GET/POST/PATCH /admin/pricing; GET /admin/pricing/:id; PATCH /admin/pricing/:id/status
GET /feedback, GET /complaints, PATCH /complaints/:id/status
```

### Dispatcher

```text
GET  /dispatch/bookings
GET  /dispatch/ambulances
GET  /dispatch/bookings/:id
POST /dispatch/bookings/:id/escalate
POST /dispatch/bookings/:id/contact
GET  /bookings/:id/dispatch/candidates
POST /bookings/:id/dispatch
POST /bookings/:id/dispatch/retry
POST /bookings/:id/assign
GET  /bookings/:id/offers
GET  /bookings/:id/tracking
```

### Crew

```text
GET  /dispatch/offers/me
POST /dispatch/offers/:id/accept
POST /dispatch/offers/:id/reject
GET  /crew/me, PATCH /crew/me
POST /crew/me/availability
GET/POST /crew/me/documents
GET  /crew/me/trips
GET  /crew/me/trips/:id
PATCH /crew/me/trips/:id/status
POST /crew/me/trips/:id/location
POST /crew/me/trips/:id/no-show
POST /payments/cash
```

### Provider admin

```text
GET/PATCH /providers/me
GET/POST/PATCH/DELETE /providers/me/locations
GET/POST/DELETE /providers/me/service-areas
GET/POST/PATCH/DELETE /providers/me/ambulances
POST /providers/me/ambulances/:id/location
POST /providers/me/ambulances/:id/availability
GET/POST /providers/me/crew/invitations
POST /providers/me/crew/invitations/:id/revoke
GET /providers/me/crew
POST /providers/me/crew/:id/assign
POST /providers/me/crew/:id/deactivate|suspend|reactivate
GET /feedback
```

### Hospital staff

```text
GET/PATCH /hospitals/me
GET/PUT /hospitals/me/specialties
GET/PUT /hospitals/me/services
GET/PATCH /hospitals/me/capacity
GET/POST /hospitals/me/staff
DELETE /hospitals/me/staff/:id
GET /hospitals/me/incoming
GET /bookings/:id/tracking
```

### Patient / requester

```text
POST /auth/register, /auth/verify-email, /auth/login, /auth/refresh
GET  /profile, PATCH /profile
GET/POST/PATCH/DELETE /profile/emergency-contacts
GET/POST /profile/consents
GET/PUT/DELETE /profile/medical
GET/POST/PATCH/DELETE /locations
POST /locations/:id/primary
GET  /locations/coverage, /locations/distance
GET  /locations/search, /locations/reverse-geocode
GET  /ambulances?lat=&lng=
POST /pricing/estimate
POST /bookings
GET  /bookings, /bookings/:id, /bookings/:id/history
POST /bookings/:id/cancel
GET  /bookings/:id/tracking
POST /bookings/:id/tracking/requester-location
POST /bookings/:id/feedback
GET  /trips/history, /trips/:id
POST /complaints, GET /complaints, GET /complaints/:id
POST /payments/initialize, POST /payments/pay-with-wallet
GET  /payments/history, /payments/:id, /payments/:id/receipt
GET  /wallet/balance, POST /wallet/fund
GET  /savings
POST /insurance/eligibility
GET  /notifications, /notifications/:id
```

---

## Backend gaps the AI must not paper over

These are capabilities that are **not clearly exposed as list/detail endpoints** in the current API docs. If a design needs them, return a `BACKEND GAP` note instead of inventing a call.

| Needed by | Missing/unclear capability | Correct AI behaviour |
|---|---|---|
| Admin fleet screen | Admin list of all ambulances | Use parent provider detail if it contains vehicles; otherwise `BACKEND GAP: add GET /admin/ambulances` |
| Admin crew screen | Admin list of all crew members/documents | `BACKEND GAP: add GET /admin/crew and GET /admin/crew-documents` |
| Admin document queue | Review by document ID exists; no pending-document list | Build from parent records where possible; otherwise `BACKEND GAP: add GET /admin/crew-documents?status=PENDING` |
| Admin dashboard | Some aggregate card values | Show "Unavailable"; do not compute from partial pages |
| Admin wallet/savings/insurance | No admin transaction lists, savings lists, or insurance profiles | Use only documented admin payment/user fields; otherwise `BACKEND GAP` |
| Live operations map | No global live-fleet endpoint; only per-booking tracking and scoped dispatch summaries | Assemble markers only from `/dispatch/bookings` + `/dispatch/ambulances`; label as snapshots. For a true global live map: `BACKEND GAP` |
| Live operations map | Historical track playback | Only show fixes returned by `/dispatch/bookings/:id` or tracking; no invented replay |
| Dispatcher queue | Summary intentionally omits patient identifiers, notes and medical detail | Show reference/status only; use approved-template contact action instead of inventing PHI fields |
| Feedback screens | Read-only; no admin update/delete/moderate endpoint | Label feedback as read-only; complaint status changes are the only supported write |
| Vault / Medical ID | No Health Vault or Medical ID product API; only minimal `/profile/medical` | Do not claim a vault exists; render the current "not built yet" stubs honestly |
| Hospital incoming | Full patient medical context | Do not add fields; backend deliberately provides minimum-necessary detail |
| Any role | Real-time push/Socket | Backend is polling-based; use polling and honest timestamps |

---

## Demo data notes

Use `prisma/seed.ts` and `prisma/seed-dispatch.ts` for local testing, then
`npm run db:seed:roles` to add the four console-role logins (see below).

Known seeded dispatch accounts from the Ekiti/Lagos dataset include:

```text
Patient:         patient.test@medimove.ng
Ekiti provider:  provider.test.ekiti@medimove.ng  / prov-test-ekiti-001
                 (provider contact address, not a seeded provider-admin login)
Ekiti ambulance: amb-test-ekiti-001 / registration AMB-TEST-EK-001
Ekiti crew:      crew.test.ekiti@medimove.ng
Ekiti dispatcher: dispatcher.test.ekiti@medimove.ng
Lagos provider:  provider.test.lagos@medimove.ng  / prov-test-lagos-001
                 (provider contact address, not a seeded provider-admin login)
Lagos ambulance: amb-test-lagos-001 / registration AMB-TEST-LA-001
Lagos crew:      crew.test.lagos@medimove.ng
Lagos dispatcher: dispatcher.test.lagos@medimove.ng
Hospital staff:  hospital.staff.test@medimove.ng  / hosp-1
Provider admin:  provider.admin.test@medimove.ng  / prov-test-ekiti-001
State admin:     state.admin.test@medimove.ng  / Ekiti state
Platform admin:  platform.admin.test@medimove.ng  / no scope (whole platform)
Password:        MediMove@123  (local seed only)
Coordinates:     7.7152, 5.2518 (Ekiti)
                 6.5244, 3.3792 (Lagos)
```

Older seed providers may be `PENDING` verification. That is correct — the app must hide them from dispatchable results. Use the dispatch seed for genuinely dispatchable data.

Run order matters: `npm run db:seed:dispatch` first (it creates the verified, active
provider/ambulance/crew and the Ekiti hospitals), then `npm run db:seed:roles`.
The role seed is idempotent and never deletes data. It reuses `prov-test-ekiti-001`,
`hosp-1` and the resolved Ekiti state id, and it clears irrelevant scopes on
re-run so a role can never inherit another role's data boundary.

`provider.test.ekiti@medimove.ng` and `provider.test.lagos@medimove.ng` are still
only provider contact addresses, not logins. Use `provider.admin.test@medimove.ng`
for the `PROVIDER_ADMIN` scope. These are demo credentials — never deploy them.

---

## Final acceptance checklist

Before calling a generated screen done, verify:

- [ ] Every API call exists in `docs/openapi.yaml`.
- [ ] No fake data, fake live dots, fake ETAs, fake offers, or fake availability.
- [ ] Money is integer kobo in the API; naira only in display.
- [ ] Distances/fares are never client-computed for submission.
- [ ] Auth refresh rotates tokens and retries once on 401.
- [ ] `ACCOUNT_SUSPENDED` ends the session without retry loops.
- [ ] Scope is respected; 404 is treated as out-of-scope, not rendered.
- [ ] PENDING verification is never shown as verified/dispatchable.
- [ ] Live tracking uses backend `isLive`; stale shows timestamp + LAST KNOWN.
- [ ] Requester pickup is explicitly confirmed; manual pins require a landmark.
- [ ] Foreground location has explicit start/stop and stops on unmount.
- [ ] Contact templates contain no free-text PHI.
- [ ] Audit log is read-only.
- [ ] Loading, empty, error, and offline states exist.
- [ ] Light palette, Manrope, 44px targets, and accessibility labels are present.
- [ ] Any missing backend capability is listed as a BACKEND GAP, not invented.
