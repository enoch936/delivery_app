# Deployment

The current demo topology is Neon PostgreSQL, a Render web service for the API, and two Vercel projects for the merchant and admin portals. This is not a production release.

## Database

Create a Neon project/branch, then apply schema and demo data from the repository root:

```text
DATABASE_URL="postgresql://..." npm run db:migrate:remote
DATABASE_URL="postgresql://..." npm run db:seed:remote
```

Use the direct (non-pooled) Neon host for migrations and seeds. Use the pooled host in the API's `DATABASE_URL`.

## API on Render

- Build command: `npm ci --include=dev && npm run build --workspace @delivery-app/api`
- Start command: `npm run start --workspace @delivery-app/api`
- Health check: `/api/health/ready`
- Runtime: Node 24

Required environment variables:

```text
NODE_ENV=development
OTP_PROVIDER=development
OTP_DEVELOPMENT_CODE=123456
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
AUTH_TOKEN_SECRET=<at-least-32-random-characters>
PAYMENTS_PROVIDER=stripe
STRIPE_SECRET_KEY=rk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYMENT_RETURN_URL=https://<api-host>/docs
PAYMENT_CANCEL_URL=https://<api-host>/docs
PUBLIC_API_BASE_URL=https://<api-host>
API_CORS_ORIGINS=https://<merchant-host>,https://<admin-host>
PUSH_PROVIDER=fcm
FIREBASE_SERVICE_ACCOUNT_JSON=<single-line service-account JSON>
```

`NODE_ENV=development` is intentionally used for the demo because no production SMS/OTP provider is integrated. Do not treat this deployment as production-ready.

Register a Stripe webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Store its signing secret in `STRIPE_WEBHOOK_SECRET`.

## Portals on Vercel

Create one project per app with `apps/merchant-web` and `apps/admin-web` as the project root directories. Set `NEXT_PUBLIC_API_BASE_URL=https://<api-host>/api` for the Production environment before building.
