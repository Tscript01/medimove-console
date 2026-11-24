# 8. Remaining Production Risks

> **MediMove is not production-ready merely because its tests pass.** The suite
> (358 tests) exercises business logic against an in-memory mock. The items below
> can only be closed by real-world validation: a staging environment, live
> providers, legal/regulatory review and clinical sign-off. Treat this as the
> honest gap list, not a formality.

## Operational dependencies

| Risk | Why it matters | Needed to close |
|---|---|---|
| **No staging environment** | Tests use a mock Prisma client; DB constraints, transactions, `groupBy`/aggregates and concurrent races are not exercised against real Postgres | Stand up staging + production Postgres; run an end-to-end pass and a concurrency test on dispatch accept |
| **No load/soak testing** | Rate limits, the notification worker and DB connection pooling are untested under sustained load | Load-test dispatch, tracking polling and payment webhooks; size pools and worker batch sizes |
| **No dedicated health endpoint** | Proxies/orchestrators need a cheap liveness/readiness probe | Add `GET /health` (and `/health/ready` checking DB + worker) |
| **Single in-process notification worker** | If it runs on every instance, work is duplicated; if it dies, the outbox stalls silently | Pin the worker to one instance or run it separately; alert on outbox backlog and oldest `PENDING` age |
| **Lazy offer expiry (no scheduler)** | Stale dispatch offers are swept only on a dispatch read/action; a quiet system may leave offers "PENDING" past expiry | Add a periodic sweep (worker/cron) or accept the lazy model and document the UX |
| **No seeding / reference data** | States, hospitals, service areas and pricing rules must exist or bookings cannot be validated | Seed reference data and a review process for changes |
| **Backups untested** | A backup that has never been restored is a hypothesis | Enable automated backups and rehearse a restore |
| **Secret rotation unproven** | Rotating `JWT_SECRET` invalidates all sessions; there is no dual-key rotation | Document/maintain a rotation runbook (or add key-id support) |
| **Observability not wired** | pino logs exist but no metrics/tracing/alerting | Ship logs, add dashboards and alerts (5xx, webhook failures, worker backlog) |
| **No container/deploy tooling** | Deployment is manual per project constraints (no Docker) | Automate build/deploy and migrations in CI/CD |

## Regulatory & compliance dependencies

| Risk | Why it matters | Needed to close |
|---|---|---|
| **Health data protection (NDPR / HIPAA-like)** | The platform stores patient medical info, contacts and trip data; lawful basis, retention and subject-access processes must be real, not assumed | Legal review; documented lawful basis, retention policy, DSR process, DPIA |
| **Consent records** | Consent is captured and audited, but the wording/versioning and withdrawal downstream effects need legal sign-off | Legal-approved consent texts + a defined policy for what withdrawal does to retained records |
| **Emergency-service regulation** | Operating a medical dispatch service typically requires licensing and clinical governance (triage, dispatch protocols, medical direction) | Regulatory/clinical sign-off on triage, dispatch and escalation rules |
| **Data residency** | Managed Postgres region and any provider (Interswitch, SMS, push) must satisfy residency requirements | Confirm hosting regions and provider data flows |
| **Audit retention & access** | Append-only audit exists, but retention duration and who may read it are policy questions | Define retention and access policy; implement any required export |
| **PCI / payment handling** | No card data is stored (good), but live Interswitch integration and reconciliation still need compliance review | Provider onboarding, reconciliation process, dispute/chargeback handling |

## Provider-integration dependencies (not yet validated live)

| Risk | Why it matters | Needed to close |
|---|---|---|
| **Interswitch LIVE** | Current `.env` uses test/sandbox values; independent verification, webhook signing and refunds are unproven against the live gateway | Provider go-live, signed-webhook agreement, end-to-end live settlement + refund test |
| **Real SMS gateway** | Phone verification is unavailable in production until a provider is configured (codes are never logged there) | Wire and validate an SMS provider |
| **Real push transport** | Crew dispatch offers currently rely on the notification outbox; there is no Socket.IO/real-time push wired in | Implement/validate a push transport for time-boxed offers |
| **WhatsApp channel** | Adapter exists but fails closed when unconfigured | Configure and validate if the product needs it |
| **Mapbox token / geocoding** | Without a token, geocoding degrades to Nominatim (development only) | Provision a production Mapbox token and validate rate limits/terms |
| **SMTP deliverability** | OTP delivery depends on SMTP reputation; bounces/spam-foldering would break login | Use a reputable transactional email provider; monitor deliverability |
| **Webhook reachability** | The gateway must reach `POST /payments/webhook` over HTTPS with the shared secret | Confirm public URL, TLS and secret agreement with the provider |

## Application-level residual risks

| Risk | Notes |
|---|---|
| **No file-upload surface** | There is no upload handling anywhere; `CrewDocument.fileUrl` is a URL, not an upload. If uploads are added later, re-audit for content-type, size, storage and malware scanning |
| **No global rate limiter** | Limits cover auth/OTP/geocode only; other endpoints rely on auth + upstream protection. Add a global limiter/WAF before public exposure |
| **CSP is helmet's default** | Appropriate for a JSON API; revisit if the same origin ever serves HTML |
| **`user` reference in tests** | A weak `JWT_SECRET` is only a startup warning outside production; ensure production secrets are strong (enforced) |
| **Mock-vs-Postgres drift** | The mock client is hand-written; a query it cannot model could pass tests but fail live. Prefer staging DB tests for new complex queries |
| **Money in integer kobo** | Correct by design; ensure any new amount is also integer kobo and server-computed |

## Explicit statement

Passing the test suite demonstrates that the **logic** is correct and the
**failure scenarios in scope** are handled. It does **not** demonstrate that the
service is safe to run as a real emergency-dispatch system. Before launch,
complete the operational, regulatory and provider-integration items above,
validate against a staging Postgres with live (or provider-sandbox) integrations,
and obtain clinical/regulatory sign-off.
