import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import { AuditService } from "../../common/audit.service.js";

@Injectable()
export class AdminService {
  constructor(private readonly database: DatabaseService, private readonly audit: AuditService) {}

  async dashboard() {
    const result = await this.database.query<{
      orders_today: number; gmv_today: string; active_orders: number; online_couriers: number;
      pending_merchants: number; pending_couriers: number; open_tickets: number; pending_refunds: number;
      deliveries_today: number; new_users_today: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM orders WHERE created_at::date = current_date) AS orders_today,
        (SELECT COALESCE(sum(total_minor),0)::text FROM orders WHERE created_at::date = current_date AND status NOT IN ('CANCELLED','FAILED')) AS gmv_today,
        (SELECT count(*)::int FROM orders WHERE status NOT IN ('DELIVERED','CANCELLED','FAILED','REFUNDED','REFUND_PENDING')) AS active_orders,
        (SELECT count(*)::int FROM courier_availability WHERE is_online = true) AS online_couriers,
        (SELECT count(*)::int FROM merchants WHERE status = 'pending') AS pending_merchants,
        (SELECT count(*)::int FROM courier_profiles WHERE status = 'pending') AS pending_couriers,
        (SELECT count(*)::int FROM support_tickets WHERE status IN ('OPEN','IN_PROGRESS')) AS open_tickets,
        (SELECT count(*)::int FROM refunds WHERE status = 'PENDING') AS pending_refunds,
        (SELECT count(*)::int FROM orders WHERE status = 'DELIVERED' AND delivered_at::date = current_date) AS deliveries_today,
        (SELECT count(*)::int FROM users WHERE created_at::date = current_date) AS new_users_today`
    );
    const row = result.rows[0];
    return {
      ordersToday: row?.orders_today ?? 0, gmvTodayMinor: Number(row?.gmv_today ?? 0), activeOrders: row?.active_orders ?? 0,
      onlineCouriers: row?.online_couriers ?? 0, pendingMerchants: row?.pending_merchants ?? 0,
      pendingCouriers: row?.pending_couriers ?? 0, openTickets: row?.open_tickets ?? 0,
      pendingRefunds: row?.pending_refunds ?? 0, deliveriesToday: row?.deliveries_today ?? 0, newUsersToday: row?.new_users_today ?? 0
    };
  }

  async merchants(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT m.id, m.slug, m.display_name, m.status, m.rating_average, m.rating_count, m.created_at,
              (SELECT count(*)::int FROM orders o WHERE o.merchant_id = m.id) AS order_count,
              (SELECT u.phone_e164 FROM merchant_members mm JOIN users u ON u.id = mm.user_id WHERE mm.merchant_id = m.id AND mm.role = 'owner' LIMIT 1) AS owner_phone
       FROM merchants m WHERE ($1::text IS NULL OR m.status = $1) ORDER BY m.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, slug: row.slug as string, displayName: row.display_name as string, status: row.status as string,
        rating: Number(row.rating_average), ratingCount: row.rating_count as number, orderCount: row.order_count as number,
        ownerPhone: row.owner_phone as string | null, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async orders(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_minor, o.currency, o.created_at, o.delivered_at,
              COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name, u.phone_e164 AS customer_phone,
              (SELECT u2.phone_e164 FROM delivery_assignments da JOIN users u2 ON u2.id = da.courier_user_id WHERE da.order_id = o.id AND da.status = 'delivered' LIMIT 1) AS courier_phone
       FROM orders o JOIN merchants m ON m.id = o.merchant_id JOIN users u ON u.id = o.user_id
       WHERE ($1::text IS NULL OR o.status = $1)
       ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderNumber: row.order_number as string, status: row.status as string,
        paymentStatus: row.payment_status as string, totalMinor: Number(row.total_minor), currency: row.currency as string,
        merchantName: row.merchant_name as string, customerPhone: row.customer_phone as string | null,
        courierPhone: row.courier_phone as string | null, createdAt: (row.created_at as Date).toISOString(),
        deliveredAt: (row.delivered_at as Date | null)?.toISOString() ?? null
      }))
    };
  }

  async setMerchantStatus(actorUserId: string, merchantId: string, status: "active" | "suspended" | "closed", requestId: string | null) {
    const result = await this.database.query("UPDATE merchants SET status = $2, updated_at = now() WHERE id = $1", [merchantId, status]);
    if (result.rowCount === 0) throw new NotFoundException("Merchant not found.");
    await this.audit.record({ actorUserId, action: `admin.merchant_${status}`, entityType: "merchant", entityId: merchantId, requestId });
    return { merchantId, status };
  }

  async couriers(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT cp.user_id, cp.status, cp.full_name, cp.vehicle_type, cp.vehicle_plate, cp.rating_average, cp.completed_deliveries,
              cp.rejection_reason, cp.created_at, u.phone_e164, ca.is_online,
              (SELECT count(*)::int FROM courier_documents d WHERE d.courier_user_id = cp.user_id AND d.status = 'pending') AS pending_documents
       FROM courier_profiles cp JOIN users u ON u.id = cp.user_id
       LEFT JOIN courier_availability ca ON ca.courier_user_id = cp.user_id
       WHERE ($1::text IS NULL OR cp.status = $1) ORDER BY cp.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        userId: row.user_id as string, status: row.status as string, fullName: row.full_name,
        phoneE164: row.phone_e164, vehicleType: row.vehicle_type, vehiclePlate: row.vehicle_plate,
        rating: Number(row.rating_average), completedDeliveries: row.completed_deliveries as number,
        rejectionReason: row.rejection_reason, isOnline: row.is_online ?? false,
        pendingDocuments: row.pending_documents as number, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async reviewCourier(actorUserId: string, courierUserId: string, decision: "approve" | "reject" | "suspend", reason: string | null, requestId: string | null) {
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "suspended";
    const result = await this.database.query(
      `UPDATE courier_profiles SET status = $2, rejection_reason = $3, approved_by = CASE WHEN $2 = 'approved' THEN $4 ELSE approved_by END,
              approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END, updated_at = now()
       WHERE user_id = $1`,
      [courierUserId, status, decision === "approve" ? null : reason, actorUserId]
    );
    if (result.rowCount === 0) throw new NotFoundException("Courier not found.");
    if (status !== "approved") await this.database.query("UPDATE courier_availability SET is_online = false, accepting_offers = false WHERE courier_user_id = $1", [courierUserId]);
    await this.audit.record({ actorUserId, action: `admin.courier_${status}`, entityType: "courier", entityId: courierUserId, requestId, metadata: { reason } });
    return { courierUserId, status };
  }

  async courierDocuments(courierUserId: string) {
    const result = await this.database.query(
      "SELECT id, document_type, storage_key, status, review_notes, reviewed_at, created_at FROM courier_documents WHERE courier_user_id = $1 ORDER BY created_at DESC",
      [courierUserId]
    );
    return { items: result.rows };
  }

  async reviewDocument(actorUserId: string, documentId: string, status: "approved" | "rejected", notes: string | null, requestId: string | null) {
    const result = await this.database.query(
      "UPDATE courier_documents SET status = $2, review_notes = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING courier_user_id",
      [documentId, status, notes, actorUserId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Document not found.");
    await this.audit.record({ actorUserId, action: `admin.document_${status}`, entityType: "courier_document", entityId: documentId, requestId, metadata: { courierUserId: row.courier_user_id } });
    return { documentId, status };
  }

  async users(search: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT u.id, u.phone_e164, u.email, u.display_name, u.account_status, u.created_at,
              COALESCE(jsonb_agg(DISTINCT ura.role) FILTER (WHERE ura.role IS NOT NULL),'[]'::jsonb) AS roles
       FROM users u LEFT JOIN user_role_assignments ura ON ura.user_id = u.id
       WHERE ($1::text IS NULL OR u.phone_e164 ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
       GROUP BY u.id ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`,
      [search ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, phoneE164: row.phone_e164, email: row.email, displayName: row.display_name,
        accountStatus: row.account_status, roles: row.roles, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async setUserRoles(actorUserId: string, userId: string, roles: readonly string[], requestId: string | null) {
    await this.database.withTransaction(async (client) => {
      await client.query("DELETE FROM user_role_assignments WHERE user_id = $1", [userId]);
      for (const role of roles) {
        await client.query("INSERT INTO user_role_assignments (user_id, role, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [userId, role, actorUserId]);
      }
    });
    await this.audit.record({ actorUserId, action: "admin.user_roles_updated", entityType: "user", entityId: userId, requestId, metadata: { roles } });
    return { userId, roles };
  }

  async setUserStatus(actorUserId: string, userId: string, accountStatus: string, requestId: string | null) {
    const result = await this.database.query("UPDATE users SET account_status = $2, updated_at = now() WHERE id = $1", [userId, accountStatus]);
    if (result.rowCount === 0) throw new NotFoundException("User not found.");
    if (accountStatus !== "active") await this.database.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    await this.audit.record({ actorUserId, action: "admin.user_status_updated", entityType: "user", entityId: userId, requestId, metadata: { accountStatus } });
    return { userId, accountStatus };
  }

  async auditLog(limit: number, offset: number, entityType: string | undefined) {
    const result = await this.database.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id, request_id, metadata, created_at
       FROM audit_log WHERE ($3::text IS NULL OR entity_type = $3) ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset, entityType ?? null]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, actorUserId: row.actor_user_id, action: row.action as string, entityType: row.entity_type as string,
        entityId: row.entity_id, requestId: row.request_id, metadata: row.metadata, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }
}
