import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import { AuditService } from "../../common/audit.service.js";

@Injectable()
export class OperatorService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService) {}

  /** Live snapshot: active deliveries, unassigned orders, courier fleet, delivery exceptions */
  async liveSnapshot() {
    const [activeOrders, unassigned, couriers, exceptions] = await Promise.all([
      this.database.query(`
        SELECT o.id, o.order_number, o.status, o.created_at, o.delivery_estimate_minutes,
               COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name,
               da.courier_user_id,
               cp.full_name AS courier_name, u.phone_e164 AS courier_phone,
               ST_Y(ca.last_location::geometry) AS courier_lat,
               ST_X(ca.last_location::geometry) AS courier_lng,
               ca.last_seen_at AS courier_last_seen,
               EXTRACT(EPOCH FROM (now() - o.created_at))/60 AS age_minutes
        FROM orders o
        JOIN merchants m ON m.id = o.merchant_id
        LEFT JOIN delivery_assignments da ON da.order_id = o.id AND da.status NOT IN ('cancelled','failed','rejected')
        LEFT JOIN courier_profiles cp ON cp.user_id = da.courier_user_id
        LEFT JOIN users u ON u.id = da.courier_user_id
        LEFT JOIN courier_availability ca ON ca.courier_user_id = da.courier_user_id
        WHERE o.status NOT IN ('DELIVERED','CANCELLED','FAILED','REFUNDED','REFUND_PENDING','AWAITING_PAYMENT')
        ORDER BY o.created_at ASC LIMIT 200`),
      this.database.query(`
        SELECT o.id, o.order_number, o.status, o.created_at,
               COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name,
               EXTRACT(EPOCH FROM (now() - o.created_at))/60 AS age_minutes
        FROM orders o
        JOIN merchants m ON m.id = o.merchant_id
        WHERE o.status IN ('CONFIRMED','READY_FOR_PICKUP')
          AND NOT EXISTS (
            SELECT 1 FROM delivery_assignments da
            WHERE da.order_id = o.id AND da.status NOT IN ('cancelled','failed','rejected')
          )
        ORDER BY o.created_at ASC LIMIT 100`),
      this.database.query(`
        SELECT cp.user_id, cp.full_name, u.phone_e164,
               ca.is_online, ca.accepting_offers, ca.last_seen_at, ca.active_order_id,
               ST_Y(ca.last_location::geometry) AS latitude,
               ST_X(ca.last_location::geometry) AS longitude,
               cp.vehicle_type, cp.rating_average, cp.completed_deliveries,
               sz.display_name AS zone_name
        FROM courier_profiles cp
        JOIN users u ON u.id = cp.user_id
        LEFT JOIN courier_availability ca ON ca.courier_user_id = cp.user_id
        LEFT JOIN service_zones sz ON sz.id = cp.service_zone_id
        WHERE cp.status = 'approved' AND ca.is_online = true
        ORDER BY ca.last_seen_at DESC NULLS LAST LIMIT 300`),
      this.database.query(`
        SELECT o.id, o.order_number, o.status, o.created_at, o.delivery_estimate_minutes,
               COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name,
               EXTRACT(EPOCH FROM (now() - o.created_at))/60 AS age_minutes,
               da.courier_user_id, cp.full_name AS courier_name
        FROM orders o
        JOIN merchants m ON m.id = o.merchant_id
        LEFT JOIN delivery_assignments da ON da.order_id = o.id AND da.status NOT IN ('cancelled','failed','rejected')
        LEFT JOIN courier_profiles cp ON cp.user_id = da.courier_user_id
        WHERE o.status NOT IN ('DELIVERED','CANCELLED','FAILED','REFUNDED','REFUND_PENDING','AWAITING_PAYMENT','PENDING_CONFIRMATION')
          AND EXTRACT(EPOCH FROM (now() - o.created_at))/60 > COALESCE(o.delivery_estimate_minutes, 45) * 1.5
        ORDER BY age_minutes DESC LIMIT 50`)
    ]);

    return {
      activeOrders: activeOrders.rows.map(r => ({
        id: r.id as string, orderNumber: r.order_number as string, status: r.status as string,
        merchantName: r.merchant_name as string, ageMinutes: Math.round(Number(r.age_minutes)),
        createdAt: (r.created_at as Date).toISOString(),
        courierUserId: r.courier_user_id as string | null,
        courierName: r.courier_name as string | null,
        courierPhone: r.courier_phone as string | null,
        courierLocation: r.courier_lat !== null
          ? { latitude: Number(r.courier_lat), longitude: Number(r.courier_lng), lastSeenAt: (r.courier_last_seen as Date | null)?.toISOString() ?? null }
          : null,
        deliveryEstimateMinutes: r.delivery_estimate_minutes as number | null
      })),
      unassignedOrders: unassigned.rows.map(r => ({
        id: r.id as string, orderNumber: r.order_number as string, status: r.status as string,
        merchantName: r.merchant_name as string, ageMinutes: Math.round(Number(r.age_minutes)),
        createdAt: (r.created_at as Date).toISOString()
      })),
      couriers: couriers.rows.map(r => ({
        userId: r.user_id as string, fullName: r.full_name as string | null,
        phoneE164: r.phone_e164 as string,
        isOnline: r.is_online as boolean, acceptingOffers: r.accepting_offers as boolean,
        hasActiveOrder: r.active_order_id !== null, zoneName: r.zone_name as string | null,
        vehicleType: r.vehicle_type as string, rating: Number(r.rating_average),
        lastSeenAt: (r.last_seen_at as Date | null)?.toISOString() ?? null,
        location: r.latitude !== null ? { latitude: Number(r.latitude), longitude: Number(r.longitude) } : null
      })),
      exceptions: exceptions.rows.map(r => ({
        id: r.id as string, orderNumber: r.order_number as string, status: r.status as string,
        merchantName: r.merchant_name as string, ageMinutes: Math.round(Number(r.age_minutes)),
        estimateMinutes: r.delivery_estimate_minutes as number | null,
        courierName: r.courier_name as string | null,
        createdAt: (r.created_at as Date).toISOString()
      }))
    };
  }

  /** Manual courier assignment — audit logged, requires operations/admin */
  async manualAssign(actorUserId: string, orderId: string, courierUserId: string, reqId: string | null, allowReassign = false) {
    return this.database.withTransaction(async (client) => {
      const orderResult = await client.query<{ id: string; status: string; user_id: string }>(
        "SELECT id, status, user_id FROM orders WHERE id = $1 FOR UPDATE",
        [orderId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException("Order not found.");
      const assignableStatuses = ["CONFIRMED", "READY_FOR_PICKUP", "PENDING_CONFIRMATION", "PREPARING"];
      if (!assignableStatuses.includes(order.status) && !(allowReassign && order.status === "COURIER_ASSIGNED")) {
        throw new ForbiddenException(`Order in status '${order.status}' cannot be manually assigned.`);
      }

      const courierResult = await client.query<{
        user_id: string; status: string; active_order_id: string | null;
      }>(
        `SELECT cp.user_id, cp.status, ca.active_order_id
         FROM courier_profiles cp JOIN courier_availability ca ON ca.courier_user_id = cp.user_id
         WHERE cp.user_id = $1 FOR UPDATE OF cp, ca`,
        [courierUserId]
      );
      const courier = courierResult.rows[0];
      if (!courier) throw new NotFoundException("Courier or courier availability not found.");
      if (courier.status !== "approved") throw new ForbiddenException("Courier is not approved.");
      if (courier.active_order_id && courier.active_order_id !== orderId) {
        throw new ConflictException("Courier already has an active delivery.");
      }
      const otherAssignment = await client.query(
        `SELECT 1 FROM delivery_assignments
         WHERE courier_user_id = $1 AND order_id <> $2
           AND status IN ('offered','accepted','arrived_pickup','picked_up')
         LIMIT 1 FOR UPDATE`,
        [courierUserId, orderId]
      );
      if ((otherAssignment.rowCount ?? 0) > 0) {
        throw new ConflictException("Courier already has an active delivery assignment.");
      }

      const previousAssignments = await client.query<{ courier_user_id: string }>(
        `SELECT courier_user_id FROM delivery_assignments
         WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup','picked_up') FOR UPDATE`,
        [orderId]
      );
      await client.query(
        "UPDATE dispatch_offers SET status = 'cancelled', responded_at = now() WHERE order_id = $1 AND status = 'pending'",
        [orderId]
      );
      await client.query(
        `UPDATE delivery_assignments SET status = 'cancelled', cancelled_at = now(),
           cancellation_reason = 'Operator assigned a courier'
         WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup','picked_up')`,
        [orderId]
      );
      for (const previous of previousAssignments.rows) {
        await client.query(
          `UPDATE courier_availability SET active_order_id = NULL, accepting_offers = true, updated_at = now()
           WHERE courier_user_id = $1 AND active_order_id = $2 AND courier_user_id <> $3`,
          [previous.courier_user_id, orderId, courierUserId]
        );
      }
      const assignment = await client.query<{ id: string }>(
        `INSERT INTO delivery_assignments (order_id, courier_user_id, status, assigned_at, accepted_at)
         VALUES ($1,$2,'accepted',now(),now()) RETURNING id`,
        [orderId, courierUserId]
      );
      await client.query(
        `UPDATE orders SET status = 'COURIER_ASSIGNED', courier_user_id = $2, version = version + 1
         WHERE id = $1`,
        [orderId, courierUserId]
      );
      await client.query(
        `UPDATE courier_availability SET active_order_id = $1, accepting_offers = false, updated_at = now()
         WHERE courier_user_id = $2`,
        [orderId, courierUserId]
      );
      await client.query(
        `INSERT INTO order_status_events (order_id, from_status, to_status, actor_user_id, metadata)
         VALUES ($1,$2,'COURIER_ASSIGNED',$3,$4)`,
        [orderId, order.status, actorUserId, JSON.stringify({ note: "Courier assigned by operations", courierUserId, assignmentId: assignment.rows[0]?.id })]
      );
      await this.audit.record({
        actorUserId, action: "operator.manual_assign", entityType: "order", entityId: orderId,
        requestId: reqId, metadata: { courierUserId, assignmentId: assignment.rows[0]?.id, previousStatus: order.status }
      }, client);
      return { orderId, courierUserId, assignmentId: assignment.rows[0]?.id, assigned: true };
    });
  }

  /** Reassign order to a different courier, freeing the previous one */
  async reassign(actorUserId: string, orderId: string, newCourierUserId: string, reason: string | null, reqId: string | null) {
    const prev = await this.database.query<{ courier_user_id: string }>(
      "SELECT courier_user_id FROM delivery_assignments WHERE order_id = $1 AND status NOT IN ('cancelled','failed','delivered') LIMIT 1",
      [orderId]
    );
    const oldCourierUserId = prev.rows[0]?.courier_user_id ?? null;

    const result = await this.manualAssign(actorUserId, orderId, newCourierUserId, reqId, true);

    if (oldCourierUserId) {
      await this.database.query(
        "UPDATE courier_availability SET active_order_id = NULL, accepting_offers = true WHERE courier_user_id = $1 AND active_order_id = $2",
        [oldCourierUserId, orderId]
      );
    }
    await this.audit.record({ actorUserId, action: "operator.reassign", entityType: "order", entityId: orderId, requestId: reqId, metadata: { oldCourierUserId, newCourierUserId, reason } });
    return result;
  }

  /** Operator-initiated order cancellation with mandatory reason and permission check */
  async cancelOrder(actorUserId: string, orderId: string, reason: string, reqId: string | null) {
    const order = await this.database.query<{ id: string; status: string; user_id: string }>(
      "SELECT id, status, user_id FROM orders WHERE id = $1", [orderId]
    );
    if (!order.rows[0]) throw new NotFoundException("Order not found.");
    const { status } = order.rows[0];
    if (["DELIVERED", "CANCELLED", "FAILED", "REFUNDED"].includes(status)) {
      throw new ForbiddenException(`Cannot cancel order in '${status}' state.`);
    }
    await this.database.withTransaction(async (client) => {
      await client.query(
        "UPDATE orders SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = $2 WHERE id = $1",
        [orderId, reason]
      );
      await client.query(
        "UPDATE delivery_assignments SET status = 'cancelled' WHERE order_id = $1 AND status NOT IN ('delivered','cancelled','failed')",
        [orderId]
      );
      await client.query(
        "UPDATE dispatch_offers SET status = 'cancelled' WHERE order_id = $1 AND status = 'pending'",
        [orderId]
      );
      await client.query(
        "UPDATE courier_availability SET active_order_id = NULL, accepting_offers = true WHERE active_order_id = $1",
        [orderId]
      );
    });
    await this.audit.record({ actorUserId, action: "operator.cancel_order", entityType: "order", entityId: orderId, requestId: reqId, metadata: { reason, previousStatus: status } });
    return { orderId, cancelled: true };
  }

  /** Full delivery timeline with audit trail for an order */
  async deliveryTimeline(orderId: string) {
    const [order, assignments, auditEntries] = await Promise.all([
      this.database.query(
        `SELECT o.id, o.order_number, o.status, o.created_at, o.delivered_at, o.cancelled_at,
                COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name
         FROM orders o JOIN merchants m ON m.id = o.merchant_id WHERE o.id = $1`,
        [orderId]
      ),
      this.database.query(
        `SELECT da.courier_user_id, cp.full_name AS courier_name, da.status, da.assigned_at,
                da.arrived_pickup_at, da.picked_up_at, da.delivered_at
         FROM delivery_assignments da LEFT JOIN courier_profiles cp ON cp.user_id = da.courier_user_id
         WHERE da.order_id = $1 ORDER BY da.assigned_at ASC`,
        [orderId]
      ),
      this.database.query(
        "SELECT action, actor_user_id, metadata, created_at FROM audit_log WHERE entity_id = $1 ORDER BY created_at ASC LIMIT 100",
        [orderId]
      )
    ]);
    const o = order.rows[0];
    if (!o) throw new NotFoundException("Order not found.");
    return {
      orderId, orderNumber: o.order_number as string, status: o.status as string,
      merchantName: o.merchant_name as string,
      createdAt: (o.created_at as Date).toISOString(),
      deliveredAt: (o.delivered_at as Date | null)?.toISOString() ?? null,
      cancelledAt: (o.cancelled_at as Date | null)?.toISOString() ?? null,
      assignments: assignments.rows.map(r => ({
        courierUserId: r.courier_user_id as string, courierName: r.courier_name as string | null,
        status: r.status as string,
        assignedAt: (r.assigned_at as Date | null)?.toISOString() ?? null,
        arrivedPickupAt: (r.arrived_pickup_at as Date | null)?.toISOString() ?? null,
        pickedUpAt: (r.picked_up_at as Date | null)?.toISOString() ?? null,
        deliveredAt: (r.delivered_at as Date | null)?.toISOString() ?? null
      })),
      auditTrail: auditEntries.rows.map(r => ({
        action: r.action as string, actorUserId: r.actor_user_id as string | null,
        metadata: r.metadata, createdAt: (r.created_at as Date).toISOString()
      }))
    };
  }
}
