# Screen inventory and navigation map

## Customer mobile (implemented)

`Phone / OTP → Explore (categories, search, merchants) → Merchant menu → Cart → Checkout (address, quote, payment) → Order confirmation → Orders → Order detail (delivery code, timeline, cancel) → Profile`

Session is held in memory (no persistence yet). Base URL is supplied with `--dart-define=API_BASE_URL`.

## Courier mobile (implemented)

`Phone / OTP → Registration / review status → Today (availability, offers) → Accept offer → Arrived at merchant → Pickup → In transit → Delivery proof / notes → Earnings → Profile / documents`

Location heartbeats currently send a demo coordinate; device GPS and background tracking are not integrated.

## Merchant portal (implemented)

`Phone / OTP → Overview → Orders (accept/prepare/ready) → Menu & categories → Products / inventory → Locations → Settlements`

## Operations portal (implemented)

`Phone / OTP → Overview → Orders & reports (filters/CSV) → Merchants → Couriers and document review → Users and roles → Configuration → Audit trail`

Exact customer/courier location remains limited to operationally justified roles; map-based dispatch and live tracking screens are not yet built.
