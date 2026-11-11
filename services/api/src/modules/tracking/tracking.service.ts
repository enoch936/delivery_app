import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import { LatestLocationService } from "../../redis/latest-location.service.js";

const TERMINAL_STATUSES = ["DELIVERED", "CANCELLED", "FAILED", "REFUNDED"];
const PICKED_UP_STATUSES = ["PICKED_UP", "IN_TRANSIT", "DELIVERED"];

type CourierLocation = {
  latitude: number;
  longitude: number;
  lastSeenAt: string | null;
  headingDegrees: number | null;
  speedMps: number | null;
  accuracyMeters: number | null;
};

type RoutePoint = Readonly<{
  latitude: number;
  longitude: number;
  recordedAt: string;
  headingDegrees: number | null;
  speedMps: number | null;
}>;

type EtaEstimate = Readonly<{
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  confidence: "high" | "medium" | "low";
  basis: "live_location" | "merchant_estimate";
  distanceMeters: number | null;
  prepMinutes: number;
  travelMinutes: number;
  lastLocationUpdatedAt: string | null;
  lastLocationAgeSeconds: number | null;
  stale: boolean;
}>;

@Injectable()
export class TrackingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly latestLocation: LatestLocationService
  ) {}

  async track(orderId: string, viewer: Readonly<{ userId: string; roles: readonly string[] }>) {
    const orderResult = await this.database.query<{
      id: string; order_number: string; status: string; user_id: string; merchant_id: string; courier_user_id: string | null;
      merchant_name: string | null; delivery_estimate_minutes: number | null; delivery_address_snapshot: Record<string, unknown> | null;
      delivered_at: Date | null; cancelled_at: Date | null; created_at: Date;
      delivery_lat: number | null; delivery_lng: number | null;
      courier_name: string | null; courier_phone: string | null; courier_vehicle: string | null; courier_rating: string | null;
      latitude: number | null; longitude: number | null; last_seen_at: Date | null; heading_degrees: string | null;
      recent_speed_mps: string | null;
      pickup_id: string | null; pickup_name: string | null; pickup_address: string | null;
      pickup_lat: number | null; pickup_lng: number | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.user_id, o.merchant_id, o.courier_user_id,
              COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name,
              o.delivery_estimate_minutes, o.delivery_address_snapshot, o.delivered_at, o.cancelled_at, o.created_at,
              o.delivery_lat, o.delivery_lng,
              u.display_name AS courier_name, u.phone_e164 AS courier_phone, cp.vehicle_type AS courier_vehicle, cp.rating_average AS courier_rating,
              ST_Y(ca.last_location::geometry) AS latitude, ST_X(ca.last_location::geometry) AS longitude, ca.last_seen_at,
              (SELECT heading_degrees FROM courier_location_samples s WHERE s.courier_user_id = o.courier_user_id ORDER BY recorded_at DESC LIMIT 1)::text AS heading_degrees,
              (SELECT speed_mps FROM courier_location_samples s WHERE s.courier_user_id = o.courier_user_id ORDER BY recorded_at DESC LIMIT 1)::text AS recent_speed_mps,
              ml.id AS pickup_id, ml.name AS pickup_name, ml.address_line AS pickup_address,
              ST_Y(ml.location::geometry) AS pickup_lat, ST_X(ml.location::geometry) AS pickup_lng
       FROM orders o
       JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN users u ON u.id = o.courier_user_id
       LEFT JOIN courier_profiles cp ON cp.user_id = o.courier_user_id
       LEFT JOIN courier_availability ca ON ca.courier_user_id = o.courier_user_id
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
    const order = orderResult.rows[0];
    if (!order) throw new NotFoundException("Order not found.");
    await this.authorize(order, viewer);
    const latest = order.courier_user_id ? await this.latestLocation.get(order.courier_user_id) : null;
    const latestRecordedAt = latest ? new Date(latest.recordedAt).getTime() : 0;
    const databaseRecordedAt = order.last_seen_at?.getTime() ?? 0;
    const live = latest && latestRecordedAt >= databaseRecordedAt ? latest : null;

    const [events, assignmentResult, routeResult] = await Promise.all([
      this.database.query<{ to_status: string; created_at: Date; metadata: { note?: string } | null }>(
        "SELECT to_status, created_at, metadata FROM order_status_events WHERE order_id = $1 ORDER BY created_at ASC",
        [orderId]
      ),
      this.database.query<{ status: string; accepted_at: Date | null; arrived_at: Date | null; picked_up_at: Date | null; delivered_at: Date | null }>(
        "SELECT status, accepted_at, arrived_at, picked_up_at, delivered_at FROM delivery_assignments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
        [orderId]
      ),
      this.database.query<{
        latitude: number; longitude: number; recorded_at: Date; heading_degrees: string | null; speed_mps: string | null;
      }>(
        `SELECT latitude, longitude, recorded_at, heading_degrees, speed_mps FROM (
           SELECT ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
                  recorded_at, heading_degrees, speed_mps
           FROM courier_location_samples
           WHERE order_id = $1 AND recorded_at > now() - interval '45 minutes'
           ORDER BY recorded_at DESC LIMIT 120
         ) recent ORDER BY recorded_at ASC`,
        [orderId]
      )
    ]);

    const assignment = assignmentResult.rows[0] ?? null;
    const destination = readDestination(order);
    const pickup = order.pickup_id !== null && order.pickup_lat !== null && order.pickup_lng !== null
      ? {
          id: order.pickup_id,
          name: order.pickup_name,
          addressLine: order.pickup_address,
          latitude: Number(order.pickup_lat),
          longitude: Number(order.pickup_lng)
        }
      : null;
    const courierLocation: CourierLocation | null = live
      ? {
          latitude: live.latitude,
          longitude: live.longitude,
          lastSeenAt: live.recordedAt,
          headingDegrees: live.headingDegrees,
          speedMps: live.speedMps,
          accuracyMeters: live.accuracyMeters
        }
      : order.latitude !== null && order.longitude !== null
        ? {
            latitude: Number(order.latitude),
            longitude: Number(order.longitude),
            lastSeenAt: order.last_seen_at?.toISOString() ?? null,
            headingDegrees: order.heading_degrees === null ? null : Number(order.heading_degrees),
            speedMps: order.recent_speed_mps === null ? null : Number(order.recent_speed_mps),
            accuracyMeters: null
          }
        : null;
    const route: RoutePoint[] = routeResult.rows.map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      recordedAt: point.recorded_at.toISOString(),
      headingDegrees: point.heading_degrees === null ? null : Number(point.heading_degrees),
      speedMps: point.speed_mps === null ? null : Number(point.speed_mps)
    }));

    const pickedUp = PICKED_UP_STATUSES.includes(order.status)
      || (assignment?.picked_up_at !== null && assignment?.picked_up_at !== undefined);
    const distanceToDestination = courierLocation && destination
      ? Math.round(haversineMeters(courierLocation.latitude, courierLocation.longitude, destination.latitude, destination.longitude))
      : null;
    const courierToPickup = courierLocation && pickup && !pickedUp
      ? Math.round(haversineMeters(courierLocation.latitude, courierLocation.longitude, pickup.latitude, pickup.longitude))
      : null;
    const pickupToDestination = pickup && destination
      ? Math.round(haversineMeters(pickup.latitude, pickup.longitude, destination.latitude, destination.longitude))
      : null;
    const remainingMeters = terminalStatus(order.status)
      ? null
      : pickedUp
        ? distanceToDestination
        : courierToPickup !== null && pickupToDestination !== null
          ? courierToPickup + pickupToDestination
          : pickupToDestination ?? distanceToDestination;
    const eta = terminalStatus(order.status)
      ? null
      : computeEta({
          status: order.status,
          vehicleType: order.courier_vehicle,
          remainingMeters,
          pickedUp,
          courierLocation,
          fallbackMinutes: order.delivery_estimate_minutes
        });
    const liveTrackingEnabled = courierLocation !== null && !terminalStatus(order.status);

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      merchant: { id: order.merchant_id, displayName: order.merchant_name },
      createdAt: order.created_at.toISOString(),
      deliveredAt: order.delivered_at?.toISOString() ?? null,
      cancelledAt: order.cancelled_at?.toISOString() ?? null,
      courier: order.courier_user_id
        ? {
            userId: order.courier_user_id,
            displayName: order.courier_name,
            phoneE164: order.courier_phone,
            vehicleType: order.courier_vehicle,
            rating: order.courier_rating === null ? null : Number(order.courier_rating),
            location: courierLocation,
            distanceToDestinationMeters: distanceToDestination,
            distanceToPickupMeters: courierToPickup,
            remainingDistanceMeters: remainingMeters,
            etaMinutes: eta?.minutes ?? null
          }
        : null,
      destination,
      pickup,
      eta,
      route,
      timeline: events.rows.map((event) => ({
        status: event.to_status,
        at: event.created_at.toISOString(),
        note: event.metadata?.note ?? null
      })),
      assignment: assignment
        ? {
            status: assignment.status,
            acceptedAt: assignment.accepted_at?.toISOString() ?? null,
            arrivedAt: assignment.arrived_at?.toISOString() ?? null,
            pickedUpAt: assignment.picked_up_at?.toISOString() ?? null,
            deliveredAt: assignment.delivered_at?.toISOString() ?? null
          }
        : null,
      liveTrackingEnabled
    };
  }

  async participants(viewer: Readonly<{ userId: string; roles: readonly string[] }>) {
    const roles = Array.isArray(viewer.roles) ? viewer.roles : [];
    const operator = roles.some((role) => ["admin", "support", "operations"].includes(role));
    const merchant = roles.some((role) => ["merchant_staff", "business_admin"].includes(role));
    const result = await this.database.query<{
      id: string;
      order_number: string;
      status: string;
      user_id: string;
      merchant_id: string;
      courier_user_id: string | null;
      courier_name: string | null;
      customer_name: string | null;
      courier_lat: number | null;
      courier_lng: number | null;
      last_seen_at: Date | null;
      accuracy_meters: string | null;
      heading_degrees: string | null;
      speed_mps: string | null;
      location_recorded_at: Date | null;
      pickup_id: string | null;
      pickup_name: string | null;
      pickup_lat: number | null;
      pickup_lng: number | null;
      delivery_lat: number | null;
      delivery_lng: number | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.user_id, o.merchant_id, o.courier_user_id,
              u.display_name AS courier_name, cu.display_name AS customer_name,
              ST_Y(ca.last_location::geometry) AS courier_lat, ST_X(ca.last_location::geometry) AS courier_lng,
              ca.last_seen_at, ca.accuracy_meters::text, ca.heading_degrees::text, ca.speed_mps::text,
              ca.location_recorded_at,
              ml.id AS pickup_id, COALESCE(ml.name, m.display_name) AS pickup_name,
              ST_Y(ml.location::geometry) AS pickup_lat, ST_X(ml.location::geometry) AS pickup_lng,
              o.delivery_lat, o.delivery_lng
       FROM orders o
       JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN users u ON u.id = o.courier_user_id
       LEFT JOIN users cu ON cu.id = o.user_id
       LEFT JOIN courier_availability ca ON ca.courier_user_id = o.courier_user_id
       LEFT JOIN LATERAL (
         SELECT ml.id, ml.name, ml.location
         FROM merchant_locations ml
         WHERE ml.merchant_id = o.merchant_id AND ml.location IS NOT NULL
         ORDER BY ml.is_active DESC, ml.created_at ASC
         LIMIT 1
       ) ml ON true
       WHERE o.status <> ALL($4::text[])
         AND (
           $1::boolean
           OR o.user_id = $2
           OR o.courier_user_id = $2
           OR ($3::boolean AND EXISTS (
             SELECT 1 FROM merchant_members mm
             WHERE mm.merchant_id = o.merchant_id AND mm.user_id = $2 AND mm.is_active = true
           ) AND o.status <> ALL($5::text[]))
         )
       ORDER BY o.updated_at DESC
       LIMIT 500`,
      [operator, viewer.userId, merchant, TERMINAL_STATUSES, ["PENDING_CONFIRMATION", "AWAITING_PAYMENT", "CONFIRMED"]]
    );

    const courierIds = result.rows
      .map((row) => row.courier_user_id)
      .filter((id): id is string => id !== null);
    const latest = await this.latestLocation.getMany(courierIds);
    const now = Date.now();
    const participants = new Map<string, Record<string, unknown>>();

    const add = (id: string, point: Record<string, unknown>): void => {
      if (participants.has(id)) return;
      participants.set(id, point);
    };

    for (const row of result.rows) {
      if (row.courier_user_id) {
        const recent = latest.get(row.courier_user_id);
        const latitude = recent?.latitude ?? (row.courier_lat === null ? null : Number(row.courier_lat));
        const longitude = recent?.longitude ?? (row.courier_lng === null ? null : Number(row.courier_lng));
        const recordedAt = recent?.recordedAt ?? row.location_recorded_at?.toISOString() ?? row.last_seen_at?.toISOString() ?? null;
        if (latitude !== null && longitude !== null) {
          add(`courier:${row.courier_user_id}`, {
            id: `courier:${row.courier_user_id}`,
            kind: "courier",
            label: row.courier_name ?? "Courier",
            latitude,
            longitude,
            headingDegrees: recent?.headingDegrees ?? numberOrNull(row.heading_degrees),
            speedMps: recent?.speedMps ?? numberOrNull(row.speed_mps),
            accuracyMeters: recent?.accuracyMeters ?? numberOrNull(row.accuracy_meters),
            updatedAt: recordedAt,
            stale: recordedAt === null || now - new Date(recordedAt).getTime() > 120_000,
            orderId: row.id,
            orderNumber: row.order_number,
            status: row.status
          });
        }
      }
      if (row.pickup_id && row.pickup_lat !== null && row.pickup_lng !== null) {
        add(`merchant:${row.pickup_id}`, {
          id: `merchant:${row.pickup_id}`,
          kind: "merchant",
          label: row.pickup_name ?? "Merchant",
          latitude: Number(row.pickup_lat),
          longitude: Number(row.pickup_lng),
          headingDegrees: null,
          speedMps: null,
          accuracyMeters: null,
          updatedAt: null,
          stale: false,
          orderId: row.id,
          orderNumber: row.order_number,
          status: row.status
        });
      }
      if (row.delivery_lat !== null && row.delivery_lng !== null) {
        add(`customer:${row.id}`, {
          id: `customer:${row.id}`,
          kind: "customer",
          label: row.customer_name ?? "Customer",
          latitude: Number(row.delivery_lat),
          longitude: Number(row.delivery_lng),
          headingDegrees: null,
          speedMps: null,
          accuracyMeters: null,
          updatedAt: null,
          stale: false,
          orderId: row.id,
          orderNumber: row.order_number,
          status: row.status
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      scope: operator ? "operations" : merchant ? "merchant" : roles.includes("courier") ? "courier" : "customer",
      orders: result.rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        courierUserId: row.courier_user_id
      })),
      participants: [...participants.values()]
    };
  }

  private async authorize(
    order: Readonly<{ user_id: string; merchant_id: string; courier_user_id: string | null }>,
    viewer: Readonly<{ userId: string; roles: readonly string[] }>
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
      throw new ForbiddenException("You cannot track this order.");
    }
  }
}

function computeEta(input: Readonly<{
  status: string;
  vehicleType: string | null;
  remainingMeters: number | null;
  pickedUp: boolean;
  courierLocation: CourierLocation | null;
  fallbackMinutes: number | null;
}>): EtaEstimate {
  const lastSeenAt = input.courierLocation?.lastSeenAt ?? null;
  const ageSeconds = lastSeenAt === null
    ? null
    : Math.max(0, Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 1000));
  const stale = ageSeconds === null || ageSeconds > 120;
  const prepMinutes = prepBufferMinutes(input.status, input.pickedUp);
  const travelMinutes = input.remainingMeters === null
    ? null
    : input.remainingMeters / metersPerMinute(input.vehicleType);
  const base = travelMinutes === null
    ? input.fallbackMinutes
    : travelMinutes + prepMinutes + 2;
  if (base === null && prepMinutes === 0) {
    return {
      minutes: 0,
      minMinutes: 0,
      maxMinutes: 0,
      confidence: "low",
      basis: "merchant_estimate",
      distanceMeters: input.remainingMeters,
      prepMinutes,
      travelMinutes: 0,
      lastLocationUpdatedAt: lastSeenAt,
      lastLocationAgeSeconds: ageSeconds,
      stale
    };
  }
  const fallback = base ?? Math.max(prepMinutes + 5, 10);
  const routeUncertainty = Math.round(fallback * 0.2);
  const prepUncertainty = Math.round(prepMinutes * 0.3);
  const stalePenalty = ageSeconds === null ? 8 : Math.min(10, Math.floor(ageSeconds / 60));
  const spread = Math.max(2, Math.min(25, routeUncertainty + prepUncertainty + stalePenalty));
  const minutes = Math.max(1, Math.round(fallback));
  const minMinutes = Math.max(1, minutes - Math.ceil(spread / 2));
  const maxMinutes = Math.max(minMinutes + 2, minutes + spread);
  const confidence = ageSeconds === null || ageSeconds > 300
    ? "low"
    : ageSeconds <= 60
      ? "high"
      : ageSeconds <= 180
        ? "medium"
        : "low";
  return {
    minutes,
    minMinutes,
    maxMinutes,
    confidence,
    basis: travelMinutes === null ? "merchant_estimate" : "live_location",
    distanceMeters: input.remainingMeters,
    prepMinutes,
    travelMinutes: travelMinutes === null ? 0 : Math.round(travelMinutes),
    lastLocationUpdatedAt: lastSeenAt,
    lastLocationAgeSeconds: ageSeconds,
    stale
  };
}

function prepBufferMinutes(status: string, pickedUp: boolean): number {
  if (pickedUp) return 0;
  switch (status) {
    case "PENDING_CONFIRMATION":
    case "AWAITING_PAYMENT":
      return 12;
    case "CONFIRMED":
      return 11;
    case "ACCEPTED_BY_MERCHANT":
      return 9;
    case "PREPARING":
      return 6;
    case "READY_FOR_PICKUP":
      return 2;
    case "COURIER_ASSIGNED":
    case "COURIER_ARRIVING_PICKUP":
      return 1;
    default:
      return 4;
  }
}

function metersPerMinute(vehicleType: string | null): number {
  switch (vehicleType) {
    case "walking":
      return 75;
    case "bicycle":
      return 200;
    case "motorcycle":
      return 430;
    case "car":
      return 360;
    case "van":
      return 300;
    default:
      return 330;
  }
}

function terminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function readDestination(order: Readonly<{
  delivery_address_snapshot: Record<string, unknown> | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
}>): { latitude: number; longitude: number } | null {
  const snapshot = order.delivery_address_snapshot ?? {};
  const latitude = typeof snapshot.latitude === "number" ? snapshot.latitude : null;
  const longitude = typeof snapshot.longitude === "number" ? snapshot.longitude : null;
  if (latitude !== null && longitude !== null) return { latitude, longitude };
  if (order.delivery_lat !== null && order.delivery_lng !== null) {
    return { latitude: Number(order.delivery_lat), longitude: Number(order.delivery_lng) };
  }
  return null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}
