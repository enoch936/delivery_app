# Deployment

The current demo topology is Neon PostgreSQL, a Render web service for the API, and two Vercel projects for the merchant and admin portals. This is not a production release.

## Database

Create a Neon project/branch, then apply schema and demo data from the repository root:

```text
DATABASE_URL="postgresql://..." npm run db:migrate:remote
DATABASE_URL="postgresql://..." npm run db:seed:remote
```

Use the direct (non-pooled) Neon host for migrations and seeds. Use the pooled host in the API's `DATABASE_URL`.

## Current demo deployment

| Component | URL |
| --- | --- |
| API | https://delivery-app-api-v2i0.onrender.com |
| API health | https://delivery-app-api-v2i0.onrender.com/api/health/ready |
| Merchant portal | https://delivery-merchant-azure.vercel.app |
| Admin portal | https://delivery-admin-kappa.vercel.app |

Neon migrations `0001`–`0009` and both demo seeds are applied to the `production` branch. Stripe test checkout was verified end-to-end against this deployment: the hosted checkout completed, the signed webhook was accepted, the payment became `SUCCEEDED`, and the order became `CONFIRMED`/`PAID`.

## Finance operations

- `POST /v1/admin/reconciliation/payments/run` asks Chapa/Stripe for the status of pending payments older than two minutes. Amount mismatches and provider errors are reported, not auto-applied.
- `GET /v1/admin/reconciliation/summary` reports pending payments, failed/invalid webhooks, payment/order drift and open settlements.
- Failed, signature-valid webhook events can be replayed from the admin **Reconciliation** tab.
- Merchant settlements and courier payouts are generated from delivered, paid orders in a date window. Each order can enter at most one batch; a pending batch can be topped up by rerunning the same window.
- Batches move `PENDING → APPROVED → PAID` (or `FAILED`). Marking paid requires a payment reference and posts the payable release against `platform_bank` in the ledger.
- Cash orders are excluded until a cash-collection workflow exists, and partial-refund treatment in settlements is still a finance policy decision.

Demo login: phone `+251918184887`, OTP `123456`. This account has customer, merchant-staff and admin roles plus owner membership in both seeded merchants so all three clients can be exercised. OTP requests are rate-limited; use the development code and wait if the limit is reached. Both Vercel portals were loaded in a browser against the deployed API with this session and rendered their live merchant/admin data.

## API on Render

- Build command: `npm ci --include=dev && npm run build --workspace @delivery-app/domain --workspace @delivery-app/validation --workspace @delivery-app/api-contracts && npm run build --workspace @delivery-app/api`
- Start command: `npm run start --workspace @delivery-app/api`
- Health check: `/api/health/ready`
- Runtime: Node 24

Required environment variables:

```text
NODE_ENV=development
OTP_PROVIDER=development
OTP_DEVELOPMENT_CODE=123456
OTP_REQUEST_LIMIT=100
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
