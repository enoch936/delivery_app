# Screen inventory and navigation map

## Customer mobile (implemented)

`Welcome → Phone / OTP → Explore (categories, search, merchants) → Merchant menu → Cart → Checkout (address, quote, payment) → Order confirmation → Orders → Order detail (delivery code, timeline, cancel) → Account`

Account is a hub with dedicated screens:

- Personal information (`PATCH /v1/users/me`, email verification request/verify)
- Saved addresses (list/create/update/delete, default selection)
- Security & sign-in (active sessions, revoke one/others, revoke on sign-out)
- Notifications (push/SMS/email, order updates, promotions, security alerts)
- Privacy & data (marketing/analytics consent, terms/privacy acceptance, export, deletion request/cancel with 30-day grace)
- Preferences (English/Amharic, accessibility: text scale, reduce motion, high contrast, screen-reader hints)
- Help & support, sign out

Session, locale and accessibility settings persist locally (`AppStorage`); accessibility overrides the app-wide `MediaQuery` (text scaling, animations, contrast) and syncs to `user_profiles`. Base URL is supplied with `--dart-define=API_BASE_URL`.

## Courier mobile (implemented)

`Phone / OTP → Registration / review status → Today (availability, offers) → Accept offer → Arrived at merchant → Pickup → In transit → Delivery proof / notes → Earnings → Profile / documents`

Location heartbeats currently send a demo coordinate; device GPS and background tracking are not integrated.

## Merchant portal (implemented)

`Phone / OTP → Overview → Orders (accept/prepare/ready) → Menu & categories → Products / inventory → Locations → Settlements`

## Operations portal (implemented)

`Phone / OTP → Overview → Orders & reports (filters/CSV) → Merchants → Couriers and document review → Users and roles → Configuration → Audit trail`

Exact customer/courier location remains limited to operationally justified roles; map-based dispatch and live tracking screens are not yet built.
