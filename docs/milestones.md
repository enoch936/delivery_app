# Milestone checklist

| Milestone | Status | Evidence / remaining gate |
| --- | --- | --- |
| 0: discovery and architecture | In progress | Architecture, ADRs, domain model, screen map, threat model and readiness register exist. Provider/cost/legal research and brand clearance remain. |
| 1: project foundation | In progress | Monorepo, API, portals, migrations, Docker Compose, CI and domain tests exist. Docker/Flutter validation remains blocked by local tooling. |
| 2: identity and access | In progress | Database-backed OTP challenges, opaque sessions, customer role assignment, `/api/v1/users/me`, session revocation, audit records, and unit tests are implemented. A real SMS provider, RBAC policy scopes, refresh tokens, and Docker migration verification remain. |
| 3: discovery and catalogue | In progress | Catalog migration, demo seed merchants/products, service categories, merchant/product listing, search, and platform category configuration are implemented. Customer addresses, inventory-aware cart rules, mobile UI, and geospatial zone filtering remain. |
| 4: checkout, orders and pricing | Not started | Authoritative quotes, transactions, idempotency and receipts. |
| 5: courier and dispatch | Not started | Courier onboarding, assignment locking and proof. |
| 6: payments | Not started | Verified provider, webhook, ledger and reconciliation. |
| 7: tracking, chat, notifications | Not started | Location freshness, real-time authorization and reconnect. |
| 8: business/admin tools | Not started | Authorized operational workflows and reports. |
| 9: reliability/security | Not started | Offline sync, resilience, security verification. |
| 10: production release | Not started | Staging, provider approvals, runbooks and acceptance gates. |

The foundation must not be marked complete until actual Docker, build, and CI evidence has been recorded.
