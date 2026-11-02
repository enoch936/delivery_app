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
      unassigned_orders: number; available_couriers: number; busy_couriers: number;
      merchants_available: number; collected_payments: string; platform_revenue: string;
      refund_liability: string; total_orders_today: number; cancelled_orders_today: number;
      failed_payments_today: number; total_payments_today: number;
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
        (SELECT count(*)::int FROM users WHERE created_at::date = current_date) AS new_users_today,
        (SELECT count(*)::int FROM orders WHERE status IN ('CONFIRMED','READY_FOR_PICKUP')
          AND NOT EXISTS (SELECT 1 FROM delivery_assignments da WHERE da.order_id = orders.id AND da.status NOT IN ('cancelled','failed','rejected'))) AS unassigned_orders,
        (SELECT count(*)::int FROM courier_availability WHERE is_online = true AND accepting_offers = true) AS available_couriers,
        (SELECT count(*)::int FROM courier_availability WHERE is_online = true AND active_order_id IS NOT NULL) AS busy_couriers,
        (SELECT count(*)::int FROM merchants WHERE status = 'active') AS merchants_available,
        (SELECT COALESCE(sum(amount_minor),0)::text FROM payments WHERE status = 'SUCCEEDED' AND created_at::date = current_date) AS collected_payments,
        (SELECT COALESCE(sum(f.commission_minor),0)::text FROM order_financials f JOIN orders o ON o.id = f.order_id WHERE o.status = 'DELIVERED' AND o.delivered_at::date = current_date) AS platform_revenue,
        (SELECT COALESCE(sum(amount_minor),0)::text FROM refunds WHERE status = 'PENDING') AS refund_liability,
        (SELECT count(*)::int FROM orders WHERE created_at::date = current_date) AS total_orders_today,
        (SELECT count(*)::int FROM orders WHERE status = 'CANCELLED' AND created_at::date = current_date) AS cancelled_orders_today,
        (SELECT count(*)::int FROM payments WHERE status IN ('FAILED','EXPIRED') AND created_at::date = current_date) AS failed_payments_today,
        (SELECT count(*)::int FROM payments WHERE created_at::date = current_date) AS total_payments_today`
    );
    const row = result.rows[0];

    // ordersByStatus — map of status -> count for active orders
    const statusResult = await this.database.query<{ status: string; cnt: number }>(
      `SELECT status, count(*)::int AS cnt FROM orders
       WHERE status NOT IN ('DELIVERED','CANCELLED','FAILED','REFUNDED','REFUND_PENDING')
       GROUP BY status`
    );
    const ordersByStatus: Record<string, number> = {};
    for (const r of statusResult.rows) {
      ordersByStatus[r.status] = r.cnt;
    }

    const pendingCouriers = row?.pending_couriers ?? 0;
    const pendingMerchants = row?.pending_merchants ?? 0;
    const pendingRefunds = row?.pending_refunds ?? 0;
    const openTickets = row?.open_tickets ?? 0;
    const unassignedOrders = row?.unassigned_orders ?? 0;
    const totalOrdersToday = row?.total_orders_today ?? 0;
    const cancelledOrdersToday = row?.cancelled_orders_today ?? 0;
    const failedPaymentsToday = row?.failed_payments_today ?? 0;
    const totalPaymentsToday = row?.total_payments_today ?? 0;

    const operationalAlerts: Array<{ level: string; message: string }> = [];
    if (pendingCouriers > 5) operationalAlerts.push({ level: "warning", message: `${pendingCouriers} courier applications awaiting review` });
    if (pendingMerchants > 3) operationalAlerts.push({ level: "warning", message: `${pendingMerchants} merchant applications awaiting review` });
    if (pendingRefunds > 10) operationalAlerts.push({ level: "critical", message: `${pendingRefunds} refunds pending — review payment reconciliation` });
    if (openTickets > 20) operationalAlerts.push({ level: "info", message: `${openTickets} open support tickets` });
    if (unassignedOrders > 5) operationalAlerts.push({ level: "critical", message: `${unassignedOrders} orders unassigned — dispatch at risk` });

    return {
      ordersToday: row?.orders_today ?? 0,
      gmvTodayMinor: Number(row?.gmv_today ?? 0),
      activeOrders: row?.active_orders ?? 0,
      onlineCouriers: row?.online_couriers ?? 0,
      pendingMerchants,
      pendingCouriers,
      openTickets,
      pendingRefunds,
      deliveriesToday: row?.deliveries_today ?? 0,
      newUsersToday: row?.new_users_today ?? 0,
      ordersByStatus,
      unassignedOrders,
      availableCouriers: row?.available_couriers ?? 0,
      busyCouriers: row?.busy_couriers ?? 0,
      merchantsAvailable: row?.merchants_available ?? 0,
      collectedPaymentsMinor: Number(row?.collected_payments ?? 0),
      platformRevenueMinor: Number(row?.platform_revenue ?? 0),
      refundLiabilityMinor: Number(row?.refund_liability ?? 0),
      cancellationRateToday: totalOrdersToday > 0 ? Math.round((cancelledOrdersToday / totalOrdersToday) * 10000) / 10000 : 0,
      paymentFailureRateToday: totalPaymentsToday > 0 ? Math.round((failedPaymentsToday / totalPaymentsToday) * 10000) / 10000 : 0,
      operationalAlerts
    };
  }

  async operatorOverview(filters: { from?: string; to?: string; citySlug?: string; zoneSlug?: string; merchantId?: string; categorySlug?: string }) {
    const to = filters.to ? new Date(filters.to) : new Date();
    const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Build dynamic filter fragments
    const cityFilter = filters.citySlug ? `AND c.slug = '${filters.citySlug.replace(/'/g, "''")}'` : "";
    const zoneFilter = filters.zoneSlug ? `AND sz.slug = '${filters.zoneSlug.replace(/'/g, "''")}'` : "";
    const merchantFilter = filters.merchantId ? `AND o.merchant_id = '${filters.merchantId.replace(/'/g, "''")}'` : "";
    const categoryFilter = filters.categorySlug ? `AND m.service_category_slug = '${filters.categorySlug.replace(/'/g, "''")}'` : "";

    const [kpiResult, zoneResult, categoryResult] = await Promise.all([
      this.database.query<{
        orders: number; gmv: string; delivered: number; cancelled: number;
        avg_delivery_minutes: string; new_users: number;
      }>(
        `SELECT
          count(o.id)::int AS orders,
          COALESCE(sum(o.total_minor) FILTER (WHERE o.status NOT IN ('CANCELLED','FAILED')),0)::text AS gmv,
          count(o.id) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered,
          count(o.id) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
          COALESCE(avg(EXTRACT(EPOCH FROM (o.delivered_at - o.created_at))/60) FILTER (WHERE o.status = 'DELIVERED'),0)::text AS avg_delivery_minutes,
          (SELECT count(*)::int FROM users WHERE created_at >= $1 AND created_at < $2) AS new_users
         FROM orders o
         JOIN merchants m ON m.id = o.merchant_id
         LEFT JOIN merchant_locations ml ON ml.id = o.merchant_location_id
         LEFT JOIN service_zones sz ON sz.id = ml.service_zone_id
         LEFT JOIN cities c ON c.id = sz.city_id
         WHERE o.created_at >= $1 AND o.created_at < $2
         ${merchantFilter} ${categoryFilter} ${zoneFilter} ${cityFilter}`,
        [from, to]
      ),
      this.database.query(
        `SELECT sz.id, sz.display_name,
                count(o.id)::int AS orders,
                COALESCE(sum(o.total_minor) FILTER (WHERE o.status NOT IN ('CANCELLED','FAILED')),0)::text AS gmv,
                COALESCE(avg(EXTRACT(EPOCH FROM (o.delivered_at - o.created_at))/60) FILTER (WHERE o.status = 'DELIVERED'),0)::text AS avg_delivery_minutes
         FROM service_zones sz
         LEFT JOIN cities c ON c.id = sz.city_id
         LEFT JOIN merchant_locations ml ON ST_Contains(sz.boundary, ml.location::geometry)
         LEFT JOIN orders o ON o.merchant_location_id = ml.id AND o.created_at >= $1 AND o.created_at < $2
           ${merchantFilter} ${categoryFilter}
         WHERE 1=1 ${zoneFilter} ${cityFilter}
         GROUP BY sz.id ORDER BY orders DESC LIMIT 50`,
        [from, to]
      ),
      this.database.query(
        `SELECT sc.slug, sc.display_name,
                count(o.id)::int AS orders,
                COALESCE(sum(o.total_minor) FILTER (WHERE o.status NOT IN ('CANCELLED','FAILED')),0)::text AS gmv
         FROM service_categories sc
         LEFT JOIN merchants m ON m.service_category_slug = sc.slug
         LEFT JOIN orders o ON o.merchant_id = m.id AND o.created_at >= $1 AND o.created_at < $2
           ${merchantFilter}
         WHERE 1=1 ${categoryFilter}
         GROUP BY sc.slug, sc.display_name ORDER BY orders DESC LIMIT 50`,
        [from, to]
      )
    ]);

    const kpi = kpiResult.rows[0];
    const orders = kpi?.orders ?? 0;
    const cancelled = kpi?.cancelled ?? 0;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      filters,
      ordersTotal: orders,
      gmvMinor: Number(kpi?.gmv ?? 0),
      delivered: kpi?.delivered ?? 0,
      cancelled,
      cancellationRate: orders > 0 ? Math.round((cancelled / orders) * 10000) / 10000 : 0,
      avgDeliveryMinutes: Math.round(Number(kpi?.avg_delivery_minutes ?? 0) * 10) / 10,
      newUsers: kpi?.new_users ?? 0,
      zonePerformance: zoneResult.rows.map(r => ({
        zoneId: r.id as string,
        zoneName: r.display_name as string,
        orders: r.orders as number,
        gmvMinor: Number(r.gmv),
        avgDeliveryMinutes: Math.round(Number(r.avg_delivery_minutes) * 10) / 10
      })),
      categoryPerformance: categoryResult.rows.map(r => ({
        categorySlug: r.slug as string,
        categoryName: r.display_name as string,
        orders: r.orders as number,
        gmvMinor: Number(r.gmv)
      }))
    };
  }

  async merchants(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT m.id, m.slug, m.display_name, m.status, m.rating_average, m.rating_count, m.created_at,
              (SELECT count(*)::int FROM orders o WHERE o.merchant_id = m.id) AS order_count,
              (SELECT u.phone_e164 FROM merchant_members mm JOIN users u ON u.id = mm.user_id WHERE mm.merchant_id = m.id AND mm.role = 'owner' LIMIT 1) AS owner_phone,
              m.rejection_reason, m.suspension_reason,
              (SELECT count(*)::int FROM merchant_documents d WHERE d.merchant_id = m.id AND d.status = 'pending') AS pending_documents
       FROM merchants m WHERE ($1::text IS NULL OR m.status = $1) ORDER BY m.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, slug: row.slug as string, displayName: row.display_name as string, status: row.status as string,
        rating: Number(row.rating_average), ratingCount: row.rating_count as number, orderCount: row.order_count as number,
        ownerPhone: row.owner_phone as string | null, createdAt: (row.created_at as Date).toISOString(),
        rejectionReason: row.rejection_reason as string | null, suspensionReason: row.suspension_reason as string | null,
        pendingDocuments: row.pending_documents as number
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

  async setMerchantStatus(actorUserId: string, merchantId: string, status: "active" | "suspended" | "closed", reason: string | null, requestId: string | null) {
    const result = await this.database.query(
      `UPDATE merchants SET status = $2,
              rejection_reason = CASE WHEN $2 = 'closed' THEN COALESCE($3, 'Application rejected by operator.') ELSE NULL END,
              suspension_reason = CASE WHEN $2 = 'suspended' THEN $3 ELSE NULL END,
              updated_at = now()
       WHERE id = $1 RETURNING id`,
      [merchantId, status, reason]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Merchant not found.");
    await this.audit.record({ actorUserId, action: `admin.merchant_${status}`, entityType: "merchant", entityId: merchantId, requestId, metadata: { reason } });
    return { merchantId, status, rejectionReason: status === "closed" ? reason ?? "Application rejected by operator." : null, suspensionReason: status === "suspended" ? reason : null };
  }

  async merchantDocuments(merchantId: string) {
    const result = await this.database.query(
      `SELECT id, merchant_id, document_type, storage_key, status, review_notes, reviewed_at, created_at
       FROM merchant_documents WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [merchantId]
    );
    return { items: result.rows.map((row) => ({
      id: row.id as string, merchantId: row.merchant_id as string, documentType: row.document_type as string,
      storageKey: row.storage_key as string, status: row.status as string, reviewNotes: row.review_notes as string | null,
      reviewedAt: (row.reviewed_at as Date | null)?.toISOString() ?? null, createdAt: (row.created_at as Date).toISOString()
    })) };
  }

  async reviewMerchantDocument(actorUserId: string, documentId: string, status: "approved" | "rejected", notes: string | null, requestId: string | null) {
    const result = await this.database.query(
      "UPDATE merchant_documents SET status = $2, review_notes = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING merchant_id",
      [documentId, status, notes, actorUserId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Document not found.");
    await this.audit.record({ actorUserId, action: `admin.merchant_document_${status}`, entityType: "merchant_document", entityId: documentId, requestId, metadata: { merchantId: row.merchant_id as string, notes } });
    return { documentId, status };
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

  async operators(limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT u.id, u.phone_e164, u.display_name, u.account_status, u.created_at,
              COALESCE(jsonb_agg(DISTINCT ura.role) FILTER (WHERE ura.role IS NOT NULL),'[]'::jsonb) AS roles,
              (SELECT count(*)::int FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.access_expires_at > now()) AS active_sessions
       FROM users u JOIN user_role_assignments ura ON ura.user_id = u.id
       WHERE ura.role IN ('admin','support','operations','finance','business_admin')
       GROUP BY u.id ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return { items: result.rows.map(row => ({
      id: row.id as string, phoneE164: row.phone_e164 as string, displayName: row.display_name as string | null,
      accountStatus: row.account_status as string, roles: row.roles as string[],
      activeSessions: row.active_sessions as number, createdAt: (row.created_at as Date).toISOString()
    })) };
  }

  async createOperator(actorUserId: string, input: { phoneE164: string; displayName?: string; roles: string[] }, reqId: string | null) {
    const userResult = await this.database.query<{ id: string }>(
      "SELECT id FROM users WHERE phone_e164 = $1", [input.phoneE164]
    );
    const userId = userResult.rows[0]?.id;
    if (!userId) throw new NotFoundException("User not found. Ask the staff member to create an account first.");
    if (input.displayName) {
      await this.database.query("UPDATE users SET display_name = $2 WHERE id = $1", [userId, input.displayName]);
    }
    await this.database.withTransaction(async (client) => {
      await client.query("DELETE FROM user_role_assignments WHERE user_id = $1 AND role IN ('admin','support','operations','finance','business_admin')", [userId]);
      for (const role of input.roles) {
        await client.query("INSERT INTO user_role_assignments (user_id, role, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [userId, role, actorUserId]);
      }
    });
    await this.audit.record({ actorUserId, action: "admin.operator_created", entityType: "user", entityId: userId, requestId: reqId, metadata: { roles: input.roles } });
    return { userId, roles: input.roles };
  }

  async revokeOperatorSessions(actorUserId: string, userId: string, reqId: string | null) {
    const result = await this.database.query(
      "UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id", [userId]
    );
    await this.audit.record({ actorUserId, action: "admin.sessions_revoked", entityType: "user", entityId: userId, requestId: reqId, metadata: { sessionsRevoked: result.rowCount } });
    return { userId, sessionsRevoked: result.rowCount ?? 0 };
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
