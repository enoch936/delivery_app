import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class TrackingService {
  constructor(private readonly database: DatabaseService) {}

  async track(orderId: string, viewer: Readonly<{ userId: string; roles: readonly string[] }>) {
    const orderResult = await this.database.query<{
      id: string; order_number: string; status: string; user_id: string; merchant_id: string; courier_user_id: string | null;
      delivery_estimate_minutes: number | null; delivery_address_snapshot: Record<string, unknown> | null;
      delivered_at: Date | null; cancelled_at: Date | null; created_at: Date;
      delivery_lat: number | null; delivery_lng: number | null;
      courier_name: string | null; courier_phone: string | null; courier_vehicle: string | null; courier_rating: string | null;
      latitude: number | null; longitude: number | null; last_seen_at: Date | null; heading_degrees: string | null;
    }>(
      `SELECT o.id, o.order_number, o.status, o.user_id, o.merchant_id, o.courier_user_id,
              o.delivery_estimate_minutes, o.delivery_address_snapshot, o.delivered_at, o.cancelled_at, o.created_at,
              o.delivery_lat, o.delivery_lng,
              u.display_name AS courier_name, u.phone_e164 AS courier_phone, cp.vehicle_type AS courier_vehicle, cp.rating_average AS courier_rating,
              ST_Y(ca.last_location::geometry) AS latitude, ST_X(ca.last_location::geometry) AS longitude, ca.last_seen_at,
              (SELECT heading_degrees FROM courier_location_samples s WHERE s.courier_user_id = o.courier_user_id ORDER BY recorded_at DESC LIMIT 1)::text AS heading_degrees
       FROM orders o
       LEFT JOIN users u ON u.id = o.courier_user_id
       LEFT JOIN courier_profiles cp ON cp.user_id = o.courier_user_id
       LEFT JOIN courier_availability ca ON ca.courier_user_id = o.courier_user_id
       WHERE o.id = $1`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) throw new NotFoundException("Order not found.");
    const roles = Array.isArray((viewer as any).roles) ? (viewer as any).roles : []; const allowed = order.user_id === viewer.userId || roles.some((role: string) => ["admin", "support", "operations"].includes(role));
    if (!allowed) {
      const merchant = await this.database.query("SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND user_id = $2", [order.merchant_id, viewer.userId]);
      if ((merchant.rowCount ?? 0) === 0 && order.courier_user_id !== viewer.userId) throw new ForbiddenException("You cannot track this order.");
    }
    const events = await this.database.query<{ to_status: string; created_at: Date; metadata: { note?: string } | null }>(
      "SELECT to_status, created_at, metadata FROM order_status_events WHERE order_id = $1 ORDER BY created_at ASC", [orderId]
    );
    const assignment = await this.database.query<{ status: string; accepted_at: Date | null; arrived_at: Date | null; picked_up_at: Date | null; delivered_at: Date | null }>(
      "SELECT status, accepted_at, arrived_at, picked_up_at, delivered_at FROM delivery_assignments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1", [orderId]
    );
    const destination = order.delivery_address_snapshot && typeof order.delivery_address_snapshot.latitude === "number"
      ? { latitude: order.delivery_address_snapshot.latitude, longitude: order.delivery_address_snapshot.longitude }
      : order.delivery_lat !== null && order.delivery_lng !== null ? { latitude: order.delivery_lat, longitude: order.delivery_lng } : null;
    const courierLocation = order.latitude !== null && order.longitude !== null
      ? { latitude: Number(order.latitude), longitude: Number(order.longitude), lastSeenAt: order.last_seen_at?.toISOString() ?? null, headingDegrees: order.heading_degrees === null ? null : Number(order.heading_degrees) }
      : null;
    const distanceToDestination = courierLocation && destination
      ? Math.round(haversineMeters(courierLocation.latitude, courierLocation.longitude, Number(destination.latitude), Number(destination.longitude)))
      : null;
    return {
      orderId: order.id, orderNumber: order.order_number, status: order.status,
      createdAt: order.created_at.toISOString(), deliveredAt: order.delivered_at?.toISOString() ?? null, cancelledAt: order.cancelled_at?.toISOString() ?? null,
      courier: order.courier_user_id ? {
        userId: order.courier_user_id, displayName: order.courier_name, phoneE164: order.courier_phone,
        vehicleType: order.courier_vehicle, rating: order.courier_rating === null ? null : Number(order.courier_rating),
        location: courierLocation, distanceToDestinationMeters: distanceToDestination,
        etaMinutes: distanceToDestination === null ? order.delivery_estimate_minutes : Math.max(1, Math.round(distanceToDestination / 250))
      } : null,
      destination,
      timeline: events.rows.map((event) => ({ status: event.to_status, at: event.created_at.toISOString(), note: event.metadata?.note ?? null })),
      assignment: assignment.rows[0] ? {
        status: assignment.rows[0].status,
        acceptedAt: assignment.rows[0].accepted_at?.toISOString() ?? null,
        arrivedAt: assignment.rows[0].arrived_at?.toISOString() ?? null,
        pickedUpAt: assignment.rows[0].picked_up_at?.toISOString() ?? null,
        deliveredAt: assignment.rows[0].delivered_at?.toISOString() ?? null
      } : null,
      liveTrackingEnabled: courierLocation !== null && !["DELIVERED", "CANCELLED", "FAILED", "REFUNDED"].includes(order.status)
    };
  }
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}
