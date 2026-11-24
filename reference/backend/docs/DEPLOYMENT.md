# 7. Deployment Checklist

This checklist takes the backend from a passing test suite to a running
production service. It does **not** by itself establish production-readiness —
the residual items are in [PRODUCTION_RISKS.md](./PRODUCTION_RISKS.md).

## 1. Pre-flight (build & tests)

- [ ] `npm ci` (or `npm install`) succeeds; `postinstall` runs `prisma generate`.
- [ ] `npm run lint` — `tsc --noEmit` and `tsc -p tsconfig.test.json` are clean.
- [ ] `npm test` — all suites pass.
- [ ] `npm run build` — compiles to `dist/` and copies the generated Prisma
      client (`dist/generated`).
- [ ] A staging deploy has been exercised end-to-end against a **staging
      Postgres**, not the in-memory mock.

## 2. Secrets & environment

- [ ] `NODE_ENV=production`.
- [ ] `JWT_SECRET` (and any dedicated `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
      `OTP_HASH_SECRET`) are **≥ 32 random chars** (`openssl rand -hex 32`). The
      app refuses to boot otherwise.
- [ ] `DATABASE_URL` set, with `?sslmode=no-verify` (or a proper
      `sslrootcert`) for a private-CA provider.
- [ ] `SMTP_HOST` (+ port/credentials/from) set — **required in production**.
- [ ] `CLIENT_ORIGIN` set to the exact production web/app origin (single origin).
- [ ] `INTERSWITCH_MODE=LIVE` and real `CLIENT_ID`/`CLIENT_SECRET`/
      `INTERSWITCH_MERCHANT_CODE`/`INTERSWITCH_PAY_ITEM_ID`/`INTERSWITCH_REDIRECT_URL`.
- [ ] `INTERSWITCH_WEBHOOK_SECRET` set — otherwise the webhook **fails closed**
      in production.
- [ ] `GOOGLE_MAPS_API_KEY` set, with Places API (New) and Geocoding API enabled.
      A demo key without billing will fail closed; enable billing for both APIs.
- [ ] `SMS_*`, `PUSH_*`, `WHATSAPP_*` set for the channels the product actually
      uses (unset channels fail closed). `MAPBOX_ACCESS_TOKEN` is only needed for
      the opt-in Mapbox geocoding provider or native map rendering.
- [ ] `TRUST_PROXY` set to the real number of proxy hops (e.g. `1`) if behind a
      load balancer; **never `true`** on the public internet.
- [ ] `NOTIFICATION_WORKER_ENABLED=true` on exactly one instance (or run a
      dedicated worker) when scaling horizontally.
- [ ] `LOG_LEVEL=info` (not `debug`).
- [ ] Secrets live in a secret manager, never in the repo or image.

## 3. Database

- [ ] `npx prisma migrate status` reports the schema is up to date (20
      migrations).
- [ ] Apply pending migrations with `npx prisma migrate deploy` (see
      [MIGRATIONS.md](./MIGRATIONS.md)).
- [ ] Generated `migration.sql` files reviewed for destructive statements.
- [ ] Backups enabled **and a restore has been tested**.
- [ ] Reference data seeded: at least one `State` and the `Hospital` directory
      (the database is not seeded by default).
- [ ] Connection pooling sized for the instance count; Prisma `$disconnect` on
      shutdown confirmed (handled by `src/index.ts`).

## 4. Network, TLS & proxy

- [ ] TLS terminated at the load balancer / proxy; HTTP redirected to HTTPS.
- [ ] The proxy forwards `X-Forwarded-For`/`X-Forwarded-Proto` and matches
      `TRUST_PROXY`.
- [ ] `helmet` HSTS is active (confirm the `Strict-Transport-Security` header).
- [ ] CORS: only `CLIENT_ORIGIN` receives `Access-Control-Allow-Origin`.
- [ ] Request body limit is 1 MB (webhook raw-body capture intact).
- [ ] Firewall: Postgres reachable only from the app; the app port only from the
      proxy.

## 5. Process & runtime

- [ ] Run as a non-root user with a process manager (systemd/pm2/container
      orchestrator) and restart-on-failure.
- [ ] Graceful shutdown verified: `SIGTERM` stops the worker, closes the server
      and disconnects Prisma.
- [ ] Health/readiness probing configured. **Note:** there is no dedicated
      `/health` endpoint yet — probe a cheap route or add one (see risks).
- [ ] Horizontal scaling plan: stateless API is safe to scale; ensure only one
      notification worker runs.

## 6. Observability

- [ ] Application logs shipped and retained; confirm redaction (no tokens,
      passwords, OTPs, card data or PHI).
- [ ] Alerts on error rate, latency, 5xx, DB connectivity and worker backlog
      (`Notification` rows stuck `PENDING`/`FAILED`).
- [ ] Payment webhook failures and `WEBHOOK_UNCONFIGURED` alerted.
- [ ] Audit trail retained and access-controlled.

## 7. Post-deploy smoke test

- [ ] `POST /auth/register` → OTP email received → `POST /auth/verify-email`.
- [ ] `POST /auth/login` → `GET /auth/me`.
- [ ] `POST /bookings` (with a real provider) → `GET /bookings/:id`.
- [ ] Dispatch: `POST /bookings/:id/dispatch` → crew offer visible in the app.
- [ ] `POST /payments/initialize` and a live (or provider-sandbox) webhook
      settles correctly; a duplicate webhook is a no-op.
- [ ] A queued notification is delivered (worker draining).
- [ ] Suspending a test user via `/admin/users/:id/suspend` immediately blocks
      that user's access token.

## 8. Rollback

- [ ] Previous build artifact retained and deployable.
- [ ] Database rollback plan documented (forward-fix migration or restore).
- [ ] If a migration is destructive, a pre-deploy snapshot exists.
- [ ] Notification worker can be paused (`NOTIFICATION_WORKER_ENABLED=false`)
      during an incident without stopping the API.
