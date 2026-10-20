# Local development and recovery

## Start locally

1. Copy `.env.example` to `.env`; never add a real credential to source control.
2. Run `npm ci`.
3. Run `docker compose up -d`, then `npm run db:migrate` and `npm run db:seed`.
4. Run the API and web applications as described in the root README.

## Backup and restore (development)

Create an encrypted production backup through the managed database provider. For local diagnostics only, use `pg_dump` against the container and restore into a non-production database. Verify a restore with migration compatibility and synthetic fixtures; never restore production personal data to a developer machine.

## Incident and rollback principles

1. Triage customer safety, financial correctness and data exposure first.
2. Preserve request IDs, audit records, traces and provider evidence.
3. Stop or feature-flag harmful traffic before rolling back.
4. Roll back application artifacts only after confirming migration compatibility; do not blindly reverse data migrations.
5. Reconcile payments, assignments and customer communications after containment.

Production runbooks, backup ownership, on-call rotation and recovery objectives are still required before release.
