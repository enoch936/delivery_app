# Geospatial system audit and implementation plan

Date: 2026-11-04
Scope: `C:\delvery_app` (existing repository, updated in place)

This audit records what already exists before the geospatial upgrade. It is the
baseline for the incremental implementation; no functional code was replaced.

## 1. Existing architecture (verified)

| Area | Current implementation | Location |
| --- | --- | --- |
| API | NestJS 12 + Fastify, global `/api` prefix, `/api/v1` controllers, Swagger in non-production | `services/api/src` |
| Auth | Opaque bearer sessions, refresh rotation, OTP challenges, role assignments | `services/api/src/modules/auth` |
| RBAC | `SessionGuard`, `RolesGuard`, `@Roles()` decorator, subroles `operations`, `support`, `finance` | `services/api/src/modules/auth` |
| Data | PostgreSQL + PostGIS 16/3.4, `geometry(Point,4326)`, GiST indexes, service zones | `infrastructure/postgres/migrations` |
| Real-time | Order-scoped WebSocket at `/api/v1/tracking/:orderId/ws`, bearer handshake, 3 s refresh, ping/pong, dedupe | `services/api/src/modules/tracking/tracking.gateway.ts` |
| GPS ingest | `POST /api/v1/courier/location`, idempotency key, sample history, availability state | `services/api/src/modules/courier` |
| Mobile GPS | Background geolocation, foreground service, offline queue, operation IDs, reconnection flush | `apps/courier-mobile` |
| Customer map | `flutter_map` with self-drawn route polyline and pickup/courier/destination markers | `apps/customer-mobile/lib/orders/order_experience.dart` |
| Admin live ops | Snapshot of active orders, unassigned orders, couriers, exceptions (list/table UI, no map) | `services/api/src/modules/operator` |
| Geocoding | Nominatim adapter with a fabricated Addis Ababa fallback result | `services/api/src/modules/geocoding` |
| Zones | PostGIS polygon service zones, create/update/check APIs | `services/api/src/modules/zones` |
| Cache | Redis container declared in compose, not used by the API | `docker-compose.yml` |
| Maps config | `MAPS_PROVIDER` flag exists but is not consumed | `services/api/src/config/runtime-config.ts` |

## 2. Findings by category

### Already implemented and working

- Secure, revocable sessions and server-side role checks on HTTP routes.
- Order-scoped tracking authorization (customer, assigned courier, merchant
  member, operations/admin/support) and authenticated WebSocket upgrades.
- Courier GPS validation (lat/lon bounds, accuracy/heading/speed fields),
  idempotency, offline buffering and reconnection.
- PostGIS zones and spatial indexes; GiST index on courier locations.
- ETA calculation with distance, prep buffers, uncertainty and staleness.
- Flutter customer tracking UI with live polling and route polyline.

### Implemented but incomplete

- Tracking is only order-scoped. There is no participant directory or
  nationwide visibility API, so the role visibility matrix is only partially
  enforceable.
- Dashboard has live snapshots but no map rendering.
- `MAPS_PROVIDER` is read but unused; no map style, routing, tile or building
  endpoints exist.
- GPS samples are persisted but courier availability does not retain accuracy,
  heading or speed for live consumers.
- Redis is deployed but the API writes every accepted sample directly to
  PostgreSQL and broadcasts by polling.

### Implemented but inefficient

- `TrackingService.track` runs two correlated subqueries for the latest
  heading/speed on every poll for every viewer.
- The WebSocket re-runs the full order snapshot every 3 seconds per connection.
- `operator/live` returns all active couriers (up to 300) without viewport or
  spatial filtering.
- No location retention or partitioning strategy for `courier_location_samples`.
- Public Next.js portals do not use map virtualization because they have no map.

### Missing

- Self-hosted vector tiles (Planetiler/Martin), satellite COG serving (TiTiler),
  Valhalla routing, self-hosted Nominatim deployment.
- Unified building footprint model, deduplication, delivery access points.
- Map style generation (`standard`, `satellite`, `hybrid`), map config endpoint.
- Route, matrix and map-match APIs; delivery route API; route caching.
- Participant visibility matrix, realtime participant channel.
- Offline map region registry and download management.
- Python/OR-Tools dispatch optimization service.
- Geospatial, routing and privacy automated tests.
- Performance benchmarks for tiles, routes and tracking.

### Conflicting with the target architecture

- Customer app uses `https://tile.openstreetmap.org/...` directly. This must be
  replaced with self-hosted tiles and viewport/zoom limits.
- Courier app launches `https://www.google.com/maps/...` for navigation. This
  introduces a Google Maps dependency and must be replaced with in-app routing.
- Geocoding returns a fabricated "Addis Ababa" result when Nominatim is off or
  fails. Fabricated addresses violate the project rules and are removed.
- No Google Maps API is used elsewhere, which must remain true.

### Security and privacy risks

- No endpoint exposes unrelated participants today (good), but there is also no
  participant API with an explicit matrix, so the intended matrix cannot be
  audited or tested.
- History access is order-scoped only; there is no retention policy that limits
  historical location exposure.
- WebSocket handshakes accept only the `Authorization` header, so browser
  clients cannot subscribe without a server proxy. The new gateway must
  explicitly authenticate and authorize each subscription.
- Rate limiting exists (`RateLimitGuard`) but is not registered globally.

### Performance risks

- PostgreSQL write amplification from every accepted GPS position.
- Repeated route calculations and no route response cache.
- No Redis latest-position cache, so live reads hit PostgreSQL.
- Public tile usage would violate OSM policy at production scale.

## 3. Implementation approach

Work is incremental and backwards compatible:

1. Additive PostGIS migration `0031_geospatial_intelligence.sql` for buildings,
   delivery access points, geocode/route caches, location metadata and retention
   indexes. No destructive column changes.
2. Extend runtime configuration with self-hosted map, routing, geocoding,
   imagery and Redis endpoints. Existing variables keep their defaults.
3. Add `maps` module (config, styles, routing, geocoding, buildings, nearby)
   without removing the existing `geocoding` module.
4. Add Redis latest-position store with graceful PostgreSQL fallback.
5. Add role-scoped participant tracking endpoints and an authenticated realtime
   gateway. Authorization remains in NestJS, never in clients.
6. Add optional geo Docker Compose profile (Martin/Planetiler, Valhalla,
   Nominatim, TiTiler) and acquisition/generation scripts.
7. Add MapLibre GL JS maps to the admin and merchant portals, driven by the map
   config and participant APIs.
8. Update Flutter apps to use self-hosted tiles, in-app navigation and route
   arrows; remove Google Maps and public OSM tile URLs.
9. Add tests for style generation, route decoding, visibility policy and
   geocoding behavior; run typecheck, API tests and web builds.

## 4. Out of scope for this increment (tracked)

- Full nationwide Planetiler/Valhalla/Nominatim data builds (scripts provided,
  data is not downloaded in the repository).
- Google Open Buildings ingestion requiring a BigQuery account.
- On-device offline routing graph (offline tile viewing will be supported via
  the region registry; offline turn-by-turn is explicitly separate).
- OR-Tools service deployment (API contracts preserved as a follow-up).
