# delivery_app

delivery_app is a configuration-first, multi-service delivery platform foundation for Ethiopia. It starts with ETB, an Ethiopian launch configuration, and English UI copy while keeping cities, zones, fees, languages, providers, and service categories configurable.

## What is in this repository

- A TypeScript modular-monolith API foundation with safe configuration, versioned APIs, health endpoints, OpenAPI, request IDs, graceful shutdown, and strict validation.
- A tested money and order-lifecycle domain package. It uses integer minor units and blocks invalid status transitions.
- Responsive Next.js foundations for merchant and operations users, using the shared visual language but intentionally not claiming live operational data.
- PostgreSQL/PostGIS/Redis local dependency configuration, an initial configuration-and-identity migration, and a synthetic seed configuration.
- Architecture decisions, an initial domain model, security threat model, screen inventory, runbooks, release gates, and GitHub governance documents.

This is the start of Milestones 0–1, not a production release. Checkout, payments, live GPS, external OTP, and real provider integrations have not been enabled.

## Requirements

- Node.js 24.11+ (this workspace was initialized with 24.19.0)
- npm 11+
- Docker Desktop for PostgreSQL/PostGIS and Redis
- Flutter SDK for the planned mobile targets (not installed in the current workspace)

## Quick start

1. Copy `.env.example` to `.env` and use only local development values.
2. Install the locked dependencies: `npm ci`.
3. Start PostgreSQL/PostGIS and Redis: `docker compose up -d`.
4. Apply the migration: `npm run db:migrate`.
5. Seed synthetic configuration: `npm run db:seed`.
6. In separate terminals run `npm run dev:api`, `npm run dev:merchant`, and `npm run dev:admin`.

The API exposes `GET /health/live`, `GET /health/ready`, and OpenAPI at `/docs`. Merchant and admin foundations run on ports 3001 and 3002 respectively.

## Quality commands

```text
npm run typecheck
npm test
npm run build
```

Read [local development](docs/operations/local-development.md), [architecture](docs/architecture/0001-foundation.md), and [milestone status](docs/milestones.md) before adding a feature.
