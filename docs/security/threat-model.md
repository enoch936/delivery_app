# Threat model

| Threat | Initial control | Verification required before release |
| --- | --- | --- |
| Account takeover / OTP abuse | Provider abstraction, server-side rate limits, session revocation, no OTP logs | Auth integration and abuse tests |
| IDOR and privilege escalation | Scoped authorization policy, opaque IDs, audit events | Cross-user / merchant / organization tests |
| Payment manipulation or webhook replay | Server recalculation, signature validation, idempotency keys, durable ledger | Provider sandbox and duplicate webhook tests |
| Malicious courier or false proof | Verification status, evidence retention policy, signed proof uploads | Operations policy and proof workflow tests |
| Location spoofing or exposure | Freshness labels, least-privilege location views, server timestamps | Device and authorization tests |
| Insider abuse | Role scope, immutable audit records, export controls | Audit review and admin authorization tests |
| Unsafe upload | Allow-list, size limits, object quarantine, malware scan integration | Storage and scanner tests |
| Secrets exposure | `.env` ignored, CI secrets, redaction policy | Secret scanning and deployment review |

This is a design threat model, not a security certification. Map release evidence to OWASP ASVS/MASVS when mobile and authenticated workflows are implemented.
