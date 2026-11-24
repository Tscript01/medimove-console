# 4. Environment Variables

Configuration is validated at boot by `src/config/env.ts` (zod). **The process
refuses to start** if required values are missing or malformed, and it applies
extra fail-fast rules in production (see below). Import the validated `env`
object everywhere — never read `process.env` directly. `.env.example` is the
canonical template.

## Production fail-fast rules

At `NODE_ENV=production` the app **throws at startup** if:

- `JWT_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` or `OTP_HASH_SECRET`
  is shorter than 32 characters (the first three default to `JWT_SECRET`);
- `SMTP_HOST` is not set (OTP codes are never logged in production).

Additionally, **webhook signature verification fails closed in production**: if
`INTERSWITCH_WEBHOOK_SECRET` is unset, `POST /payments/webhook` returns
`500 WEBHOOK_UNCONFIGURED` rather than accepting an unauthenticated callback.
In development the same call is allowed so the flow can be exercised locally.

## Core

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `5000` | HTTP listen port |
| `LOG_LEVEL` | no | `info` | pino level (`silent` under test) |
| `DATABASE_URL` | prod | – | Postgres URL. Omit in dev to use the in-memory mock client. Managed Postgres with a private CA needs `?sslmode=no-verify` |

## Auth & secrets

| Variable | Required | Default | Notes |
|---|---|---|---|
| `JWT_SECRET` | **yes** | – | Base signing secret. **≥ 32 chars in production** |
| `JWT_ACCESS_SECRET` | no | `JWT_SECRET` | Access-token secret |
| `JWT_REFRESH_SECRET` | no | `JWT_SECRET` | Refresh-token secret |
| `OTP_HASH_SECRET` | no | `JWT_SECRET` | HMAC key for OTP hashing |
| `ACCESS_TOKEN_TTL` | no | `15m` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | no | `90` | Refresh-token max lifetime (absolute cap) |
| `OTP_TTL_MINUTES` | no | `5` | OTP validity |
| `OTP_MAX_ATTEMPTS` | no | `5` | Incorrect-code attempts before lock |
| `OTP_RESEND_COOLDOWN_SECONDS` | no | `60` | Minimum gap between OTP sends |

## URLs & proxy

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CLIENT_ORIGIN` | no | `http://localhost:3000` | The single CORS-allowed origin |
| `APP_BASE_URL` | no | `http://localhost:5000` | Used to build payment redirect URLs |
| `TRUST_PROXY` | no | – | Trusted reverse-proxy hops (e.g. `1`) or a subnet list (e.g. `loopback`). Unset = trust nothing. **Never `true` on the public internet** |

## API documentation

| Variable | Required | Default | Notes |
|---|---|---|---|
| `API_DOCS_ENABLED` | no | on outside prod, off in prod | Serve Swagger UI at `/api/docs` and the spec at `/api/docs/openapi.json`. `true`/`false` |

## Email (SMTP)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SMTP_HOST` | **prod** | – | Required in production (OTP codes are never logged there) |
| `SMTP_PORT` | no | – | e.g. `587` |
| `SMTP_SECURE` | no | `false` | `true` for implicit TLS (port 465) |
| `SMTP_USER` / `SMTP_PASS` | no | – | SMTP credentials |
| `SMTP_FROM` | no | `MediMove <no-reply@medimove.ng>` | From header |
| `SMTP_REPLY_TO` | no | – | Optional Reply-To |

## SMS (phone verification)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SMS_PROVIDER` | no | – | Unset: codes logged in dev, requests fail closed in prod |
| `SMS_API_KEY` | no | – | Provider key |
| `SMS_SENDER_ID` | no | `MediMove` | Sender id |

## Geocoding / maps

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GEOCODING_PROVIDER` | no | `google` | `google` \| `mapbox` \| `nominatim` \| `none` |
| `GOOGLE_MAPS_API_KEY` | when `google` | – | Places API (New) + Geocoding API key; auth/billing failures fail closed |
| `MAPBOX_ACCESS_TOKEN` | no | – | Opt-in Mapbox geocoding; without it that provider degrades to Nominatim (dev) |

## Dispatch engine

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DISPATCH_OFFER_TTL_SECONDS` | no | `40` | Offer lifetime, 10–300s |
| `DISPATCH_MAX_ROUNDS` | no | `3` | Offer rounds before escalation |
| `DISPATCH_MAX_CANDIDATES` | no | `3` | Crew offers per round |
| `DISPATCH_MAX_RADIUS_KM` | no | `50` | Drop candidates farther than this (when position known) |

## Trip tracking

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TRACKING_STALE_AFTER_SECONDS` | no | `120` | A fix older than this is never "live" |
| `TRACKING_ETA_SPEED_KPH` | no | `40` | Assumed speed for ETA when no live speed |
| `TRACKING_HISTORY_LIMIT` | no | `20` | Recent points returned with a tracking read |

## Interswitch / payments

| Variable | Required | Default | Notes |
|---|---|---|---|
| `INTERSWITCH_MODE` | no | `TEST` | `TEST` \| `LIVE` |
| `INTERSWITCH_MERCHANT_CODE` | no | `MX6072` | Merchant code |
| `INTERSWITCH_PAY_ITEM_ID` | no | `9405967` | Pay item id |
| `INTERSWITCH_REDIRECT_URL` | no | – | Checkout redirect |
| `INTERSWITCH_WEBHOOK_SECRET` | **prod** | – | HMAC-SHA256 secret for `x-interswitch-signature`. Fail closed in prod when unset |
| `CLIENT_ID` / `CLIENT_SECRET` | no | – | Interswitch OAuth credentials |
| `PAYMENT_CURRENCY` | no | `NGN` | Settlement currency; callbacks must match |
| `PAYMENT_ENABLED_METHODS` | no | `CARD,BANK_TRANSFER,WALLET,CASH` | Comma-separated accepted methods |
| `PAYMENT_RECEIPT_PREFIX` | no | `MM-RCPT` | Receipt-number prefix |

## Notifications

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NOTIFICATION_WORKER_ENABLED` | no | `true` | Drain the outbox in-process. Set `false` on all but one instance when scaling |
| `NOTIFICATION_POLL_INTERVAL_SECONDS` | no | `15` | Worker tick interval |
| `NOTIFICATION_BATCH_SIZE` | no | `50` | Rows claimed per tick (max 500) |
| `NOTIFICATION_MAX_ATTEMPTS` | no | `5` | Attempts before FAILED (max 20) |
| `NOTIFICATION_RETRY_BASE_SECONDS` | no | `30` | Backoff base (`base · 2^(n−1)`, capped 1h) |
| `PUSH_PROVIDER` / `PUSH_API_KEY` | no | – | Unset: log in dev, reject in prod |
| `WHATSAPP_PROVIDER` / `WHATSAPP_API_KEY` / `WHATSAPP_PHONE_ID` | no | – | Same fail-closed rule |

## Generating secrets

```bash
openssl rand -hex 32   # use the output for JWT_SECRET (and the dedicated secrets)
```
