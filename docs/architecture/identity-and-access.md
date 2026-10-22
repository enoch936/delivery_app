# Identity and access foundation

Phone sign-in uses a time-limited, one-use verification challenge. OTP values and bearer tokens are never logged or stored in clear text. A challenge is HMAC-protected with `AUTH_TOKEN_SECRET`; sessions use an opaque random token whose SHA-256 hash alone is stored in PostgreSQL.

- OTP requests are limited to three per phone number in fifteen minutes.
- A challenge expires after five minutes, locks after five invalid attempts, and can be consumed once.
- The first verified user receives only the `customer` role. Courier, merchant-staff, admin and support roles require their own approved assignment workflow.
- A session lasts 30 days until expiry or explicit revocation. Every verification and revocation creates an audit record.
- `OTP_PROVIDER=development` is allowed only in a development process with a six-digit `OTP_DEVELOPMENT_CODE`; the API never returns or logs it. Staging and production require a real provider adapter and a 32+ character secret.

Endpoints: `POST /v1/auth/otp/request`, `POST /v1/auth/otp/verify`, `GET /v1/auth/me`, and `POST /v1/auth/session/revoke`.
