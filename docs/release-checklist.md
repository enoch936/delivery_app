# Release gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Fresh installation and migrations | BLOCKED | Docker is not installed in the current workspace. |
| Customer, merchant, courier and admin workflows | FAIL | Only foundation routes and domain rules exist. |
| Payment / refund reconciliation | BLOCKED | Provider selection and approval pending. |
| Authorization and isolation tests | FAIL | Identity module not yet implemented. |
| Security assessment | BLOCKED | Design threat model exists; no completed assessment. |
| Monitoring, backups and restore | BLOCKED | Runbook foundation exists; managed environment not selected. |
| Mobile signing and store release | BLOCKED | Flutter and signing workflows not configured. |

No production readiness claim is permitted while any gate is FAIL or BLOCKED.
