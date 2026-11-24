# MediMove Console

Nuxt 4 + TypeScript web console for MediMove operations staff. This repository is
independent of the backend and mobile app repositories.

## Scope of this first slice

- Client-rendered Nuxt app (SPA) with PWA support via `@vite-pwa/nuxt`.
- One `ofetch` client with Bearer injection, single-flight refresh-token
  rotation, retry-once on 401, typed `ApiError`, and session end on
  `403 ACCOUNT_SUSPENDED`.
- Sign-in via `POST /auth/login` and role read from `GET /auth/me`.
- Route middleware per role tree plus an in-page `<RoleGate>` and a per-module
  `<NuxtErrorBoundary>`.
- Shared light-theme UI kit (Manrope, 44px targets, visible focus, tables,
  drawers, badges, filters, loading/empty/error/offline states).
- Five dashboard stubs backed only by documented backend endpoints:
  - `/dispatch` — `GET /dispatch/bookings`
  - `/provider` — `GET /providers/me`
  - `/hospital` — `GET /hospitals/me/incoming`
  - `/admin` — `GET /admin/reports/overview`
  - `/mobile-app` — sign-out screen for `PATIENT` / `CREW`

Each dashboard is intentionally a stub. Expand one only after explicit
confirmation; do not add mocks or invented endpoints.

## Requirements

- Node matching Nuxt 4's engine range (`^22.22.3 || ^24.15.0 || >=26.0.0` is
  required by the installed Nuxt 4.7; older Node may install with an
  `EBADENGINE` warning).
- npm.
- MediMove backend running locally on `http://localhost:5000` (API under `/api`).

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open <http://localhost:3000>.

`npm run build` produces `.output/`; `npm run preview` serves the built app.
`npm run typecheck` runs `nuxt typecheck` with `vue-tsc`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `NUXT_PUBLIC_API_BASE_URL` | `http://localhost:5000/api` | Backend API base URL. Override for staging/production; no component hardcodes this value. |

The value is exposed through `runtimeConfig.public.apiBaseUrl` in
`nuxt.config.ts`.

## Demo accounts

Password for all demo accounts: `MediMove@123`.

| Role | Email | Console route |
|---|---|---|
| `DISPATCHER` | `dispatcher.test.ekiti@medimove.ng` | `/dispatch` |
| `DISPATCHER` | `dispatcher.test.lagos@medimove.ng` | `/dispatch` |
| `PROVIDER_ADMIN` | `provider.admin.test@medimove.ng` | `/provider` |
| `HOSPITAL_STAFF` | `hospital.staff.test@medimove.ng` | `/hospital` |
| `STATE_ADMIN` | `state.admin.test@medimove.ng` | `/admin` |
| `PLATFORM_ADMIN` | `platform.admin.test@medimove.ng` | `/admin` |
| `PATIENT` | `patient.test@medimove.ng` | mobile app only |
| `CREW` | `crew.test.ekiti@medimove.ng` | mobile app only |
| `CREW` | `crew.test.lagos@medimove.ng` | mobile app only |

All console logins use the same password and are pre-verified. There is no
`/health` endpoint; API docs are at `GET /api/docs` when enabled.

## Architecture notes

- `app/composables/useApi.ts` is the only HTTP client. Components call typed
  service methods in `app/composables/useConsoleService.ts`.
- `app/utils/roleRouting.ts` is the single `homeForRole()` source of truth.
- `app/middleware/` contains the auth, guest and per-role guards.
- The backend re-reads role and scope on every request and is the real security
  boundary. Frontend gating is UX only; out-of-scope records are hidden and
  `404` is treated as out-of-scope.
- Money is integer kobo in the API and is formatted to naira only in
  `app/utils/money.ts` at display time. Distance and ETA are shown only when the
  server supplies them. The client never sends or calculates a fare.

## BACKEND GAP notes

Capabilities not exposed by documented list/detail endpoints are not invented:

- No global live-fleet endpoint exists. A true live operations map needs
  `GET /admin/ambulances` or an equivalent scoped live-fleet endpoint.
- No admin crew list or crew-document list exists (`GET /admin/crew`,
  `GET /admin/crew-documents` would be needed).
- No pending-document queue endpoint exists for review by status.
- No admin transaction, savings or insurance list endpoints exist.

Where a stub touches one of these areas it says so in the UI; no fake list or
fake live state is rendered.

## Git

This directory is its own Git repository. Do not import code across the
backend or mobile app folders — they are read-only references.
