# Architecture foundation

**Status:** accepted for Milestones 0–1 on 2026-10-20.
**Working brand:** Kora (not cleared for public use).

## Chosen shape

```text
Customer / Courier mobile (Flutter, planned)
Merchant Web (Next.js) ───────────┐
Admin Web (Next.js) ──────────────┼─> NestJS modular monolith ─> PostgreSQL + PostGIS
                                  │             │
                                  │             └──────────────> Redis / queues / object storage
                                  └── OpenAPI contracts
```

The backend remains a modular monolith. Identity, catalogue, orders, dispatch, payments, notification, support, business, administration, and configuration will have explicit module boundaries and database ownership. They do not become independently deployed services without a measured scaling or isolation reason.

## Version and dependency policy

Node 24.19.0 is present and sits on the Node 24 LTS line. Nest supports Node 24.15+ for its generator and Node 20+ to run an application; Next.js requires Node 20.9+. Direct JavaScript dependencies are installed with exact versions and captured in `package-lock.json`. Docker images use explicit version tags. Flutter is planned with an SDK version to be pinned after it is installed in CI.

## Key choices and trade-offs

| Decision | Reason | Consequence |
| --- | --- | --- |
| NestJS + Fastify | Typed modules, OpenAPI support, low-overhead HTTP adapter | Fastify-specific middleware must be considered carefully. |
| PostgreSQL + PostGIS | Transactions and geospatial service zones are authoritative | Requires managed backups and migration discipline. |
| Redis only for cache/coordination/queues | Orders and balances must remain durable in PostgreSQL | Queue handlers must be idempotent. |
| Integer `bigint` minor units | No floating-point financial balances | Formatting is a presentation concern. |
| Next.js portals | Good web ergonomics with server-side capability | Browsers only use documented APIs, never database credentials. |
| One Flutter codebase, role-separated builds | Shares foundations without conflating permissions | Requires future mobile SDK and device validation. |

Provider integrations are disabled until eligibility, contracts, sandbox credentials, webhook guarantees, costs, privacy conditions, and operational ownership are recorded. See [Ethiopia readiness](../integrations/ethiopia-readiness.md).
