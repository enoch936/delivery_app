# Ethiopia integration readiness

No external provider is active. The following are explicit blockers, not implied support:

| Area | Current state | Required before activation |
| --- | --- | --- |
| Payments (including Chapa / Telebirr) | Telebirr H5 integration implemented but not verified against a registered merchant | Registered merchant key/public key, current eligibility, legal entity/account, fees, sandbox verification, settlement rules and finance sign-off |
| OTP / SMS | Not verified or integrated | Ethiopian delivery coverage, sender registration, pricing, consent, abuse limits, delivery evidence |
| Maps / routing | Not verified or integrated | Ethiopia coverage, pricing, SDK terms, offline behavior, geocoding and location privacy review |
| Push notification | Not integrated | Firebase project, Android/iOS credentials, permission copy, delivery monitoring |
| Hosting / storage | Not selected | Data residency, regional latency, encryption, backup/restore, cost and support assessment |

ETB is the configured default currency. Financial implementation uses minor units but display-decimal and tax rules require finance and legal review before activation.
