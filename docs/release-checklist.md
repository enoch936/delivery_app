# Release gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Fresh installation and migrations | PARTIAL | The repository contains migrations `0001`–`0011` and both demo seeds. The last recorded fresh PostGIS verification covered `0001`–`0008`, and the hosted Neon record covered `0001`–`0009`; `0010_multi_party_finance.sql` and `0011_identity_email.sql` must be applied and verified before the current finance source is released. CI applies the complete migration/seed glob on every push; a completed CI/staging fresh-install record remains pending. |
| Customer, merchant, courier and admin workflows | PARTIAL | Sandbox flows exist in the customer/courier apps, merchant portal and operations console; API/web/Flutter static checks pass. Android customer and courier login, device-token registration and FCM delivery were verified on a physical device. Full end-to-end tests against a migrated database still have not run. |
| Payment / refund reconciliation | PARTIAL | Stripe test checkout was verified end-to-end in the demo deployment: hosted checkout completed, signed webhook accepted, payment `SUCCEEDED`, order `CONFIRMED`/`PAID`. Ledger postings, refund review, provider status reconciliation, webhook replay, and merchant/courier settlement batches with paid-ledger postings now exist. Chapa/Telebirr credentials, provider settlement-file matching, and finance sign-off remain pending. |
| Authorization and isolation tests | PASS (suite shipped) | Session/role guards are implemented and covered by the automated cross-tenant/role integration suite in `services/api/test/api.authorization.integration.test.ts` (customer order isolation, cross-role operation rejection, business tenant scoping); the suite is wired into the CI database-integration job via `npm test`. A green run against a freshly migrated database is the release evidence still being collected. |
| Security assessment | BLOCKED | Design threat model exists; no completed assessment or penetration test. |
| Monitoring, backups and restore | BLOCKED | Runbook foundation exists; managed environment not selected. |
| Mobile signing and store release | BLOCKED | Flutter apps build/analyze/test locally; signing, store metadata and release pipelines are not configured. |

No production readiness claim is permitted while any gate is FAIL or BLOCKED.
