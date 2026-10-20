# Milestone checklist

| Milestone | Status | Evidence / remaining gate |
| --- | --- | --- |
| 0: discovery and architecture | In progress | Architecture, ADRs, domain model, screen map, threat model and readiness register exist. Provider/cost/legal research and brand clearance remain. |
| 1: project foundation | In progress | Monorepo, API, portals, migrations, Docker Compose, CI and domain tests exist. Docker/Flutter validation remains blocked by local tooling. |
| 2: identity and access | Not started | OTP provider, sessions, policies, audit enforcement and tests. |
| 3: discovery and catalogue | Not started | Persisted merchant catalogue and search. |
| 4: checkout, orders and pricing | Not started | Authoritative quotes, transactions, idempotency and receipts. |
| 5: courier and dispatch | Not started | Courier onboarding, assignment locking and proof. |
| 6: payments | Not started | Verified provider, webhook, ledger and reconciliation. |
| 7: tracking, chat, notifications | Not started | Location freshness, real-time authorization and reconnect. |
| 8: business/admin tools | Not started | Authorized operational workflows and reports. |
| 9: reliability/security | Not started | Offline sync, resilience, security verification. |
| 10: production release | Not started | Staging, provider approvals, runbooks and acceptance gates. |

The foundation must not be marked complete until actual Docker, build, and CI evidence has been recorded.
