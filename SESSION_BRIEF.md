# MediMove Web Console — Session Brief

This folder is the **new web console**. Start a fresh OpenCode session with this
folder as the working directory. This file is the conversation-independent handoff;
read it first, then read the canonical backend docs it points to.

## Absolute paths

| What | Path |
|---|---|
| Web console (this folder) | `C:\Users\T_script\Desktop\MoblieAppTest\medimove-console` |
| Backend | `C:\Users\T_script\Desktop\interbackend` |
| Mobile app (read-only reference) | `C:\Users\T_script\Desktop\MoblieAppTest\medimove` |

## Step 1 — read these before writing code

1. `C:\Users\T_script\Desktop\interbackend\docs\AI_FRONTEND_HANDOFF.md`
   - **Prompt 0 — Universal brief** (non-negotiable product rules)
   - **Role matrix** + **API contract cheat sheet** (auth, errors, money, pagination)
   - **Prompt 1 — Admin Panel**, **Prompt 2 — Dispatcher Console**,
     **Prompt 4 — Provider Admin Portal**, **Prompt 5 — Hospital Staff Portal**
   - **Endpoint map by role**, **Backend gaps the AI must not paper over**,
     **Demo data notes**, **Final acceptance checklist**
2. `C:\Users\T_script\Desktop\interbackend\docs\openapi.yaml` and `docs/API.md` —
   **source of truth** for every endpoint, body, response, enum and status code.
3. `C:\Users\T_script\Desktop\interbackend\src\auth\permissions.ts` — authoritative
   role/permission matrix. The frontend mirrors it for navigation only.
4. `C:\Users\T_script\Desktop\interbackend\src\utils\access.ts` — how server-side
   scope (state / hospital / provider) is derived. Do **not** reimplement it in UI.

There is **no `/health` endpoint**. Swagger UI: `GET /api/docs` (when enabled);
raw spec: `GET /api/docs/openapi.json`.

## Architecture in 60 seconds

- Backend: Express 5 API under `/api`, Prisma 7 + Postgres, JWT auth.
- One user has **exactly one role**, re-read from the database on every request.
- Access token ~15 min. Refresh tokens **rotate on every use** — store the new one
  from every refresh response. On 401: refresh once, retry once. On 403 with
  `ACCOUNT_SUSPENDED`: end the session, do not retry.
- A 404 on one record can mean "out of scope" — never reveal that a record exists.
- Money is **integer kobo** everywhere in the API. Format to naira only at display.
- The **server computes distance and fare**. The client never sends or calculates a price.
- This console is a **PWA**. The mobile Expo app keeps only `PATIENT` and `CREW`.

## Console role → route → scope

| Role | Route | Scope |
|---|---|---|
| `DISPATCHER` | `/dispatch` | their state |
| `PROVIDER_ADMIN` | `/provider` | their provider |
| `HOSPITAL_STAFF` | `/hospital` | their hospital |
| `STATE_ADMIN` | `/admin` | their state |
| `PLATFORM_ADMIN` | `/admin` | whole platform |

`PATIENT` and `CREW` do **not** belong in this app. If one signs in here, show a
"use the mobile app" screen with sign-out, not a broken dashboard.

After `GET /auth/me`, redirect by `user.role` using a single `homeForRole()` helper
(the mobile app has the same pattern — see below).

## Demo logins (all password `MediMove@123`, all pre-verified)

| Role | Email |
|---|---|
| `DISPATCHER` | `dispatcher.test.ekiti@medimove.ng` |
| `DISPATCHER` | `dispatcher.test.lagos@medimove.ng` |
| `PROVIDER_ADMIN` | `provider.admin.test@medimove.ng` |
| `HOSPITAL_STAFF` | `hospital.staff.test@medimove.ng` |
| `STATE_ADMIN` | `state.admin.test@medimove.ng` |
| `PLATFORM_ADMIN` | `platform.admin.test@medimove.ng` |

Scopes: state admin → Ekiti (`state-ekiti`); provider admin → `prov-test-ekiti-001`;
hospital staff → `hosp-1`; platform admin → none (global).
Both seed scripts have already been run against the configured database.

Non-console mobile logins exist too: `patient.test@medimove.ng`,
`crew.test.ekiti@medimove.ng`, `crew.test.lagos@medimove.ng`.

## Non-negotiable rules (condensed from Prompt 0)

1. **No mock APIs**, fake journeys, fake ETAs, fake availability, fake verification,
   or success before the backend confirms it. Skeletons are fine; fake data is not.
2. **Never invent an endpoint.** If data is missing, add a clearly marked
   `BACKEND GAP` TODO and an honest empty state.
3. Live tracking is live only when the backend says `isLive`. Stale fixes show
   `LAST KNOWN` + the server timestamp. Only display an ETA the server returned.
4. Foreground location only, explicit consent, stop when the flow ends.
5. Every interactive element: accessible label, visible focus, ≥44px target.
6. Always implement loading, empty, error and offline states. Use the backend
   envelope `{ success: false, message, code }`; show field-level validation errors.
7. Frontend role gating is **UX only**. Backend RBAC is the security boundary.
   Still filter out-of-scope data from the UI even if a response leaks it.

## Patterns to reuse (read-only reference, don't import across folders)

In `C:\Users\T_script\Desktop\MoblieAppTest\medimove\src` — these are TypeScript
patterns, not React components. Port the ideas to Nuxt composables/middleware:
- `utils/roleRouting.ts` — `homeForRole()` / route constants
- `components/RoleGate.tsx` — declarative role guard → Nuxt route middleware + component
- `services/api.ts` — Bearer injection, rotation, typed `ApiError` → `ofetch` client
- `services/crew.service.ts` — typed service layer (no URLs in components)
- `theme/tokens.ts` — light palette + Manrope; min 44px targets

## Suggested first slice

1. Scaffold **Nuxt (latest) + TypeScript** in this folder. After install, read the
   installed `package.json` version and fetch the matching Nuxt docs before writing
   version-specific code — do not rely on remembered APIs.
2. Add PWA support using whatever module the installed Nuxt version's docs recommend.
3. Configure `runtimeConfig.public.apiBaseUrl` via `NUXT_PUBLIC_API_BASE_URL`
   (local `http://localhost:5000/api`). Never hardcode the API URL in components.
4. One `ofetch`-based client in a composable: Bearer injection, refresh-token
   rotation, retry-once, typed errors.
5. `/login` → `POST /auth/login`, store tokens, `GET /auth/me`, redirect by role
   with a single `homeForRole()` helper.
6. Route middleware per role tree (`/dispatch`, `/provider`, `/hospital`, `/admin`),
   plus an in-page `<RoleGate>` component. Nuxt auto code-splits pages; add an
   error boundary per role module (verify the current Nuxt API for this).
7. Shared UI kit (tables, drawers, badges, filters) + five dashboard stubs backed
   by **real** endpoints from the endpoint map.
8. README with run instructions and env var name.

## Current git state

Nothing from the recent mobile/backend work has been committed or pushed. This new
folder is an independent project — initialise its own git repo when ready.
