# Release gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Fresh installation and migrations | PARTIAL | A fresh PostGIS 16 container accepted all `0001`–`0008` migrations and both demo seeds without errors, and the API readiness check passes against both local and Neon databases. CI uses the same migration/seed glob; a completed CI/staging fresh-install record remains pending. |
| Customer, merchant, courier and admin workflows | PARTIAL | Sandbox flows exist in the customer/courier apps, merchant portal and operations console; API/web/Flutter static checks pass. Android customer and courier login, device-token registration and FCM delivery were verified on a physical device. Full end-to-end tests against a migrated database still have not run. |
| Payment / refund reconciliation | BLOCKED | Stripe test checkout was verified end-to-end in the demo deployment: hosted checkout completed, signed webhook accepted, payment `SUCCEEDED`, order `CONFIRMED`/`PAID`. Ledger postings and refund review exist. Provider settlement and operational reconciliation sign-off remain pending. |
| Authorization and isolation tests | FAIL | Session/role guards are implemented and role checks are code-reviewed; no automated cross-tenant/role integration test suite exists. |
| Security assessment | BLOCKED | Design threat model exists; no completed assessment or penetration test. |
| Monitoring, backups and restore | BLOCKED | Runbook foundation exists; managed environment not selected. |
| Mobile signing and store release | BLOCKED | Flutter apps build/analyze/test locally; signing, store metadata and release pipelines are not configured. |

No production readiness claim is permitted while any gate is FAIL or BLOCKED.
