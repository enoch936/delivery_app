# Local development and recovery

## Start locally

1. Copy `.env.example` to `.env`; never add a real credential to source control.
2. Run `npm ci`.
3. Run `docker compose up -d`, then `npm run db:migrate` and `npm run db:seed`.
4. Run the API and web applications as described in the root README.

## Database-backed integration check

The API integration test applies the real HTTP pipeline against PostgreSQL/PostGIS. It skips automatically when `DATABASE_URL` is not set.

PowerShell example (after Docker, migrations and seeds):

```powershell
$env:DATABASE_URL = "postgresql://delivery_app:delivery_app@localhost:5432/delivery_app"
$env:NODE_ENV = "development"
$env:OTP_PROVIDER = "development"
$env:OTP_DEVELOPMENT_CODE = "123456"
$env:AUTH_TOKEN_SECRET = "local-integration-secret-at-least-32-characters"
npm test --workspace @delivery-app/api
```

The suite verifies health/readiness, seeded discovery and search, OTP request/verify, bearer session, refresh rotation, logout revocation, and unauthenticated admin rejection. CI runs the same test after applying all migrations and seeds.

## Backup and restore (development)

Create an encrypted production backup through the managed database provider. For local diagnostics only, use `pg_dump` against the container and restore into a non-production database. Verify a restore with migration compatibility and synthetic fixtures; never restore production personal data to a developer machine.

## Incident and rollback principles

1. Triage customer safety, financial correctness and data exposure first.
2. Preserve request IDs, audit records, traces and provider evidence.
3. Stop or feature-flag harmful traffic before rolling back.
4. Roll back application artifacts only after confirming migration compatibility; do not blindly reverse data migrations.
5. Reconcile payments, assignments and customer communications after containment.

Production runbooks, backup ownership, on-call rotation and recovery objectives are still required before release.
