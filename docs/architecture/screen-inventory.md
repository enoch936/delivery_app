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
- Support tickets (history, new ticket, thread with replies)
- Loyalty rewards (balance, tier, points activity, redeemable rewards catalog, redemption)
- Referrals (referral code, copy/share, referral history, expiry handling)

Support tickets: `Help & support (info) → Support tickets (history, new ticket, thread with replies)`. Order-specific help also reaches the support team through the order chat, refund requests and issue reports surfaced in the order detail experience.

Discovery and catalogue coverage: home feed, category browsing, full-text/typed search, typeahead suggestions, recents, merchant + product favorites (`GET|POST|DELETE /v1/favorites[...]`), open-now/favorites/sort filters, personalized recommendations and offers. Loyalty points are awarded to customers when a delivery completes; the redeemable rewards catalog (`loyalty_rewards`) exposes point-priced rewards to the customer, redemption debits the wallet and records a `loyalty_redemptions` row; referrals credit both the referrer and the referred customer and carry a 30-day expiry window (`referral_codes.expires_at`).

Session, locale and accessibility settings persist locally (`AppStorage`); accessibility overrides the app-wide `MediaQuery` (text scaling, animations, contrast) and syncs to `user_profiles`. Base URL is supplied with `--dart-define=API_BASE_URL`.

## Courier mobile (implemented)

`Phone / OTP → Registration / review status → Today (availability, offers) → Accept offer → Arrived at merchant → Pickup → In transit → Delivery proof / notes → Earnings → Profile / documents`

Location heartbeats currently send a demo coordinate; device GPS and background tracking are not integrated.

## Merchant portal (implemented)

`Phone / OTP → Overview → Orders (accept/prepare/ready) → Menu & categories → Products / inventory → Sales & finance → Locations → Settlements`

The Store & business tab adds onboarding status visibility (pending/suspended/closed with operator reasons), store profile (display name/description/logo), contract policies (cancellation/refund), commission (bps) and delivery radius configuration, location open/close plus opening-hours updates, and business verification document upload with operator review status.

## Catalog and menu coverage

Merchant catalog: create/view/edit/archive products, stock and availability, preparation time, category create/edit/archive, bulk import/export, audit records; unavailable products are excluded from customer ordering (`is_available` + stock state); merchant option groups / variants / customisation options with price adjustments and availability toggles.

## Sales, finance and analytics coverage

Merchant Sales tab: sales summary (`GET /v1/merchant/analytics/sales?days=30`) with gross sales, net after commission, refunds, tips, delivery fees and average order value; order health (received/accepted/delivered/cancelled, acceptance rate, average preparation time); commission breakdown with explicit calculation rules; product performance (`GET /v1/merchant/analytics/products?days=30`) with per-product revenue, share and best sellers; merchant ratings/feedback summary (`GET /v1/merchant/reviews`); downloadable sales CSV (`GET /v1/merchant/reports/sales.csv?days=30`). Financial calculations: gross sales = Σ order item subtotal per period (excluding CANCELLED/FAILED/REFUNDED); commission = gross × commissionBps / 10000; net after commission = gross − commission − refunds. Settlement history and ledger entries remain available under Finance.

## Merchant order processing coverage

Merchant order queue: status-filtered list, order detail (items, totals, payment status, courier/handoff, timeline), accept/reject with reason, prepare/ready transitions, order-number search, polling-driven sync and new-order notifications; conflicting transitions are rejected by the backend state machine.

## Operations portal (implemented)

`Phone / OTP → Overview → Orders & reports (filters/CSV) → Merchants (approve/reject/suspend/reactivate, merchant documents review) → Couriers and document review → Users and roles → Configuration → Audit trail`

Exact customer/courier location remains limited to operationally justified roles; map-based dispatch and live tracking screens are not yet built.
