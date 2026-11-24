# Portable reference bundle

This folder contains a read-only snapshot of the backend and mobile reference
material needed to continue building the console on a machine that does **not**
have the original `interbackend` or `medimove` folders.

Do not import code from here into the app. Use it only to verify endpoints,
response shapes, schemas, role/permission rules and approved UI tokens.

## Start here

1. `../SESSION_BRIEF.md`
2. `../README.md`
3. `backend/docs/AI_FRONTEND_HANDOFF.md`
4. `backend/docs/openapi.yaml`
5. `backend/docs/API.md`
6. `backend/src/auth/permissions.ts`
7. `backend/src/utils/access.ts`

## What is included

- `backend/docs/` — full docs snapshot from `C:\Users\T_script\Desktop\interbackend\docs`
- `backend/src/auth/permissions.ts` — authoritative role/permission matrix
- `backend/src/utils/` — access scope rules, serializers and pagination helpers
- `backend/src/middleware/` — validation and error envelope behaviour
- `backend/src/routes/`, `controllers/`, `services/`, `validation/` — endpoint,
  response-shape and query-parameter references
- `mobile/src/` — selected patterns from the Expo app for role routing,
  token storage, API client, `RoleGate` and theme tokens

## Rules

- `openapi.yaml` is the source of truth for endpoints, bodies, responses, enums
  and status codes. Generic schemas may need to be confirmed against the
  controllers and serializers included here.
- The backend is the security boundary. Never reimplement scope derivation from
  `access.ts`; only mirror role navigation and hide out-of-scope data.
- No secrets, `.env` files, database files or generated outputs are included.
- This is a snapshot dated 2026-11-24. If the live backend has changed, refresh
  this folder from the backend repository before relying on it.
