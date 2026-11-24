# 1. Backend Architecture

## Overview

MediMove is a medical-transport and ambulance-coordination backend. It is a
single **Express 5** (TypeScript) HTTP service backed by **PostgreSQL** through
**Prisma 7** (driver adapter `@prisma/adapter-pg`). There is no message broker,
no cache and no separate worker process: an **in-process notification worker**
drains an outbox table. The design deliberately favours a small number of moving
parts that a small team can operate.

```
Clients (React Native app, operator dashboards, provider portals, hospitals)
        │  HTTPS + JSON
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Express app (src/app.ts)                                      │
│    helmet → trust proxy → cors → express.json (1mb + rawBody)  │
│    → routers (src/routes/*)                                    │
│        rate limit → authenticateToken → authorize/require      │
│        → validate(zod) → controller                            │
│    → notFound → errorHandler                                   │
└───────────────────────────────────────────────────────────────┘
        │  (services)
        ▼
┌───────────────────────────────────────────────────────────────┐
│  Domain services (src/services/*)                              │
│    business rules · authorization scope · DB transactions      │
└───────────────────────────────────────────────────────────────┘
        │  (Prisma client)
        ▼
┌───────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                    │
└───────────────────────────────────────────────────────────────┘
        ▲
        │  outbox poll
┌───────────────────────────────────────────────────────────────┐
│  Notification worker (in-process, src/services/notificationWorker.ts) │
│    EMAIL (SMTP) · SMS · PUSH · WHATSAPP  (adapter registry)    │
└───────────────────────────────────────────────────────────────┘
```

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js + Express 5, TypeScript (CommonJS) |
| ORM | Prisma 7 (`prisma-client` generator) + `@prisma/adapter-pg` |
| Database | PostgreSQL |
| Validation | zod (env + request schemas) |
| Auth | Short-lived JWT access tokens + rotating hashed refresh-token sessions; bcryptjs password hashing; HMAC-hashed OTPs |
| Email | Nodemailer (SMTP) |
| Payments | Interswitch (card / bank transfer) + server-side wallet & cash |
| Security headers | helmet |
| Rate limiting | express-rate-limit |
| Logging | pino (structured, with redaction) |
| Tests | vitest + supertest (in-memory Prisma mock) |

## Layering

The codebase follows a conventional Node/Express structure and keeps each layer
narrow:

| Layer | Directory | Responsibility |
|---|---|---|
| App wiring | `src/app.ts`, `src/index.ts` | Express middleware, route mounting, `listen`, graceful shutdown |
| Config | `src/config/env.ts` | Validated, typed environment; fails fast at boot |
| Routing | `src/routes/*.ts` | Path → middleware → controller only; no business logic |
| Middleware | `src/middleware/*` | auth, authorize, validate, rateLimit, notFound, errorHandler |
| Controllers | `src/controllers/*.ts` | Parse input, call a service, serialize output; no rules |
| Services | `src/services/*.ts` | Business rules, authorization scope, transactions, side effects |
| Validation | `src/validation/*.ts` | zod request schemas |
| Utils | `src/utils/*` | prisma client, access scope, logger, crypto, geo, pagination, serializers, mock client |
| Data model | `prisma/schema.prisma` | 38 models, 32 enums |

**Rule of thumb:** controllers never touch Prisma directly for writes and never
trust client-supplied amounts, ids or roles; services never read `process.env`
directly (they import the validated `env`).

## Request lifecycle

1. **Transport** — TLS terminated by a reverse proxy / load balancer.
2. **`helmet()`** — sets `X-Content-Type-Options`, `X-Frame-Options`, HSTS,
   Referrer-Policy, a conservative CSP and removes `X-Powered-By`.
3. **`trust proxy`** — set from `TRUST_PROXY` so `req.ip` is the real client
   (rate limiting and audit accuracy). Unset = trust nothing.
4. **`cors({ origin: CLIENT_ORIGIN })`** — a single allowed origin; unknown
   origins get no `Access-Control-Allow-Origin`.
5. **`express.json({ limit: '1mb', verify })`** — parses JSON and captures the
   raw bytes for webhook signature verification.
6. **Router** — per-route middleware in order:
   - `express-rate-limit` (auth/OTP/geocode routes only),
   - `authenticateToken` (verify JWT, load role + scope from the DB, reject
     suspended accounts),
   - `authorize(...)` / `requirePermission(...)` / `requireAnyPermission(...)`,
   - `validate(schema)` (zod; strips unknown fields).
7. **Controller** — reads `req.auth`, calls a service, serializes with
   `src/utils/serializers.ts`.
8. **Service** — applies business rules, enforces data scope, runs DB
   transactions, queues notifications.
9. **Error handling** — `errorHandler` maps `AppError` (and unknown errors) to a
   consistent JSON envelope; internal details are never leaked in production.
10. **404** — `notFound` for unmatched routes, before the error handler.

## Module map (by domain)

| Domain | Services | Notable routes |
|---|---|---|
| Auth & sessions | `authService`, `otpService`, `tokenService`, `mailService`, `smsService` | `/auth/*` |
| Profile & consent | `profileService`, `emergencyContactService`, `consentService`, `medicalInfoService` | `/profile/*` |
| Location & coverage | `locationService`, `coverageService`, `geocodingService`, `serviceAreaService` | `/locations/*`, `/states`, `/ambulances` |
| Providers / fleet / crew | `providerService`, `ambulanceService`, `crewService` | `/providers/*`, `/crew/*` |
| Booking | `bookingService` | `/bookings/*` |
| Dispatch | `dispatchService`, `dispatchEligibility`, `dispatchNotifier` | `/bookings/:id/dispatch*`, `/dispatch/*` |
| Trips & tracking | `tripService`, `trackingService` | `/crew/me/trips/*`, `/bookings/:id/tracking` |
| Pricing | `pricingService` | `/pricing/estimate`, `/admin/pricing/*` |
| Payments | `paymentService` | `/payments/*`, `/wallet/*` |
| Notifications | `notificationService`, `notificationAdapters`, `notificationTemplates`, `notificationWorker` | `/notifications/*`, `/admin/notifications/*` |
| Hospital ops | `hospitalService` | `/hospitals/*` |
| Feedback & complaints | `feedbackService`, `complaintService` | `/feedback/*`, `/complaints/*`, `/bookings/:id/feedback` |
| Trip history | `tripService` / `tripHistory` routes | `/trips/*` |
| Admin & audit | `adminService`, `auditService` | `/admin/*` |

## Cross-cutting concerns

- **Identity is always derived from the signed access token**, never from a
  client-supplied id. The role and scope (`stateId`, `hospitalId`, `providerId`)
  are re-read from the database on **every** request, so a role change or a
  suspension takes effect immediately without waiting for a token to expire.
- **Data scope** is enforced in one place (`src/utils/access.ts`). Collection
  endpoints are filtered; single-record reads are checked and return **404** when
  out of scope, so record existence is never leaked. A scope-less role matches
  nothing.
- **Validation** — every mutating endpoint has a zod schema; unknown fields are
  stripped (so a client cannot smuggle `estimatedFare`, `role`, etc.).
- **Centralized errors** — `AppError(status, message, details?)`; the handler
  emits `{ success: false, message, code? }` and hides internals in production.
- **Transactions** — multi-step writes (booking transitions, dispatch
  acceptance, suspensions, complaint status, hospital staff changes) run inside
  `prisma.$transaction` and use guarded `updateMany` count checks to prevent lost
  updates and double-accept races.
- **Audit logging** — sensitive/admin actions append an immutable `AuditLog`
  row, committed atomically with the change. There is no update/delete path.
- **Logging** — pino with redaction paths for passwords, hashes, tokens,
  `authorization` headers, member references and policy numbers. PHI is never
  logged.
- **Notifications** — the outbox pattern; producers persist a row in the same
  breath as the domain change and an in-process worker delivers it out of band
  with exponential backoff. Push/WhatsApp fail closed when unconfigured.

## Runtime topology & operations

- A single Node process (`src/index.ts`) serves HTTP and runs the notification
  worker (`startNotificationWorker()`), which can be disabled with
  `NOTIFICATION_WORKER_ENABLED=false` when a dedicated worker is run separately.
- **Graceful shutdown** on `SIGINT`/`SIGTERM`: stop the worker, stop accepting
  connections, disconnect Prisma.
- **No Docker** in this project (per project constraints); deploy as a Node
  process behind a managed Postgres (e.g. Aiven).
- **Scaling note:** the API is stateless (JWT + DB sessions), so it scales
  horizontally. Because the notification worker is in-process, either run it in
  exactly one instance or set `NOTIFICATION_WORKER_ENABLED=false` on all but one
  (the outbox claim is a guarded `updateMany`, so duplicate ticks are safe but
  wasteful).

## Security posture (summary)

See [PRODUCTION_RISKS.md](./PRODUCTION_RISKS.md) for the residual items. In
brief: helmet security headers; single-origin CORS; per-IP/per-email rate limits
on auth, OTP and geocode routes; HMAC-signed webhooks that fail closed in
production; parameterized Prisma queries only (no raw SQL); no file-upload
surface; secrets never returned or logged; and strict state/provider isolation
via `src/utils/access.ts`.
