# 3. API Endpoint Documentation

Base path: **`/api`**. All request and response bodies are JSON. Protected routes
require `Authorization: Bearer <accessToken>`.

## Interactive documentation (Swagger / OpenAPI)

The API is described by an **OpenAPI 3.1** document and can be browsed and
exercised interactively:

| Where | What |
|---|---|
| `GET /api/docs` | **Swagger UI** — interactive, "Try it out", bearer-token aware |
| `GET /api/docs/openapi.json` | The raw OpenAPI document (JSON) |
| [`docs/openapi.yaml`](./openapi.yaml) | The same document as YAML, for tooling |

Swagger UI is **enabled by default outside production and off in production**;
set `API_DOCS_ENABLED=true` to expose it publicly (see
[ENVIRONMENT.md](./ENVIRONMENT.md)).

**Using the spec elsewhere**

- **Swagger Editor** — open <https://editor.swagger.io> and paste/upload
  `docs/openapi.yaml`.
- **Postman / Insomnia** — Import → File → `docs/openapi.yaml` (or paste the URL
  of `/api/docs/openapi.json`).
- **Redoc / codegen** — point any OpenAPI tool at `docs/openapi.yaml`.

The document is generated from the endpoint tables in this file, so keep them in
sync and run `npm run docs:openapi` after editing.

## Quickstart (curl)

```bash
BASE=http://localhost:5000/api
```

**1. Register** (emails a 6-digit OTP):

```bash
curl -sX POST $BASE/auth/register -H 'Content-Type: application/json' -d '{
  "email": "patient@example.com",
  "password": "password1",
  "fullName": "Ada Obi",
  "phone": "+2348012345678"
}'
```

**2. Verify the code → tokens** (or sign in later with `/auth/login`):

```bash
curl -sX POST $BASE/auth/verify-email -H 'Content-Type: application/json' \
  -d '{"email":"patient@example.com","code":"123456"}'
```

The response contains `accessToken`, `refreshToken`, `expiresIn` and the user:

```json
{ "success": true, "user": { "id": "…", "role": "PATIENT" },
  "accessToken": "…", "refreshToken": "…", "tokenType": "Bearer",
  "expiresIn": "15m", "refreshTokenExpiresAt": "…" }
```

```bash
TOKEN=<accessToken>
REFRESH=<refreshToken>
```

**3. Call a protected endpoint:**

```bash
curl -s $BASE/auth/me -H "Authorization: Bearer $TOKEN"
```

**4. Rotate the access token when it expires (401):**

```bash
curl -sX POST $BASE/auth/refresh -H 'Content-Type: application/json' \
  -d '{"refreshToken":"'$REFRESH'"}'
```

> Refresh tokens are single-use. Always store the *new* `refreshToken` from the
> response; replaying an old one revokes the whole session family.

### A first emergency, end to end

```bash
# Estimate the fare (optional)
curl -sX POST $BASE/pricing/estimate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pickupLat":7.715,"pickupLng":5.2515,"destLat":7.72,"destLng":5.26}'

# Create the request (server computes distance + fare; never send a price)
curl -sX POST $BASE/bookings -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "pickupAddress": "Ado-Ekiti Central",
    "pickupLat": 7.715, "pickupLng": 5.2515,
    "destAddress": "EKSUTH, Ado-Ekiti", "destLat": 7.72, "destLng": 5.26,
    "callbackPhone": "+2348012345678",
    "emergencyCategory": "MEDICAL",
    "idempotencyKey": "retry-safe-key-1"
  }'
# -> { "success": true, "booking": { "id": "…", "reference": "MM-BOOK-…", "status": "REQUESTED" } }

# Track it (poll)
curl -s $BASE/bookings/<bookingId>/tracking -H "Authorization: Bearer $TOKEN"

# Moving pickup: while the crew is on the way, the requester can share the
# position of the vehicle they are in so the ambulance can meet them en route.
# Each call is one explicit, server-stamped fix; stopping the client watcher
# stops sharing. The returned tracking view exposes this as `requesterLocation`,
# separate from the ambulance `location` and its ETA.
curl -sX POST $BASE/bookings/<bookingId>/tracking/requester-location \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"latitude":7.718,"longitude":5.254,"accuracyMeters":12,"source":"GPS"}'

# Pay for it
curl -sX POST $BASE/payments/initialize -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"BOOKING","method":"CARD","bookingId":"<bookingId>"}'
```

Dispatch is driven by a dispatcher or the app (`POST /bookings/:id/dispatch`);
crew see and accept offers via `GET /dispatch/offers/me` and
`POST /dispatch/offers/:id/accept`.

## Conventions

### Authentication

- **Access token** — short-lived JWT (`ACCESS_TOKEN_TTL`, default 15m), sent as
  `Authorization: Bearer <token>`.
- **Refresh token** — long-lived, rotated on every use; stored hashed server-side.
  Reuse of a rotated token revokes the whole session family.
- Identity, role and scope are read from the **database on every request**; a
  suspended account or a role change takes effect immediately.
- On `401`, refresh via `POST /auth/refresh` and retry once. On `403
  ACCOUNT_SUSPENDED`, do not retry.

### Error envelope

```json
{ "success": false, "message": "Human-readable message", "code": "MACHINE_CODE" }
```

Validation errors include `field`/`details`. Common codes: `VALIDATION_ERROR`,
`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `CONCURRENT_MODIFICATION`,
`INVALID_STATUS_TRANSITION`, `ACCOUNT_SUSPENDED`, `OTP_MAX_ATTEMPTS`,
`CREW_OFFLINE`, `INVALID_SIGNATURE`. Out-of-scope single records return **404**
(never 403) so existence is not leaked. Internal details are never returned in
production.

### Pagination

List endpoints accept `page` (1-based) and `limit` (clamped) and return:

```json
{ "data": [ ... ], "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3, "hasNext": true, "hasPrev": false } }
```

Applies to `/bookings`, `/trips/history`, `/payments/history`, `/feedback`,
`/complaints` and the `/admin/*` list endpoints.

### Idempotency

`POST /bookings` accepts an optional `idempotencyKey` (unique per requester) so a
retried create returns the original booking instead of a duplicate. The payment
webhook is idempotent via a unique `dedupeKey`; notification enqueue is idempotent
via `dedupeKey`.

### Money

All amounts are integer **kobo** (1 NGN = 100 kobo) with the currency returned
alongside. The server computes every distance and fare; client-supplied amounts
are stripped by validation.

### Rate limits

| Scope | Limit |
|---|---|
| Auth routes (`/auth/*`) | 60 requests / 15 min per IP |
| Login | 10 / 15 min per IP + email |
| OTP request | 5 / 15 min per IP + email |
| Geocode (`/locations/search`, `/locations/reverse-geocode`) | per-IP limiter |

Limits are disabled under `NODE_ENV=test`.

## Endpoints

### Authentication & sessions

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | – | Create account + send verification OTP |
| POST | `/auth/verify-email` | – | Verify OTP → token pair |
| POST | `/auth/resend-verification` | – | Resend verification OTP |
| POST | `/auth/login` | – | Email + password login |
| POST | `/auth/refresh` | – | Rotate refresh token → new token pair |
| POST | `/auth/logout` | – | Revoke current session |
| POST | `/auth/logout-all` | ✅ | Revoke all sessions |
| GET | `/auth/me` | ✅ | Authenticated profile |
| GET | `/auth/sessions` | ✅ | List active sessions/devices |
| DELETE | `/auth/sessions/:id` | ✅ | Revoke a specific session |
| POST | `/auth/password/change` | ✅ | Change password (verifies current) |
| POST | `/auth/password/forgot` | – | Start password reset (OTP) |
| POST | `/auth/password/reset` | – | Complete password reset |

### Profile, consent & medical

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/profile` | ✅ | Profile + completion (`profile:read:own`) |
| PATCH | `/profile` | ✅ | Update name/phone/DOB/language (`profile:update:own`) |
| POST | `/profile/phone/request-verification` | ✅ | Send a phone OTP (`phone:verify`) |
| POST | `/profile/phone/verify` | ✅ | Verify the phone OTP (`phone:verify`) |
| GET | `/profile/emergency-contacts` | ✅ | List contacts (`emergency-contact:manage`) |
| POST | `/profile/emergency-contacts` | ✅ | Add a contact (`emergency-contact:manage`) |
| PATCH | `/profile/emergency-contacts/:id` | ✅ | Edit a contact (`emergency-contact:manage`) |
| DELETE | `/profile/emergency-contacts/:id` | ✅ | Remove a contact (`emergency-contact:manage`) |
| POST | `/profile/emergency-contacts/:id/primary` | ✅ | Set primary contact (`emergency-contact:manage`) |
| GET | `/profile/consents` | ✅ | Consent state + history (`consent:manage`) |
| POST | `/profile/consents` | ✅ | Grant consent (`consent:manage`) |
| POST | `/profile/consents/:type/withdraw` | ✅ | Withdraw consent (`consent:manage`) |
| GET | `/profile/medical` | ✅ | Own medical info, consent-gated (`medical:read:own`) |
| PUT | `/profile/medical` | ✅ | Create/replace medical info (`medical:write:own`) |
| DELETE | `/profile/medical` | ✅ | Delete medical info (`medical:write:own`) |

### Location & coverage

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/states` | ✅ | List states (`service-area:read`) |
| GET | `/locations` | ✅ | List own saved locations (`location:read:own`) |
| POST | `/locations` | ✅ | Save a location (`location:manage:own`) |
| GET | `/locations/:id` | ✅ | Get an own location (`location:read:own`) |
| PATCH | `/locations/:id` | ✅ | Update an own location (`location:manage:own`) |
| DELETE | `/locations/:id` | ✅ | Remove an own location (`location:manage:own`) |
| POST | `/locations/:id/primary` | ✅ | Set the primary location (`location:manage:own`) |
| GET | `/locations/coverage` | ✅ | Check coverage for a coordinate (`location:read:own`) |
| GET | `/locations/distance` | ✅ | Server-computed distance (`location:read:own`) |
| GET | `/locations/reverse-geocode` | ✅ | Coordinate → address (`location:read:own`) |
| GET | `/locations/search` | ✅ | Address → coordinates (`location:read:own`) |
| GET | `/ambulances` | – | Ranked hospitals + nearby providers (**requires `lat`/`lng`**) |

`GET /locations/search` uses Google Places API (New) Text Search and
`GET /locations/reverse-geocode` uses the Google Geocoding API. The response
`provider` is `google`. Google authorization/billing failures fail closed with
an empty result; no fallback provider or fabricated coordinates are used. UI
that displays these results must include Google Maps attribution.

### Bookings

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/bookings` | ✅ | Create an emergency request (`booking:create`) |
| GET | `/bookings` | ✅ | List bookings (scoped to your role) |
| GET | `/bookings/:id` | ✅ | Get a booking (ownership/scope enforced) |
| GET | `/bookings/:id/history` | ✅ | Append-only status history (scoped) |
| PATCH | `/bookings/:id/status` | ✅ | Advance booking status (`booking:update:status`) |
| POST | `/bookings/:id/cancel` | ✅ | Cancel a request (`booking:cancel:own` or operator) |
| GET | `/bookings/:id/dispatch/candidates` | ✅ | Ranked dispatch candidates (`dispatch:manage`) |
| POST | `/bookings/:id/dispatch` | ✅ | Start/restart dispatch → offers (`dispatch:manage`) |
| POST | `/bookings/:id/dispatch/retry` | ✅ | Retry with the next candidates (`dispatch:manage`) |
| GET | `/bookings/:id/offers` | ✅ | Offers for a booking (`dispatch:manage`) |
| POST | `/bookings/:id/assign` | ✅ | Manual assign / reassign override (`dispatch:manage`) |
| GET | `/bookings/:id/tracking` | ✅ | Last-known position + ETA (`tracking:read:own` / `tracking:read`) |
| POST | `/bookings/:id/tracking/requester-location` | ✅ | Share a moving-pickup GPS fix (`tracking:share:own`) |

### Dispatch

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dispatch/offers/me` | ✅ | Own live dispatch offers (`dispatch:read:own`) |
| POST | `/dispatch/offers/:id/accept` | ✅ | Accept an own offer (`dispatch:respond`) |
| POST | `/dispatch/offers/:id/reject` | ✅ | Decline an own offer (`dispatch:respond`) |
| GET | `/dispatch/bookings` | ✅ | Dispatcher incoming/operational queue (`dispatch:manage`) |
| GET | `/dispatch/ambulances` | ✅ | Available ambulances + crew in scope (`dispatch:manage`) |
| GET | `/dispatch/bookings/:id` | ✅ | Booking + status trail + offers + trip history + ETA (`dispatch:manage`) |
| POST | `/dispatch/bookings/:id/escalate` | ✅ | Escalate for manual assignment (`dispatch:manage`) |
| POST | `/dispatch/bookings/:id/contact` | ✅ | Contact a party via an approved template (`dispatch:contact`) |

### Crew trips & tracking

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/crew/me/trips` | ✅ | Crew's assigned trips (`trip:read:own`) |
| GET | `/crew/me/trips/:id` | ✅ | One assigned trip (`trip:read:own`) |
| PATCH | `/crew/me/trips/:id/status` | ✅ | Advance the trip (`trip:update`) |
| POST | `/crew/me/trips/:id/location` | ✅ | Record a trip GPS fix (`tracking:update`) |
| POST | `/crew/me/trips/:id/no-show` | ✅ | Report a patient no-show (`trip:update`) |

### Hospitals

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/hospitals` | ✅ | Hospital directory (reference data) |
| GET | `/hospitals/:id` | ✅ | One hospital profile (reference data) |
| GET | `/hospitals/me` | ✅ | Own hospital + maintained lists (`hospital:profile:read`) |
| PATCH | `/hospitals/me` | ✅ | Update own profile/location (`hospital:profile:manage`) |
| GET | `/hospitals/me/specialties` | ✅ | Own specialties (`hospital:profile:read`) |
| PUT | `/hospitals/me/specialties` | ✅ | Replace own specialties (`hospital:profile:manage`) |
| GET | `/hospitals/me/services` | ✅ | Own service availability (`hospital:profile:read`) |
| PUT | `/hospitals/me/services` | ✅ | Replace own service availability (`hospital:profile:manage`) |
| GET | `/hospitals/me/capacity` | ✅ | Own self-reported capacity/intake (`hospital:profile:read`) |
| PATCH | `/hospitals/me/capacity` | ✅ | Maintain own capacity/intake (`hospital:profile:manage`) |
| GET | `/hospitals/me/staff` | ✅ | Own authorized staff (`hospital:staff:manage`) |
| POST | `/hospitals/me/staff` | ✅ | Authorize a staff account (`hospital:staff:manage`) |
| DELETE | `/hospitals/me/staff/:id` | ✅ | Revoke a staff account (`hospital:staff:manage`) |
| GET | `/hospitals/me/incoming` | ✅ | Inbound patient alerts + ETA (`booking:read:hospital`) |

### Trip history, feedback & complaints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/trips/history` | ✅ | Consolidated trip history, paginated (scoped) |
| GET | `/trips/:id` | ✅ | One trip + events, payment, receipt, feedback, complaints (scoped) |
| POST | `/bookings/:id/feedback` | ✅ | Rate a trip the caller requested (`feedback:create:own`) |
| GET | `/bookings/:id/feedback` | ✅ | Feedback on a booking (scoped) |
| GET | `/feedback` | ✅ | Scoped, paginated feedback (`feedback:read:own`/`:provider`/`:state`) |
| GET | `/feedback/:id` | ✅ | One feedback record (scoped) |
| POST | `/complaints` | ✅ | Raise a complaint (`complaint:create:own`) |
| GET | `/complaints` | ✅ | Own/scoped complaints, paginated (`complaint:read:own`/`complaint:read:all`) |
| GET | `/complaints/:id` | ✅ | One complaint + handling trail (scoped) |
| PATCH | `/complaints/:id/status` | ✅ | Manage complaint status (`complaint:manage`, audited) |

### Pricing

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/pricing/estimate` | ✅ | Server-computed fare estimate (`pricing:estimate`) |
| GET | `/admin/pricing` | ✅ | List pricing rules (`pricing:read`) |
| GET | `/admin/pricing/:id` | ✅ | One pricing rule (`pricing:read`) |
| POST | `/admin/pricing` | ✅ | Create a pricing rule (`pricing:manage`) |
| PATCH | `/admin/pricing/:id` | ✅ | Update a pricing rule (`pricing:manage`) |
| PATCH | `/admin/pricing/:id/status` | ✅ | Activate/deactivate a rule (`pricing:manage`) |

### Payments & wallet

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/initialize` | ✅ | Start a payment (`payment:initiate`) |
| POST | `/payments/cancel` | – | Cancel a payment |
| POST | `/payments/verify` | – | Verify with provider + settle |
| POST | `/payments/webhook` | – | Provider callback (idempotent, signature-checked) |
| GET | `/payments/callback` | – | Browser redirect target from checkout |
| GET | `/payments/history` | ✅ | Own payment history (`payment:read:own`) |
| GET | `/payments/:id` | ✅ | One payment + timeline (`payment:read:own`) |
| GET | `/payments/:id/receipt` | ✅ | Issue/fetch a receipt (`payment:read:own`) |
| POST | `/payments/:id/refund` | ✅ | Refund a settled payment (`payment:refund`) |
| POST | `/payments/cash` | ✅ | Crew records cash collected (`payment:collect:cash`) |
| POST | `/payments/retry` | ✅ | Retry a failed payment (`payment:retry:own`) |
| POST | `/payments/pay-with-wallet` | ✅ | Pay a booking from wallet |
| GET | `/admin/payments` | ✅ | Payment oversight, paginated + state-scoped (`payment:read:all`) |
| GET | `/wallet/balance` | ✅ | Wallet balance |
| POST | `/wallet/fund` | ✅ | Fund wallet via Interswitch |
| GET | `/savings` | ✅ | Savings goals |
| POST | `/insurance/eligibility` | – | HMO eligibility check |

### Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | ✅ | Own notification feed (`notification:read:own`) |
| GET | `/notifications/:id` | ✅ | One own notification + delivery log (`notification:read:own`) |
| GET | `/admin/notifications` | ✅ | List the whole queue (`notification:read:all`) |
| GET | `/admin/notifications/stats` | ✅ | Queue counts by status (`notification:read:all`) |
| GET | `/admin/notifications/:id` | ✅ | One notification + delivery log (`notification:read:all`) |
| POST | `/admin/notifications/:id/retry` | ✅ | Requeue a failed notification (`notification:manage`) |
| POST | `/admin/notifications/:id/cancel` | ✅ | Cancel a pending notification (`notification:manage`) |
| POST | `/admin/notifications/process` | ✅ | Force a worker tick (`notification:manage`) |

### Providers, fleet & crew

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/providers/apply` | ✅ | Register as an ambulance provider (`provider:apply`) |
| GET | `/providers/me` | ✅ | Own provider profile (`provider:read:own`) |
| PATCH | `/providers/me` | ✅ | Update own provider profile (`provider:update:own`) |
| GET | `/providers/me/locations` | ✅ | List operating locations (`provider:read:own`) |
| POST | `/providers/me/locations` | ✅ | Add an operating location (`provider-location:manage`) |
| PATCH | `/providers/me/locations/:id` | ✅ | Update an operating location (`provider-location:manage`) |
| DELETE | `/providers/me/locations/:id` | ✅ | Remove an operating location (`provider-location:manage`) |
| GET | `/providers/me/service-areas` | ✅ | List linked service areas (`provider:read:own`) |
| POST | `/providers/me/service-areas` | ✅ | Link a service area (`provider-service-area:manage`) |
| DELETE | `/providers/me/service-areas/:id` | ✅ | Unlink a service area (`provider-service-area:manage`) |
| GET | `/providers/me/ambulances` | ✅ | List own vehicles (`ambulance:read:own`) |
| POST | `/providers/me/ambulances` | ✅ | Register a vehicle (`ambulance:manage`) |
| GET | `/providers/me/ambulances/:id` | ✅ | Get a vehicle (`ambulance:read:own`) |
| PATCH | `/providers/me/ambulances/:id` | ✅ | Update a vehicle (`ambulance:manage`) |
| DELETE | `/providers/me/ambulances/:id` | ✅ | Remove a vehicle (`ambulance:manage`) |
| POST | `/providers/me/ambulances/:id/location` | ✅ | Update vehicle location (`ambulance:manage`) |
| POST | `/providers/me/ambulances/:id/availability` | ✅ | Set vehicle availability (`ambulance:manage`) |
| GET | `/providers/me/crew/invitations` | ✅ | List crew invitations (`crew:read:provider`) |
| POST | `/providers/me/crew/invitations` | ✅ | Invite a crew member (`crew:manage`) |
| POST | `/providers/me/crew/invitations/:id/revoke` | ✅ | Revoke an invitation (`crew:manage`) |
| GET | `/providers/me/crew` | ✅ | List provider crew (`crew:read:provider`) |
| POST | `/providers/me/crew/:id/assign` | ✅ | Assign crew to a vehicle (`crew:manage`) |
| POST | `/providers/me/crew/:id/deactivate` | ✅ | Deactivate crew immediately (`crew:manage`) |
| POST | `/providers/me/crew/:id/suspend` | ✅ | Suspend crew (`crew:manage`) |
| POST | `/providers/me/crew/:id/reactivate` | ✅ | Reactivate crew (`crew:manage`) |
| POST | `/crew/invitations/:token/accept` | ✅ | Accept an invitation (`crew:self:manage`) |
| GET | `/crew/me` | ✅ | Own crew profile (`crew:read:own`) |
| PATCH | `/crew/me` | ✅ | Update own crew profile (`crew:self:manage`) |
| POST | `/crew/me/availability` | ✅ | Set own availability (`crew:self:manage`) |
| GET | `/crew/me/documents` | ✅ | List own documents (`crew:read:own`) |
| POST | `/crew/me/documents` | ✅ | Submit a document (`crew:self:manage`) |

### Administration & audit

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/users` | ✅ | List users, state-scoped (`admin:users:read`) |
| GET | `/admin/users/:id` | ✅ | Get a user, state-scoped (`admin:users:read`) |
| PATCH | `/admin/users/:id/role` | ✅ | Assign role + scope (`admin:roles:assign`) |
| POST | `/admin/users/:id/suspend` | ✅ | Suspend an account + revoke its sessions (`admin:users:manage`) |
| POST | `/admin/users/:id/activate` | ✅ | Re-activate an account (`admin:users:manage`) |
| GET | `/admin/audit-logs` | ✅ | Read the audit trail, state-scoped (`admin:audit:read`) |
| GET | `/admin/reports/overview` | ✅ | Aggregate operational report (`admin:reports:read`) |
| GET | `/admin/bookings` | ✅ | Booking oversight, paginated + filtered (`booking:read:all` / `booking:read:state`) |
| GET | `/admin/hospitals` | ✅ | List hospitals, state-scoped (`hospital:manage`) |
| POST | `/admin/hospitals` | ✅ | Create a hospital (`hospital:manage`) |
| GET | `/admin/hospitals/:id` | ✅ | Get a hospital, state-scoped (`hospital:manage`) |
| PATCH | `/admin/hospitals/:id` | ✅ | Update a hospital (`hospital:manage`) |
| POST | `/admin/hospitals/:id/suspend` | ✅ | Suspend a hospital (`hospital:manage`) |
| POST | `/admin/hospitals/:id/activate` | ✅ | Activate a hospital (`hospital:manage`) |
| GET | `/admin/states` | ✅ | List states (`state:manage`) |
| POST | `/admin/states` | ✅ | Create a state (`state:manage`) |
| PATCH | `/admin/states/:id` | ✅ | Update a state (`state:manage`) |
| GET | `/admin/service-areas` | ✅ | List service areas (`service-area:manage`) |
| POST | `/admin/service-areas` | ✅ | Create a service area (`service-area:manage`) |
| PATCH | `/admin/service-areas/:id` | ✅ | Update a service area (`service-area:manage`) |
| DELETE | `/admin/service-areas/:id` | ✅ | Remove a service area (`service-area:manage`) |
| GET | `/admin/providers` | ✅ | List providers, state-scoped (`provider:read:state`) |
| GET | `/admin/providers/:id` | ✅ | Get a provider, state-scoped (`provider:read:state`) |
| POST | `/admin/providers/:id/verify` | ✅ | Verify/reject a provider (`provider:verify`) |
| POST | `/admin/providers/:id/activate` | ✅ | Activate a provider (`provider:manage`) |
| POST | `/admin/providers/:id/suspend` | ✅ | Suspend a provider (`provider:manage`) |
| POST | `/admin/ambulances/:id/verify` | ✅ | Verify/reject a vehicle (`ambulance:verify`) |
| POST | `/admin/crew/:id/verify` | ✅ | Verify/reject a crew member (`crew:verify`) |
| POST | `/admin/crew-documents/:id/review` | ✅ | Approve/reject a document (`document:review`) |

## Webhooks

- **`POST /payments/webhook`** — provider callback. When
  `INTERSWITCH_WEBHOOK_SECRET` is set, the request must carry a valid
  HMAC-SHA256 `x-interswitch-signature` over the **raw** body; a mismatch is
  `401 INVALID_SIGNATURE`. In production an unset secret is `500
  WEBHOOK_UNCONFIGURED` (fail closed). Processing is idempotent via `dedupeKey`,
  and a payment is only settled after the gateway is queried independently and
  the amount/currency match.
- **`GET /payments/callback`** — browser redirect target after checkout. It never
  settles anything by itself.

## Health & 404

- Unmatched routes return `404 { "success": false, "message": "Route not found: …" }`.
- There is no dedicated `/health` endpoint yet; see
  [PRODUCTION_RISKS.md](./PRODUCTION_RISKS.md). A reverse proxy should probe a
  cheap authenticated route or be updated once a health check is added.
