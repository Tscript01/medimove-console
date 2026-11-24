# MediMove Backend — Documentation

Stage 16 deliverables for the MediMove ambulance-dispatch backend. Each document
is self-contained; start here.

| # | Document | Covers |
|---|---|---|
| 1 | [Architecture](./ARCHITECTURE.md) | Layers, request lifecycle, module map, cross-cutting concerns, runtime topology |
| 2 | [Database](./DATABASE.md) | Models, relationships, constraints, indexes, state machines, migration history |
| 3 | [API](./API.md) | Conventions (auth, errors, pagination, idempotency, scoping) + every endpoint |
| 4 | [Environment](./ENVIRONMENT.md) | Every environment variable, defaults and production rules |
| 5 | [Migrations](./MIGRATIONS.md) | How schema changes are produced and applied (Prisma 7, no shadow DB) |
| 6 | [Test report](./TEST_REPORT.md) | Suites, counts, failure-scenario matrix, gaps |
| 7 | [Deployment](./DEPLOYMENT.md) | Pre-flight, secrets, database, proxy/TLS, monitoring, rollback |
| 8 | [Production risks](./PRODUCTION_RISKS.md) | Operational, regulatory and provider-integration dependencies still needing real-world validation |
| 9 | [AI frontend handoff](./AI_FRONTEND_HANDOFF.md) | Copy/paste prompts and full product/API brief for generating the admin panel and every user-type UI |

> **Read this first:** passing tests do **not** make MediMove production-ready.
> See [PRODUCTION_RISKS.md](./PRODUCTION_RISKS.md) for the dependencies that only
> real-world validation (a staging environment, real providers, legal review and
> regulator engagement) can close.

## Interactive API documentation

The API ships a machine-readable **OpenAPI 3.1** contract:

- **Swagger UI** at `GET /api/docs` (interactive, bearer-token aware) — on by
  default outside production, off in production unless `API_DOCS_ENABLED=true`.
- **Raw spec** at `GET /api/docs/openapi.json`.
- **YAML** at [`openapi.yaml`](./openapi.yaml) — import into Swagger Editor,
  Postman, Insomnia, Redoc or any code generator.
- Regenerate both with `npm run docs:openapi` after editing [API.md](./API.md).

The high-level product/feature narrative lives in the top-level
[`README.md`](../README.md); these documents are the operational and technical
reference.
