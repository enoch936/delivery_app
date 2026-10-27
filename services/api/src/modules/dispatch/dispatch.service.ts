import { ConflictException, GoneException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { rankDispatchCandidates, type DispatchCandidate } from "@delivery-app/domain";
import { readRuntimeConfig, type RuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";
import { AuditService } from "../../common/audit.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type { DispatchOfferRecord } from "./dispatch.types.js";

type CandidateRow = {
  user_id: string;
  distance_meters: number;
  active_assignments: string;
  rating: string;
  acceptance_rate: number;
  pending_offers: string;
  capacity_units: number;
};

@Injectable()
export class DispatchService {
  private readonly config: RuntimeConfig;

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService
  ) {
    this.config = readRuntimeConfig();
  }

  async findCandidates(orderId: string): Promise<DispatchCandidate[]> {
    const radius = this.config.dispatchRadiusMeters;
    const result = await this.database.query<CandidateRow>(
      `SELECT cp.user_id,
              ST_DistanceSphere(ca.last_location::geometry, ml.location::geometry)::float8 AS distance_meters,
              (SELECT count(*)::text FROM delivery_assignments da WHERE da.courier_user_id = cp.user_id AND da.status IN ('accepted','arrived_pickup','picked_up')) AS active_assignments,
              cp.rating_average::text AS rating,
              COALESCE((SELECT count(*) FILTER (WHERE o.status = 'accepted')::float8 / NULLIF(count(*) FILTER (WHERE o.status IN ('accepted','rejected')), 0)
                        FROM dispatch_offers o WHERE o.courier_user_id = cp.user_id AND o.created_at > now() - interval '30 days'), 0.75) AS acceptance_rate,
              (SELECT count(*)::text FROM dispatch_offers o WHERE o.courier_user_id = cp.user_id AND o.status = 'pending' AND o.expires_at > now()) AS pending_offers,
              cp.capacity_units
       FROM orders o
       JOIN merchant_locations ml ON ml.id = o.merchant_location_id
       JOIN courier_profiles cp ON cp.status = 'approved'
       JOIN courier_availability ca ON ca.courier_user_id = cp.user_id
       WHERE o.id = $1
         AND ca.is_online = true AND ca.accepting_offers = true AND ca.active_order_id IS NULL
         AND ca.last_location IS NOT NULL AND ml.location IS NOT NULL
         AND ST_DWithin(ca.last_location::geography, ml.location::geography, $2)
         AND (SELECT count(*) FROM dispatch_offers po WHERE po.courier_user_id = cp.user_id AND po.status = 'pending' AND po.expires_at > now()) < $3
       ORDER BY distance_meters ASC
       LIMIT 25`,
      [orderId, radius, this.config.maxPendingOffersPerCourier]
    );
    const candidates = result.rows.map((row) => ({
      courierId: row.user_id,
      distanceToPickupMeters: Number(row.distance_meters),
      activeAssignments: Number(row.active_assignments),
      rating: Number(row.rating),
      acceptanceRate: Number(row.acceptance_rate),
      pendingOffers: Number(row.pending_offers),
      vehicleCapacity: row.capacity_units,
      requiredCapacity: 1,
      isOnline: true,
      isVerified: true
    }));
    return rankDispatchCandidates(candidates).map((ranked) => {
      const candidate = candidates.find((item) => item.courierId === ranked.courierId);
      return candidate ?? { courierId: ranked.courierId, distanceToPickupMeters: 0, activeAssignments: 0, rating: 0, acceptanceRate: 0, pendingOffers: 0, vehicleCapacity: 1, requiredCapacity: 1, isOnline: true, isVerified: true };
    });
  }

  async offerOrder(input: Readonly<{ orderId: string; actorUserId: string | null; requestId: string | null }>): Promise<{ assignmentId: string; offersCreated: number; candidatesEvaluated: number }> {
    return this.database.withTransaction(async (client) => {
      const order = await client.query<{ id: string; status: string; delivery_fee_minor: string; tip_minor: string; currency: string; user_id: string }>(
        "SELECT id, status, delivery_fee_minor, tip_minor, currency, user_id FROM orders WHERE id = $1 FOR UPDATE",
        [input.orderId]
      );
      const row = order.rows[0];
      if (!row) throw new NotFoundException("Order not found.");
      if (row.status !== "READY_FOR_PICKUP") throw new ConflictException("Only orders that are ready for pickup can be dispatched.");
      const active = await client.query("SELECT 1 FROM delivery_assignments WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup','picked_up')", [row.id]);
      if ((active.rowCount ?? 0) > 0) throw new ConflictException("This order already has an active delivery assignment.");
      const candidates = await this.findCandidates(row.id);
      if (candidates.length === 0) return { assignmentId: "", offersCreated: 0, candidatesEvaluated: 0 };
      const assignment = await client.query<{ id: string }>(
        `INSERT INTO delivery_assignments (order_id, courier_user_id, status, distance_to_pickup_meters, estimated_pickup_seconds)
         VALUES ($1, $2, 'offered', $3, $4) RETURNING id`,
        [row.id, candidates[0]!.courierId, Math.round(candidates[0]!.distanceToPickupMeters), Math.round(candidates[0]!.distanceToPickupMeters / 5)]
      );
      const assignmentId = assignment.rows[0]?.id;
      if (!assignmentId) throw new Error("Delivery assignment creation failed.");
      const expiresAt = new Date(Date.now() + this.config.courierOfferTimeoutSeconds * 1000);
      let created = 0;
      for (const candidate of candidates.slice(0, 5)) {
        const offer = await client.query<{ id: string }>(
          `INSERT INTO dispatch_offers (assignment_id, order_id, courier_user_id, status, score, distance_to_pickup_meters, expires_at)
           VALUES ($1,$2,$3,'pending',$4,$5,$6) ON CONFLICT (assignment_id, courier_user_id) DO NOTHING RETURNING id`,
          [assignmentId, row.id, candidate.courierId, candidate.distanceToPickupMeters, Math.round(candidate.distanceToPickupMeters), expiresAt]
        );
        const offerId = offer.rows[0]?.id;
        if (offerId) {
          created += 1;
          await this.notifications.create({
            userId: candidate.courierId, type: "offer.received", title: "New delivery offer",
            body: `A delivery is available ${Math.round(candidate.distanceToPickupMeters / 100) / 10} km from you.`,
            data: { orderId: row.id, assignmentId, offerId, expiresAt: expiresAt.toISOString() }
          }, client);
        }
      }
      if (created === 0) throw new ConflictException("No eligible courier offers could be created.");
      await this.audit.record({ actorUserId: input.actorUserId, action: "dispatch.offers_created", entityType: "order", entityId: row.id, requestId: input.requestId, metadata: { assignmentId, offersCreated: created, candidates: candidates.length } }, client);
      return { assignmentId, offersCreated: created, candidatesEvaluated: candidates.length };
    });
  }

  async listOffers(courierId: string): Promise<{ items: DispatchOfferRecord[] }> {
    await this.database.query("UPDATE dispatch_offers SET status = 'expired', responded_at = now() WHERE courier_user_id = $1 AND status = 'pending' AND expires_at <= now()", [courierId]);
    const result = await this.database.query<{
      offer_id: string; assignment_id: string; order_id: string; order_number: string; merchant_name: string;
      pickup_address: string | null; delivery_address: string | null; distance_meters: number; distance_to_delivery: number | null;
      delivery_estimate_minutes: number | null; delivery_fee_minor: string; tip_minor: string; currency: string; expires_at: Date; created_at: Date;
    }>(
      `SELECT o.id AS offer_id, o.assignment_id, o.order_id, ord.order_number,
              COALESCE(ord.merchant_name_snapshot, m.display_name) AS merchant_name,
              ml.address_line AS pickup_address,
              COALESCE(ord.delivery_address_snapshot->>'addressLine', ca.address_line) AS delivery_address,
              o.distance_to_pickup_meters AS distance_meters,
              ST_DistanceSphere(ml.location::geometry, ca.location::geometry)::float8 AS distance_to_delivery,
              ord.delivery_estimate_minutes, ord.delivery_fee_minor, ord.tip_minor, ord.currency, o.expires_at, o.created_at
       FROM dispatch_offers o
       JOIN orders ord ON ord.id = o.order_id
       JOIN merchants m ON m.id = ord.merchant_id
       LEFT JOIN merchant_locations ml ON ml.id = ord.merchant_location_id
       LEFT JOIN customer_addresses ca ON ca.id = ord.delivery_address_id
       WHERE o.courier_user_id = $1 AND o.status = 'pending' AND o.expires_at > now()
       ORDER BY o.created_at DESC`,
      [courierId]
    );
    return {
      items: result.rows.map((row) => ({
        offerId: row.offer_id, assignmentId: row.assignment_id, orderId: row.order_id, orderNumber: row.order_number,
        merchantName: row.merchant_name, pickupAddress: row.pickup_address, deliveryAddress: row.delivery_address,
        distanceToPickupMeters: Math.round(Number(row.distance_meters)),
        deliveryDistanceMeters: row.distance_to_delivery === null ? null : Math.round(Number(row.distance_to_delivery)),
        estimatedMinutes: row.delivery_estimate_minutes,
        compensationMinor: Number(row.delivery_fee_minor) + Number(row.tip_minor),
        tipMinor: Number(row.tip_minor), currency: row.currency,
        expiresAt: row.expires_at.toISOString(), createdAt: row.created_at.toISOString()
      }))
    };
  }

  async acceptOffer(courierId: string, offerId: string, requestId: string | null): Promise<{ assignmentId: string; orderId: string }> {
    return this.database.withTransaction(async (client) => {
      const offerResult = await client.query<{ id: string; assignment_id: string; order_id: string; status: string; expires_at: Date; distance_to_pickup_meters: number | null }>(
        "SELECT id, assignment_id, order_id, status, expires_at, distance_to_pickup_meters FROM dispatch_offers WHERE id = $1 AND courier_user_id = $2 FOR UPDATE",
        [offerId, courierId]
      );
      const offer = offerResult.rows[0];
      if (!offer) throw new NotFoundException("Offer not found.");
      if (offer.status === "expired" || offer.expires_at <= new Date()) {
        await client.query("UPDATE dispatch_offers SET status = 'expired', responded_at = now() WHERE id = $1", [offer.id]);
        throw new GoneException("This delivery offer has expired.");
      }
      if (offer.status !== "pending") throw new ConflictException("This offer is no longer available.");
      const courier = await client.query<{ status: string; is_online: boolean; active_order_id: string | null }>(
        `SELECT cp.status, ca.is_online, ca.active_order_id
         FROM courier_profiles cp JOIN courier_availability ca ON ca.courier_user_id = cp.user_id
         WHERE cp.user_id = $1 FOR UPDATE OF cp, ca`,
        [courierId]
      );
      const profile = courier.rows[0];
      if (!profile || profile.status !== "approved" || !profile.is_online) throw new ConflictException("You must be approved and online to accept deliveries.");
      if (profile.active_order_id) throw new ConflictException("Complete your active delivery before accepting another.");
      const assignment = await client.query<{ id: string; status: string }>("SELECT id, status FROM delivery_assignments WHERE id = $1 FOR UPDATE", [offer.assignment_id]);
      if (!assignment.rows[0] || assignment.rows[0].status !== "offered") throw new ConflictException("This delivery has already been assigned to another courier.");
      const order = await client.query<{ id: string; order_number: string; user_id: string; status: string }>("SELECT id, order_number, user_id, status FROM orders WHERE id = $1 FOR UPDATE", [offer.order_id]);
      const orderRow = order.rows[0];
      if (!orderRow) throw new NotFoundException("Order not found.");
      if (orderRow.status !== "READY_FOR_PICKUP") throw new ConflictException("This order is no longer available for dispatch.");
      await client.query("UPDATE delivery_assignments SET status = 'accepted', accepted_at = now(), courier_user_id = $2, distance_to_pickup_meters = $3 WHERE id = $1", [offer.assignment_id, courierId, offer.distance_to_pickup_meters]);
      await client.query("UPDATE dispatch_offers SET status = 'accepted', responded_at = now() WHERE id = $1", [offer.id]);
      await client.query("UPDATE dispatch_offers SET status = 'cancelled', responded_at = now() WHERE assignment_id = $1 AND id <> $2 AND status = 'pending'", [offer.assignment_id, offer.id]);
      await client.query("UPDATE orders SET status = 'COURIER_ASSIGNED', courier_user_id = $2, version = version + 1 WHERE id = $1", [orderRow.id, courierId]);
      await client.query("UPDATE courier_availability SET active_order_id = $2, accepting_offers = false, updated_at = now() WHERE courier_user_id = $1", [courierId, orderRow.id]);
      await client.query("INSERT INTO order_status_events (order_id, from_status, to_status, actor_user_id, metadata) VALUES ($1,'READY_FOR_PICKUP','COURIER_ASSIGNED',$2,$3)", [orderRow.id, courierId, JSON.stringify({ note: "Courier accepted the delivery" })]);
      await this.notifications.create({
        userId: orderRow.user_id, type: "order.courier_assigned", title: "Courier assigned",
        body: `A courier is on the way to collect order ${orderRow.order_number}.`, data: { orderId: orderRow.id }
      }, client);
      await client.query("INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ('delivery.assigned','order',$1,$2)", [orderRow.id, JSON.stringify({ orderId: orderRow.id, courierId, assignmentId: offer.assignment_id })]);
      await this.audit.record({ actorUserId: courierId, action: "dispatch.offer_accepted", entityType: "order", entityId: orderRow.id, requestId, metadata: { assignmentId: offer.assignment_id } }, client);
      return { assignmentId: offer.assignment_id, orderId: orderRow.id };
    });
  }

  async rejectOffer(courierId: string, offerId: string, reason: string | undefined, requestId: string | null): Promise<void> {
    const result = await this.database.query(
      "UPDATE dispatch_offers SET status = 'rejected', responded_at = now() WHERE id = $1 AND courier_user_id = $2 AND status = 'pending'",
      [offerId, courierId]
    );
    if (result.rowCount === 0) throw new NotFoundException("Pending offer not found.");
    await this.audit.record({ actorUserId: courierId, action: "dispatch.offer_rejected", entityType: "dispatch_offer", entityId: offerId, requestId, metadata: { reason: reason ?? null } });
  }

  async reassign(input: Readonly<{ orderId: string; courierId: string; actorUserId: string; reason: string; requestId: string | null }>): Promise<void> {
    await this.database.withTransaction(async (client) => {
      const order = await client.query<{ id: string; status: string; user_id: string }>("SELECT id, status, user_id FROM orders WHERE id = $1 FOR UPDATE", [input.orderId]);
      const row = order.rows[0];
      if (!row) throw new NotFoundException("Order not found.");
      if (["DELIVERED", "CANCELLED", "REFUNDED", "FAILED"].includes(row.status)) throw new ConflictException("This order can no longer be reassigned.");
      const courier = await client.query<{ status: string }>("SELECT status FROM courier_profiles WHERE user_id = $1 AND status = 'approved'", [input.courierId]);
      if (!courier.rows[0]) throw new ConflictException("The selected courier is not approved.");
      await client.query("UPDATE delivery_assignments SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $2 WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup')", [row.id, input.reason]);
      await client.query("UPDATE dispatch_offers SET status = 'cancelled', responded_at = now() WHERE order_id = $1 AND status = 'pending'", [row.id]);
      await client.query("UPDATE courier_availability SET active_order_id = NULL, accepting_offers = true WHERE active_order_id = $1", [row.id]);
      const assignment = await client.query<{ id: string }>(
        "INSERT INTO delivery_assignments (order_id, courier_user_id, status, accepted_at) VALUES ($1,$2,'accepted',now()) RETURNING id",
        [row.id, input.courierId]
      );
      await client.query("UPDATE orders SET status = 'COURIER_ASSIGNED', courier_user_id = $2, version = version + 1 WHERE id = $1", [row.id, input.courierId]);
      await client.query("UPDATE courier_availability SET active_order_id = $2, accepting_offers = false, updated_at = now() WHERE courier_user_id = $1", [input.courierId, row.id]);
      await client.query("INSERT INTO order_status_events (order_id, from_status, to_status, actor_user_id, metadata) VALUES ($1,$2,'COURIER_ASSIGNED',$3,$4)", [row.id, row.status, input.actorUserId, JSON.stringify({ note: `Reassigned: ${input.reason}`, assignmentId: assignment.rows[0]?.id })]);
      await this.notifications.create({ userId: row.user_id, type: "order.courier_reassigned", title: "Courier reassigned", body: "A new courier has been assigned to your order.", data: { orderId: row.id } }, client);
      await this.audit.record({ actorUserId: input.actorUserId, action: "dispatch.reassigned", entityType: "order", entityId: row.id, requestId: input.requestId, metadata: { courierId: input.courierId, reason: input.reason } }, client);
    });
  }
}
