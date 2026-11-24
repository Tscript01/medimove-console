# 5. Database Migration Instructions

The project uses **Prisma 7** with the `prisma-client` generator and the
`@prisma/adapter-pg` driver adapter. Migrations are plain SQL under
`prisma/migrations/`, applied by `prisma migrate deploy`.

## Prerequisites

1. `DATABASE_URL` set in `.env` (a managed Postgres URL; append
   `?sslmode=no-verify` for providers with a private CA such as Aiven).
2. `npm install` (runs `prisma generate` via `postinstall`).

> **`prisma migrate dev` is not available here.** It requires a shadow database
> that the managed instance does not grant. New migrations are generated with
> `migrate diff` instead (below), and `migrate deploy` applies them.

## Apply migrations (normal path)

```bash
# Inspect what is pending, then apply.
npx prisma migrate status
npx prisma migrate deploy
```

`migrate deploy` is idempotent: already-applied migrations are skipped. It never
resets data.

## Create a new migration (no shadow DB)

1. Edit `prisma/schema.prisma`.
2. Generate the SQL by diffing the live datasource against the schema:

   ```bash
   npx prisma migrate diff \
     --from-config-datasource \
     --to-schema prisma/schema.prisma \
     --script \
     -o prisma/migrations/<timestamp>_<name>/migration.sql
   ```

   Use a UTC timestamp prefix (`YYYYMMDDHHMMSS`) matching the existing
   convention, e.g. `20261118130000_platform_administration_and_audit`.
3. **Always read the generated `migration.sql` before applying it.** Check for
   destructive statements (`DROP COLUMN`, `DROP TABLE`, type narrowing) and
   confirm defaults/backfills for new `NOT NULL` columns. Prisma will not warn
   about data loss here.
4. Apply it:

   ```bash
   npx prisma migrate deploy
   ```
5. Regenerate the client so TypeScript sees the new models:

   ```bash
   npx prisma generate
   ```
6. Run the checks:

   ```bash
   npx tsc --noEmit
   npx tsc -p tsconfig.test.json
   npx vitest run
   npm run build
   ```

> The generator output (`src/generated/prisma`) is committed/consumed by the
> build (`npm run build` copies it into `dist/`). Regenerate after any schema
> change.

## Legacy / ad-hoc sync

- `npm run db:push` (`prisma db push`) syncs the schema without creating a
  migration. Use it only for throwaway/local databases, never for production.
- `npm run db:seed` runs `prisma/seed.ts`. **The database is currently not
  seeded** — see [PRODUCTION_RISKS.md](./PRODUCTION_RISKS.md).

## Rollback strategy

Prisma has no automatic down-migrations. To revert:

1. Write a **new** forward migration that undoes the change (preferred), or
2. restore the database from a pre-deploy backup.

Because audit, consent, payment-event, status-history and notification-event
tables are append-only, prefer additive migrations and forward fixes; do not
delete history. Take a snapshot before applying any migration that drops or
narrows a column.

## Conventions used in this project

- Integer money is stored in **kobo**; migrations never introduce floats for
  money.
- New columns on populated tables are added nullable or with a default.
- Every scoping column added (`stateId`, `providerId`, `hospitalId`, `userId`)
  ships with an index in the same migration.
- Unique constraints are used to encode invariants (idempotency keys, dedupe
  keys, `(bookingId, userId)` feedback, `(bookingId, crewProfileId, round)`
  offers).

## Current state

- **20 migrations applied.** The full list and what each adds is in
  [DATABASE.md](./DATABASE.md#migration-history).
- Verify with `npx prisma migrate status` (expect "Database schema is up to
  date!").
