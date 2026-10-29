# delivery_app

delivery_app is a configuration-first, multi-service delivery platform foundation for Ethiopia. It starts with ETB, an Ethiopian launch configuration, and English UI copy while keeping cities, zones, fees, languages, providers, and service categories configurable.

## What is in this repository

- A TypeScript modular-monolith API using NestJS/Fastify, PostgreSQL/PostGIS, opaque OTP sessions, versioned routes under `/api/v1`, OpenAPI, request IDs, strict validation, audit records, and graceful shutdown.
- A tested money and order-lifecycle domain package using integer minor units and explicit status transitions.
- Customer and courier Flutter apps (customer checkout, orders and support; courier onboarding, offers, delivery transitions and earnings).
- Merchant and operations Next.js portals for store operations, catalog/inventory, settlements, payments, dispatch, courier review, configuration and reports.
- PostgreSQL/PostGIS migrations `0001`–`0010`, demo catalog/config seeds, Docker Compose for local dependencies, and CI for API, web builds, migrations and Flutter checks.
- Architecture decisions, domain model, security threat model, screen inventory, runbooks, release gates, and GitHub governance documents.

Stripe card checkout and refunds run against Stripe test mode, and FCM push notifications are active for registered devices. Telebirr H5 checkout, refunds, status reconciliation, and signed webhook verification are implemented but disabled until a registered merchant public key is supplied. External SMS, Chapa, maps, and object-storage providers are still inactive. This is not a production release; see [release gates](docs/release-checklist.md).

## Requirements

- Node.js 24.11+ (this workspace was initialized with 24.19.0) and npm 11+
- Docker Desktop for PostgreSQL/PostGIS and Redis
- Flutter 3.47.7 / Dart 3.13+ for the mobile apps

## Quick start

1. Copy `.env.example` to `.env` and use only local development values.
2. Install the locked dependencies: `npm ci`.
3. Start PostgreSQL/PostGIS and Redis: `docker compose up -d`.
4. Apply migrations and seeds: `npm run db:migrate` then `npm run db:seed`.
5. Run the API and portals in separate terminals: `npm run dev:api`, `npm run dev:merchant`, `npm run dev:admin`.
6. Run mobile apps with the API URL for your target, for example:
   `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api` from `apps/customer-mobile` or `apps/courier-mobile`.

The API exposes `GET /api/health/live`, `GET /api/health/ready`, versioned routes under `/api/v1`, and OpenAPI at `/docs`. Merchant and admin portals run on ports 3001 and 3002.

For local OTP, set `OTP_PROVIDER=development` and `OTP_DEVELOPMENT_CODE=123456` in `.env`. For Stripe test checkout, set `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. For Telebirr, set `PAYMENTS_PROVIDER=telebirr` and the `TELEBIRR_*` variables documented in `.env.example`; `TELEBIRR_PUBLIC_KEY` is required for webhook verification. The development OTP provider is restricted to `NODE_ENV=development`.

## Deployment

The demo deployment uses Neon PostgreSQL, Render for the API, and Vercel for the merchant/admin portals:

- API: https://delivery-app-api-v2i0.onrender.com
- Merchant portal: https://delivery-merchant-azure.vercel.app
- Admin portal: https://delivery-admin-kappa.vercel.app

Run `DATABASE_URL=... npm run db:migrate:remote` and `DATABASE_URL=... npm run db:seed:remote` once against a new Neon branch, then set the API URL as `NEXT_PUBLIC_API_BASE_URL` on both Vercel projects. Existing environments must apply every migration through `0010_multi_party_finance.sql` before deploying source that uses the multi-party finance features. The Stripe webhook endpoint must point to `https://<api-host>/api/v1/payments/webhooks/stripe`. This demo uses the development OTP code and is not production-ready.

## Quality commands

```text
npm run typecheck
npm test
npm run build
```

Mobile checks, from each app directory: `flutter analyze` and `flutter test`.

Read [local development](docs/operations/local-development.md), [architecture](docs/architecture/0001-foundation.md), and [milestone status](docs/milestones.md) before adding a feature.
