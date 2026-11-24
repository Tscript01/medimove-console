# 6. Test Report

## How to run

```bash
npm test                 # vitest run (whole suite)
npm run test:watch       # watch mode
npx vitest run tests/security.test.ts          # one file
npm run lint             # tsc --noEmit && tsc -p tsconfig.test.json
```

Tests use an **in-memory Prisma mock** (`src/utils/mockPrisma.ts` via
`vi.mock('../src/utils/prisma')`) and `supertest` against the exported `app`, so
they never touch a real database or send real mail/SMS. `vitest.config.mts` pins
`NODE_ENV=test`, `LOG_LEVEL=silent`, a test `JWT_SECRET`, `SMTP_HOST=localhost`,
`GEOCODING_PROVIDER=none`, `INTERSWITCH_MODE=TEST`, an empty
`INTERSWITCH_WEBHOOK_SECRET` and `NOTIFICATION_WORKER_ENABLED=false`.

> The mock client supports `findMany/findFirst/findUnique/create/createMany/update/updateMany/delete/deleteMany/count/upsert`,
> `in/notIn/not/equals`, `OR/AND/NOT`, `orderBy` and `skip`/`take`. It does **not**
> implement `groupBy`/`aggregate`, schema defaults or nested-relation filters.

## Result (Stage 16)

| Metric | Value |
|---|---|
| Test files | **26 passed** |
| Tests | **361 passed**, 0 failed |
| Type-check (`tsc --noEmit`) | clean |
| Type-check (`tsc -p tsconfig.test.json`) | clean |
| Build (`npm run build`) | clean |
| Duration | ~40s |

Stage 16 added **14 tests** in two files:

- `tests/security.test.ts` (10) — security hardening + failure scenarios.
- `tests/webhookSignature.test.ts` (4) — production webhook signature policy.

A follow-up added **3 tests** in `tests/docs.test.ts` for the interactive API
documentation (OpenAPI JSON, Swagger UI page, docs-only CSP relaxation).

## Suite map

| File | Focus |
|---|---|
| `auth.routes.test.ts` | Register → verify → login → refresh → logout; refresh reuse revokes the family |
| `authValidation.test.ts` | Auth request validation |
| `rbac.test.ts` | Role/permission gating and scope isolation |
| `profile.test.ts` | Profile, contacts, consent, medical gating |
| `crypto.test.ts` | Hashing / constant-time comparison helpers |
| `env.test.ts` | Environment schema + production fail-fast rules |
| `errorHandler.test.ts` | Centralized error mapping / no detail leak |
| `geo.test.ts` | Haversine + coverage math |
| `location.test.ts` | Locations, GPS validation, geocoding fallbacks |
| `booking.test.ts` | Booking state machine, fare authority, idempotency |
| `dispatch.test.ts` | Candidate matching, offers, accept/reject, concurrency |
| `dispatch-operations.test.ts` | Dispatcher queue, escalation, contact, manual assign |
| `trip.test.ts` | Milestones, no-show, GPS fixes, stale/last-known tracking |
| `pricing.test.ts` | Rule resolution, scoping, estimates |
| `payment.test.ts` | Init/verify/webhook idempotency, wallet, cash, refunds, failures |
| `notification.test.ts` | Outbox, retries/backoff, adapters, fail-closed channels |
| `provider-crew.test.ts` | Provider lifecycle, vehicles, crew invites/verification |
| `hospital.test.ts` | Hospital profile, staff, capacity, inbound alerts |
| `feedback.test.ts` | Rating (one per trip), scoped reads |
| `complaint.test.ts` | Complaint status machine + trail |
| `tripHistory.test.ts` | Consolidated trip history + pagination |
| `admin.test.ts` | Admin users/hospitals, suspension + session revocation, audit, reports |
| `serializers.test.ts` | Output shaping / PHI minimisation |
| **`security.test.ts`** *(new)* | Security headers, CORS, suspension, OTP abuse, crew-offline, GPS-unavailable, provider/state isolation |
| **`webhookSignature.test.ts`** *(new)* | Webhook HMAC policy: enforced when configured, fails closed in production |
| **`docs.test.ts`** *(new)* | OpenAPI JSON served, Swagger UI rendered, docs-only CSP relaxation |

## Required failure-scenario coverage

| Scenario | Status | Where |
|---|---|---|
| GPS unavailable (no fix at all) | ✅ | `security.test.ts` — tracking returns `location: null`, `isLive: false`, no ETA |
| GPS stale fix | ✅ | `trip.test.ts` — stale/last-known handling |
| Weak network (retry / idempotency resilience) | ✅ | `booking.test.ts` idempotency; `payment.test.ts` webhook idempotency; `notification.test.ts` backoff retries |
| Duplicate booking submission | ✅ | `booking.test.ts` — `idempotencyKey` returns the original booking |
| Crew rejects a dispatch offer | ✅ | `dispatch.test.ts` — rejection leaves the booking OFFERED for retry |
| Crew goes offline | ✅ | `security.test.ts` — excluded from candidates **and** blocked at accept time (`CREW_OFFLINE`) |
| No ambulance available | ✅ | `dispatch.test.ts` — no candidates → escalation |
| Payment fails | ✅ | `payment.test.ts` — failed payment never settles and never changes booking status |
| Notification delivery fails | ✅ | `notification.test.ts` — retries then FAILED; domain state untouched |
| User logs out | ✅ | `auth.routes.test.ts` — session revoked |
| Refresh token is revoked / reused | ✅ | `auth.routes.test.ts` — reuse revokes the whole family; suspended refresh rejected |
| OTP abuse | ✅ | `security.test.ts` — max attempts locks the challenge (`OTP_MAX_ATTEMPTS`); `authService` cooldown |
| Account suspension | ✅ | `security.test.ts` — login and verify-email both `403 ACCOUNT_SUSPENDED` |
| State / provider data isolation | ✅ | `security.test.ts` — cross-provider and cross-state reads return 404; `rbac.test.ts` |
| Webhook forgery | ✅ | `webhookSignature.test.ts` — no/incorrect signature rejected; unset secret fails closed in prod |

## Known test limitations

- **Mock, not Postgres.** The in-memory client does not enforce DB constraints,
  transactions or `groupBy`; it validates *logic*, not database semantics. Real
  constraint/transaction behaviour must be verified against a staging Postgres.
- **No concurrency stress.** The dispatch double-accept guard is asserted
  logically; a true parallel race against Postgres is not exercised.
- **Provider integrations are mocked.** Interswitch, SMTP, SMS, push and
  WhatsApp are stubbed; no live provider call is made in tests.
- **No end-to-end client tests.** The React Native app is out of scope.
- **No load/soak testing.** Rate limits and the notification worker are not
  exercised under sustained load.

These gaps are operational and are carried into
[PRODUCTION_RISKS.md](./PRODUCTION_RISKS.md).
