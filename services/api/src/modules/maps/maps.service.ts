import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";
import { RedisService } from "../../redis/redis.service.js";
import { GeocodingService } from "../geocoding/geocoding.service.js";
import { buildMapStyle } from "./map-style.service.js";
import type { GeoPoint, MapStyleName, RouteProfile, RouteResult } from "./maps.types.js";
import { decodePolyline } from "./polyline.js";

type Viewer = Readonly<{ userId: string; roles: readonly string[] }>;

type ValhallaLocation = Readonly<{ lat: number; lon: number }>;

type TripLeg = Readonly<{
  shape?: string;
  summary?: Readonly<{ length?: number; time?: number }>;
  maneuvers?: readonly Readonly<{
    instruction?: string;
    verbal_pre_transition_instruction?: string;
    type?: number;
    street_names?: readonly string[];
    length?: number;
    time?: number;
    begin_shape_index?: number;
    end_shape_index?: number;
    roundabout_exit_count?: number;
  }>[];
}>;

type Trip = Readonly<{
  summary?: Readonly<{ length?: number; time?: number }>;
  legs?: readonly TripLeg[];
}>;

type ValhallaRoutePayload = Readonly<{ trip?: Trip; alternates?: readonly Readonly<{ trip?: Trip }>[] }>;

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly geocoding: GeocodingService
  ) {}

  config() {
    const config = readRuntimeConfig();
    return {
      defaultStyle: config.mapDefaultStyle,
      styles: [
        { id: "standard", label: "Standard" },
        { id: "hybrid", label: "Hybrid" },
        { id: "satellite", label: "Satellite" }
      ],
      styleUrls: {
        standard: "/api/v1/maps/styles/standard/style.json",
        hybrid: "/api/v1/maps/styles/hybrid/style.json",
        satellite: "/api/v1/maps/styles/satellite/style.json"
      },
      tiles: {
        url: config.mapTileServerUrl,
        tileset: config.mapTileSet,
        template: `${config.mapTileServerUrl}/${config.mapTileSet}/{z}/{x}/{y}`,
        attribution: config.mapAttribution
      },
      satellite: {
        enabled: Boolean(config.mapSatelliteTileUrl),
        source: config.mapSatelliteTileUrl ? "self-hosted COG (Sentinel-2 / Landsat)" : null,
        maxNativeResolutionMeters: config.mapSatelliteTileUrl ? 10 : null,
        note: config.mapSatelliteTileUrl
          ? "Satellite imagery is rendered from self-hosted cloud-optimized GeoTIFFs. It is not street-level imagery."
          : "No satellite imagery source is configured."
      },
      routing: { provider: "valhalla", available: true, profiles: ["auto", "motorcycle", "pedestrian", "bicycle"] },
      geocoding: { provider: config.geocodingProvider, countryCode: config.launchCountryCode },
      tracking: {
        activeIntervalSeconds: config.trackingActiveIntervalSeconds,
        idleIntervalSeconds: config.trackingIdleIntervalSeconds,
        locationTtlSeconds: config.trackingLocationTtlSeconds,
        historyRetentionDays: config.trackingHistoryRetentionDays
      }
    };
  }

  style(name: string) {
    if (name !== "standard" && name !== "satellite" && name !== "hybrid") {
      throw new NotFoundException("Unknown map style.");
    }
    return readStyle(name);
  }

  async route(input: Readonly<{
    locations: readonly GeoPoint[];
    profile: RouteProfile;
    alternates: number;
    language: string;
  }>): Promise<RouteResult> {
    if (input.locations.length < 2) throw new BadRequestException("At least two locations are required.");
    const body: Record<string, unknown> = {
      locations: input.locations.map((point) => ({ lat: point.latitude, lon: point.longitude })),
      costing: input.profile,
      directions_options: { units: "kilometers", language: input.language }
    };
    if (input.alternates > 0) body.alternates = Math.min(input.alternates, 2);
    const cacheKey = routeCacheKey("route", input.profile, body);
    const cached = await this.redis.getJson<RouteResult>(cacheKey);
    if (cached) return cached;
    const payload = await this.valhalla<ValhallaRoutePayload>("/route", body);
    if (!payload.trip) throw new ServiceUnavailableException("Routing provider returned no route.");
    const result = parseRoute(payload, input.profile);
    await this.redis.setJson(cacheKey, result, readRuntimeConfig().routeCacheTtlSeconds);
    return result;
  }

  async matrix(input: Readonly<{
    sources: readonly GeoPoint[];
    targets: readonly GeoPoint[];
    profile: RouteProfile;
  }>) {
    if (input.sources.length === 0 || input.targets.length === 0) {
      throw new BadRequestException("Sources and targets are required.");
    }
    const body = {
      sources: input.sources.map((point) => ({ lat: point.latitude, lon: point.longitude })),
      targets: input.targets.map((point) => ({ lat: point.latitude, lon: point.longitude })),
      costing: input.profile
    };
    const cacheKey = routeCacheKey("matrix", input.profile, body);
    const cached = await this.redis.getJson<unknown>(cacheKey);
    if (cached) return cached;
    const payload = await this.valhalla<{
      sources_to_targets?: readonly (readonly Readonly<{
        distance?: number;
        time?: number;
        from_index?: number;
        to_index?: number;
      }>[])[];
    }>("/matrix", body);
    const rows = payload.sources_to_targets ?? [];
    const result = {
      provider: "valhalla",
      profile: input.profile,
      sources: input.sources.length,
      targets: input.targets.length,
      distancesMeters: rows.map((row) => row.map((cell) => Math.round((cell.distance ?? 0) * 1000))),
      durationsSeconds: rows.map((row) => row.map((cell) => Math.round(cell.time ?? 0)))
    };
    await this.redis.setJson(cacheKey, result, readRuntimeConfig().routeCacheTtlSeconds);
    return result;
  }

  async match(input: Readonly<{ shape: readonly GeoPoint[]; profile: RouteProfile }>) {
    if (input.shape.length < 2) throw new BadRequestException("At least two shape points are required.");
    const body = {
      shape: input.shape.map((point) => ({ lat: point.latitude, lon: point.longitude })),
      costing: input.profile,
      shape_match: "map_snap"
    };
    const payload = await this.valhalla<{
      matched_points?: readonly Readonly<{ lat?: number; lon?: number; type?: string; distance_along_edge?: number }>[];
    }>("/trace_route", body);
    const points = (payload.matched_points ?? [])
      .filter((point) => typeof point.lat === "number" && typeof point.lon === "number")
      .map((point) => ({ latitude: point.lat as number, longitude: point.lon as number, type: point.type ?? null }));
    return { provider: "valhalla", profile: input.profile, points };
  }

  async nearby(input: Readonly<{
    latitude: number;
    longitude: number;
    radiusMeters: number;
    limit: number;
    kinds: readonly ("merchant" | "building" | "access_point")[];
  }>) {
    const kinds = new Set(input.kinds);
    const point = `ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography`;
    const queries: Promise<readonly Record<string, unknown>[]>[] = [];
    if (kinds.has("merchant")) {
      queries.push(
        this.database
          .query<Record<string, unknown>>(
            `SELECT ml.id, ml.merchant_id, COALESCE(ml.name, m.display_name) AS name,
                    ST_Y(ml.location::geometry) AS latitude, ST_X(ml.location::geometry) AS longitude,
                    ST_Distance(ml.location::geography, ${point}) AS distance_meters
             FROM merchant_locations ml
             JOIN merchants m ON m.id = ml.merchant_id
             WHERE ml.is_active = true
               AND ST_DWithin(ml.location::geography, ${point}, $3)
             ORDER BY distance_meters ASC
             LIMIT $4`,
            [input.longitude, input.latitude, input.radiusMeters, input.limit]
          )
          .then((result) => result.rows.map((row) => ({ kind: "merchant", ...row })))
      );
    }
    if (kinds.has("building")) {
      queries.push(
        this.database
          .query<Record<string, unknown>>(
            `SELECT b.id, b.name, b.building_type, b.verification_status,
                    ST_Y(ST_Centroid(b.geometry)::geometry) AS latitude,
                    ST_X(ST_Centroid(b.geometry)::geometry) AS longitude,
                    ST_Distance(ST_Centroid(b.geometry)::geography, ${point}) AS distance_meters
             FROM building_footprints b
             WHERE ST_DWithin(b.geometry::geography, ${point}, $3)
             ORDER BY distance_meters ASC
             LIMIT $4`,
            [input.longitude, input.latitude, input.radiusMeters, input.limit]
          )
          .then((result) => result.rows.map((row) => ({ kind: "building", ...row })))
      );
    }
    if (kinds.has("access_point")) {
      queries.push(
        this.database
          .query<Record<string, unknown>>(
            `SELECT ap.id, ap.label, ap.entrance_type, ap.access_instructions, ap.verification_status,
                    ST_Y(ap.location::geometry) AS latitude, ST_X(ap.location::geometry) AS longitude,
                    ST_Distance(ap.location::geography, ${point}) AS distance_meters
             FROM delivery_access_points ap
             WHERE ap.verification_status <> 'rejected'
               AND ST_DWithin(ap.location::geography, ${point}, $3)
             ORDER BY distance_meters ASC
             LIMIT $4`,
            [input.longitude, input.latitude, input.radiusMeters, input.limit]
          )
          .then((result) => result.rows.map((row) => ({ kind: "access_point", ...row })))
      );
    }
    const results = (await Promise.all(queries)).flat();
    return {
      center: { latitude: input.latitude, longitude: input.longitude },
      radiusMeters: input.radiusMeters,
      results: results.slice(0, input.limit)
    };
  }

  async buildings(bbox: readonly [number, number, number, number], limit: number, simplify: number) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    if (minLng >= maxLng || minLat >= maxLat) throw new BadRequestException("Invalid bounding box.");
    const result = await this.database.query<{
      id: string;
      name: string | null;
      building_type: string | null;
      verification_status: string;
      geometry: string;
    }>(
      `SELECT id, name, building_type, verification_status,
              ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, $5)) AS geometry
       FROM building_footprints
       WHERE geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         AND ST_Intersects(geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
       ORDER BY area_sqm DESC NULLS LAST
       LIMIT $6`,
      [minLng, minLat, maxLng, maxLat, simplify, limit]
    );
    return {
      type: "FeatureCollection",
      features: result.rows.map((row) => ({
        type: "Feature",
        id: row.id,
        geometry: JSON.parse(row.geometry) as Record<string, unknown>,
        properties: {
          name: row.name,
          buildingType: row.building_type,
          verificationStatus: row.verification_status
        }
      }))
    };
  }

  async search(query: string, limit: number, countryCode?: string) {
    return this.geocoding.forward({ q: query, limit, ...(countryCode ? { countryCode } : {}) });
  }

  async reverse(latitude: number, longitude: number) {
    return this.geocoding.reverse({ latitude, longitude });
  }

  async deliveryRoute(orderId: string, viewer: Viewer) {
    const result = await this.database.query<{
      id: string;
      user_id: string;
      merchant_id: string;
      courier_user_id: string | null;
      status: string;
      delivery_lat: number | null;
      delivery_lng: number | null;
      dropoff_address: string | null;
      pickup_id: string | null;
      pickup_name: string | null;
      pickup_address: string | null;
      pickup_lat: number | null;
      pickup_lng: number | null;
    }>(
      `SELECT o.id, o.user_id, o.merchant_id, o.courier_user_id, o.status,
              o.delivery_lat, o.delivery_lng, o.delivery_address_snapshot->>'formattedAddress' AS dropoff_address,
              ml.id AS pickup_id, ml.name AS pickup_name, ml.address_line AS pickup_address,
              ST_Y(ml.location::geometry) AS pickup_lat, ST_X(ml.location::geometry) AS pickup_lng
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT ml.id, ml.name, ml.address_line, ml.location
         FROM merchant_locations ml
         WHERE ml.merchant_id = o.merchant_id AND ml.location IS NOT NULL
         ORDER BY ml.is_active DESC, ml.created_at ASC
         LIMIT 1
       ) ml ON true
       WHERE o.id = $1`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw new NotFoundException("Order not found.");
    await this.authorize(order, viewer);

    const pickup = order.pickup_lat !== null && order.pickup_lng !== null
      ? { latitude: Number(order.pickup_lat), longitude: Number(order.pickup_lng), name: order.pickup_name, address: order.pickup_address, id: order.pickup_id }
      : null;
    const dropoff = order.delivery_lat !== null && order.delivery_lng !== null
      ? { latitude: Number(order.delivery_lat), longitude: Number(order.delivery_lng), name: null, address: order.dropoff_address, id: null }
      : null;

    if (!pickup || !dropoff) {
      return {
        orderId: order.id,
        status: order.status,
        available: false,
        reason: !pickup ? "missing_merchant_location" : "missing_delivery_location",
        pickup,
        dropoff,
        route: null,
        alternatives: []
      };
    }

    const route = await this.route({
      locations: [pickup, dropoff],
      profile: "auto",
      alternates: 0,
      language: "en"
    });
    return {
      orderId: order.id,
      status: order.status,
      available: true,
      reason: null,
      pickup,
      dropoff,
      route,
      alternatives: route.alternatives
    };
  }

  private async valhalla<T>(path: string, body: unknown): Promise<T> {
    const config = readRuntimeConfig();
    const url = `${config.valhallaUrl.replace(/\/$/, "")}${path}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.logger.warn(`Valhalla ${path} returned ${response.status}: ${text.slice(0, 200)}`);
        throw new ServiceUnavailableException("Routing service is temporarily unavailable.");
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(`Valhalla ${path} request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException("Routing service is unreachable. Check VALHALLA_URL.");
    }
  }

  private async authorize(
    order: Readonly<{ user_id: string; merchant_id: string; courier_user_id: string | null }>,
    viewer: Viewer
  ): Promise<void> {
    const roles = Array.isArray(viewer.roles) ? viewer.roles : [];
    const allowed = order.user_id === viewer.userId
      || roles.some((role) => ["admin", "support", "operations"].includes(role));
    if (allowed) return;
    const merchant = await this.database.query(
      "SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND user_id = $2 AND is_active = true",
      [order.merchant_id, viewer.userId]
    );
    if ((merchant.rowCount ?? 0) === 0 && order.courier_user_id !== viewer.userId) {
      throw new ForbiddenException("You cannot view this delivery route.");
    }
  }
}

function readStyle(name: MapStyleName): Record<string, unknown> {
  const config = readRuntimeConfig();
  return buildStyle(config, name);
}

function buildStyle(config: ReturnType<typeof readRuntimeConfig>, name: MapStyleName): Record<string, unknown> {
  return buildMapStyle(
    {
      tileServerUrl: config.mapTileServerUrl,
      tileSet: config.mapTileSet,
      glyphsUrl: config.mapGlyphsUrl,
      spriteUrl: config.mapSpriteUrl,
      attribution: config.mapAttribution,
      satelliteTileUrl: config.mapSatelliteTileUrl,
      buildingsSourceLayer: config.mapBuildingsSourceLayer
    },
    name
  );
}

function routeCacheKey(kind: string, profile: string, body: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return `maps:${kind}:${profile}:${digest}`;
}

function parseRoute(payload: ValhallaRoutePayload, profile: RouteProfile): RouteResult {
  const trip = payload.trip;
  if (!trip) throw new ServiceUnavailableException("Routing provider returned an empty trip.");
  const main = parseTrip(trip);
  const alternatives = (payload.alternates ?? [])
    .map((entry) => entry.trip)
    .filter((entry): entry is Trip => Boolean(entry))
    .map((entry) => {
      const parsed = parseTrip(entry);
      return {
        distanceMeters: parsed.distanceMeters,
        durationSeconds: parsed.durationSeconds,
        geometry: parsed.geometry
      };
    });
  return { provider: "valhalla", profile, ...main, alternatives };
}

function parseTrip(trip: Trip) {
  const coordinates: [number, number][] = [];
  const legs = (trip.legs ?? []).map((leg) => {
    if (leg.shape) {
      const decoded = decodePolyline(leg.shape, 6);
      for (const point of decoded) {
        const last = coordinates[coordinates.length - 1];
        if (!last || last[0] !== point[0] || last[1] !== point[1]) coordinates.push([point[0], point[1]]);
      }
    }
    return {
      distanceMeters: Math.round((leg.summary?.length ?? 0) * 1000),
      durationSeconds: Math.round(leg.summary?.time ?? 0),
      maneuvers: (leg.maneuvers ?? []).map((maneuver) => ({
        instruction: maneuver.instruction ?? "",
        spokenInstruction: maneuver.verbal_pre_transition_instruction ?? maneuver.instruction ?? "",
        type: maneuver.type ?? 0,
        streetNames: maneuver.street_names ?? [],
        distanceMeters: Math.round((maneuver.length ?? 0) * 1000),
        durationSeconds: Math.round(maneuver.time ?? 0),
        beginShapeIndex: maneuver.begin_shape_index ?? 0,
        endShapeIndex: maneuver.end_shape_index ?? 0,
        roundaboutExit: maneuver.roundabout_exit_count ?? null
      }))
    };
  });
  return {
    distanceMeters: Math.round((trip.summary?.length ?? 0) * 1000),
    durationSeconds: Math.round(trip.summary?.time ?? 0),
    geometry: { type: "LineString" as const, coordinates },
    legs
  };
}
