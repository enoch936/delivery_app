import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import { AuditService } from "../../common/audit.service.js";
import { OrdersService } from "../orders/orders.service.js";

type Membership = Readonly<{ merchantId: string; role: "owner" | "manager" | "staff"; merchantName: string; commissionBps: number }>;

type MerchantRow = Readonly<{
  id: string; slug: string; display_name: string; description: string | null; logo_url: string | null;
  status: string; commission_bps: number; delivery_radius_km: number; cancellation_policy: string | null;
  refund_policy: string | null; min_schedule_lead_minutes: number; max_schedule_days: number;
  rejection_reason: string | null; suspension_reason: string | null;
}>;

type MerchantDocumentRow = Readonly<{
  id: string; merchant_id: string; document_type: string; storage_key: string; status: string;
  review_notes: string | null; reviewed_at: Date | null; created_at: Date;
}>;

@Injectable()
export class MerchantService {
  constructor(private readonly database: DatabaseService, private readonly orders: OrdersService, private readonly audit: AuditService) {}

  async membership(userId: string): Promise<Membership> {
    const result = await this.database.query<{ merchant_id: string; role: "owner" | "manager" | "staff"; display_name: string; commission_bps: number }>(
      `SELECT mm.merchant_id, mm.role, m.display_name, m.commission_bps
       FROM merchant_members mm JOIN merchants m ON m.id = mm.merchant_id
       WHERE mm.user_id = $1 ORDER BY CASE mm.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) throw new ForbiddenException("You are not a member of a merchant account.");
    return { merchantId: row.merchant_id, role: row.role, merchantName: row.display_name, commissionBps: row.commission_bps };
  }

  async me(userId: string) {
    const membership = await this.membership(userId);
    const [merchant, locations, categories, stats] = await Promise.all([
      this.database.query<MerchantRow>(
        `SELECT id, slug, display_name, description, logo_url, status, commission_bps, delivery_radius_km,
                cancellation_policy, refund_policy, min_schedule_lead_minutes, max_schedule_days,
                rejection_reason, suspension_reason
         FROM merchants WHERE id = $1`, [membership.merchantId]
      ),
      this.database.query(
        `SELECT id, name, address_line, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude, opening_hours, is_active
         FROM merchant_locations WHERE merchant_id = $1 ORDER BY created_at`, [membership.merchantId]
      ),
      this.database.query("SELECT id, slug, display_name, sort_order FROM product_categories WHERE merchant_id = $1 ORDER BY sort_order, display_name", [membership.merchantId]),
      this.database.query<{ today_orders: number; pending_orders: number; revenue_today: string }>(
        `SELECT count(*) FILTER (WHERE created_at::date = current_date)::int AS today_orders,
                count(*) FILTER (WHERE status IN ('PENDING_CONFIRMATION','AWAITING_PAYMENT','CONFIRMED'))::int AS pending_orders,
                COALESCE(sum(items_subtotal_minor) FILTER (WHERE created_at::date = current_date AND status NOT IN ('CANCELLED','FAILED')),0)::text AS revenue_today
         FROM orders WHERE merchant_id = $1`, [membership.merchantId]
      )
    ]);
    const row = merchant.rows[0];
    if (!row) throw new NotFoundException("Merchant not found.");
    return {
      merchant: {
        id: row.id, slug: row.slug, displayName: row.display_name, description: row.description, logoUrl: row.logo_url, status: row.status, commissionBps: row.commission_bps,
        deliveryRadiusKm: row.delivery_radius_km, cancellationPolicy: row.cancellation_policy, refundPolicy: row.refund_policy,
        minScheduleLeadMinutes: row.min_schedule_lead_minutes, maxScheduleDays: row.max_schedule_days,
        rejectionReason: row.rejection_reason, suspensionReason: row.suspension_reason
      },
      membership: { role: membership.role },
      locations: locations.rows.map((location) => ({
        id: location.id as string, name: location.name as string, addressLine: location.address_line as string,
        latitude: location.latitude === null ? null : Number(location.latitude), longitude: location.longitude === null ? null : Number(location.longitude),
        openingHours: location.opening_hours, isActive: location.is_active as boolean
      })),
      categories: categories.rows,
      stats: { todayOrders: stats.rows[0]?.today_orders ?? 0, pendingOrders: stats.rows[0]?.pending_orders ?? 0, revenueTodayMinor: Number(stats.rows[0]?.revenue_today ?? 0) }
    };
  }

  async updateMerchant(userId: string, input: Readonly<{ displayName?: string | undefined; description?: string | undefined; logoUrl?: string | undefined; commissionBps?: number | undefined; deliveryRadiusKm?: number | undefined; cancellationPolicy?: string | undefined; refundPolicy?: string | undefined }>) {
    const membership = await this.requireManager(userId);
    await this.database.query(
      `UPDATE merchants SET display_name = COALESCE($2, display_name), description = COALESCE($3, description), logo_url = COALESCE($4, logo_url),
              commission_bps = COALESCE($5, commission_bps), delivery_radius_km = COALESCE($6, delivery_radius_km),
              cancellation_policy = COALESCE($7, cancellation_policy), refund_policy = COALESCE($8, refund_policy), updated_at = now()
       WHERE id = $1`,
      [membership.merchantId, input.displayName ?? null, input.description ?? null, input.logoUrl ?? null, input.commissionBps ?? null, input.deliveryRadiusKm ?? null, input.cancellationPolicy ?? null, input.refundPolicy ?? null]
    );
    return this.me(userId);
  }

  async setLocationHours(userId: string, locationId: string, openingHours: Record<string, unknown>) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query("UPDATE merchant_locations SET opening_hours = $2, updated_at = now() WHERE id = $1 AND merchant_id = $3", [locationId, openingHours, membership.merchantId]);
    if (result.rowCount === 0) throw new NotFoundException("Location not found.");
    return { locationId, openingHours };
  }

  async documents(userId: string) {
    const membership = await this.membership(userId);
    const result = await this.database.query<MerchantDocumentRow>(
      `SELECT id, merchant_id, document_type, storage_key, status, review_notes, reviewed_at, created_at
       FROM merchant_documents WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [membership.merchantId]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, merchantId: row.merchant_id as string, documentType: row.document_type as string,
        storageKey: row.storage_key as string, status: row.status as string, reviewNotes: row.review_notes as string | null,
        reviewedAt: (row.reviewed_at as Date | null)?.toISOString() ?? null, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async addDocument(userId: string, input: Readonly<{ documentType: string; storageKey: string }>) {
    const membership = await this.membership(userId);
    const result = await this.database.query<{ id: string; merchant_id: string; document_type: string; storage_key: string; status: string; created_at: Date }>(
      `INSERT INTO merchant_documents (merchant_id, document_type, storage_key, status) VALUES ($1,$2,$3,'pending') RETURNING id, merchant_id, document_type, storage_key, status, created_at`,
      [membership.merchantId, input.documentType, input.storageKey]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Merchant document upload failed.");
    return { id: row.id, merchantId: row.merchant_id, documentType: row.document_type, storageKey: row.storage_key, status: row.status, createdAt: row.created_at.toISOString() };
  }

  async setLocationActive(userId: string, locationId: string, active: boolean) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query("UPDATE merchant_locations SET is_active = $3 WHERE id = $1 AND merchant_id = $2", [locationId, membership.merchantId, active]);
    if (result.rowCount === 0) throw new NotFoundException("Location not found.");
    return { locationId, isActive: active };
  }

  async listOrders(userId: string, status: string | undefined, limit: number, offset: number) {
    const membership = await this.membership(userId);
    const result = await this.database.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_minor, o.currency, o.created_at, o.delivery_estimate_minutes,
              COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name,
              COALESCE(o.delivery_address_snapshot->>'addressLine', ca.address_line) AS delivery_address,
              (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN customer_addresses ca ON ca.id = o.delivery_address_id
       WHERE o.merchant_id = $1 AND ($2::text IS NULL OR o.status = $2)
       ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,
      [membership.merchantId, status ?? null, limit, offset]
    );
    const total = await this.database.query<{ count: number }>("SELECT count(*)::int AS count FROM orders WHERE merchant_id = $1 AND ($2::text IS NULL OR status = $2)", [membership.merchantId, status ?? null]);
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderNumber: row.order_number as string, status: row.status as string,
        paymentStatus: row.payment_status as string, totalMinor: Number(row.total_minor), currency: row.currency as string,
        deliveryAddress: row.delivery_address as string | null, itemCount: row.item_count as number,
        deliveryEstimateMinutes: row.delivery_estimate_minutes as number | null, createdAt: (row.created_at as Date).toISOString()
      })),
      total: total.rows[0]?.count ?? 0
    };
  }

  async orderDetail(userId: string, orderId: string) {
    await this.membership(userId);
    return this.orders.detail(orderId, { userId, roles: ["merchant_staff"] });
  }

  async transition(userId: string, orderId: string, action: "accept" | "prepare" | "ready" | "reject", reason: string | undefined, requestIdValue: string | null) {
    const membership = await this.membership(userId);
    const owned = await this.database.query("SELECT 1 FROM orders WHERE id = $1 AND merchant_id = $2", [orderId, membership.merchantId]);
    if ((owned.rowCount ?? 0) === 0) throw new NotFoundException("Order not found.");
    return this.orders.merchantTransition({ orderId, actorUserId: userId, action, reason, requestId: requestIdValue, ipHash: null });
  }

  async menu(userId: string) {
    const membership = await this.membership(userId);
    const [categories, products] = await Promise.all([
      this.database.query("SELECT id, slug, display_name, sort_order FROM product_categories WHERE merchant_id = $1 AND archived_at IS NULL ORDER BY sort_order", [membership.merchantId]),
      this.database.query(
        `SELECT p.id, p.category_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, p.prep_minutes, p.archived_at,
                COALESCE(i.quantity_available, 0) AS quantity_available
         FROM products p LEFT JOIN inventory i ON i.product_id = p.id
         WHERE p.merchant_id = $1 AND p.archived_at IS NULL ORDER BY p.display_name`, [membership.merchantId]
      )
    ]);
    return {
      categories: categories.rows.map((row) => ({ id: row.id as string, slug: row.slug as string, displayName: row.display_name as string, sortOrder: row.sort_order as number })),
      products: products.rows.map((row) => ({
        id: row.id as string, categoryId: row.category_id as string | null, sku: row.sku as string | null,
        displayName: row.display_name as string, description: row.description as string | null, imageUrl: row.image_url as string | null,
        basePriceMinor: Number(row.base_price_minor), currency: row.currency as string, isAvailable: row.is_available as boolean,
        quantityAvailable: row.quantity_available as number, prepMinutes: row.prep_minutes as number, archivedAt: (row.archived_at as Date | null)?.toISOString() ?? null
      }))
    };
  }

  async createCategory(userId: string, input: Readonly<{ slug: string; displayName: string; sortOrder: number }>) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO product_categories (merchant_id, slug, display_name, sort_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (merchant_id, slug) DO UPDATE SET display_name = EXCLUDED.display_name, sort_order = EXCLUDED.sort_order RETURNING id`,
      [membership.merchantId, input.slug, input.displayName, input.sortOrder]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Category create failed.");
    await this.recordAudit(userId, "merchant.category_create", "product_category", row.id, null, { slug: input.slug });
    return { id: row.id };
  }

  async archiveCategory(userId: string, categoryId: string, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query("UPDATE product_categories SET archived_at = now() WHERE id = $1 AND merchant_id = $2 AND archived_at IS NULL RETURNING id", [categoryId, membership.merchantId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Category not found.");
    await this.recordAudit(userId, "merchant.category_archive", "product_category", categoryId, requestId, { archived: true });
    return { id: row.id, archived: true };
  }

  async createProduct(userId: string, input: Readonly<{ categoryId?: string | undefined; sku?: string | undefined; displayName: string; description?: string | undefined; imageUrl?: string | undefined; basePriceMinor: number; currency: string; initialStock?: number | undefined }>) {
    const membership = await this.requireManager(userId);
    return this.database.withTransaction(async (client) => {
      if (input.categoryId) {
        const category = await client.query("SELECT 1 FROM product_categories WHERE id = $1 AND merchant_id = $2", [input.categoryId, membership.merchantId]);
        if ((category.rowCount ?? 0) === 0) throw new NotFoundException("Category not found.");
      }
      const product = await client.query<{ id: string }>(
        `INSERT INTO products (merchant_id, category_id, sku, display_name, description, image_url, base_price_minor, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [membership.merchantId, input.categoryId ?? null, input.sku ?? null, input.displayName, input.description ?? null, input.imageUrl ?? null, input.basePriceMinor, input.currency]
      );
      const id = product.rows[0]?.id;
      if (!id) throw new Error("Product creation failed.");
      await client.query("INSERT INTO inventory (product_id, quantity_available) VALUES ($1,$2)", [id, input.initialStock ?? 0]);
      return { id };
    });
  }

  async updateProduct(userId: string, productId: string, input: Readonly<{ displayName?: string | undefined; description?: string | undefined; imageUrl?: string | undefined; basePriceMinor?: number | undefined; isAvailable?: boolean | undefined; categoryId?: string | undefined; prepMinutes?: number | undefined; archived?: boolean | undefined }>, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query(
      `UPDATE products SET display_name = COALESCE($3, display_name), description = COALESCE($4, description),
              image_url = COALESCE($5, image_url), base_price_minor = COALESCE($6, base_price_minor),
              is_available = COALESCE($7, is_available), category_id = COALESCE($8, category_id), prep_minutes = COALESCE($9, prep_minutes),
              archived_at = CASE WHEN $10::boolean IS TRUE THEN now() WHEN $10::boolean IS FALSE THEN NULL ELSE archived_at END,
              updated_at = now()
       WHERE id = $1 AND merchant_id = $2`,
      [productId, membership.merchantId, input.displayName ?? null, input.description ?? null, input.imageUrl ?? null, input.basePriceMinor ?? null, input.isAvailable ?? null, input.categoryId ?? null, input.prepMinutes ?? null, input.archived ?? null]
    );
    if (result.rowCount === 0) throw new NotFoundException("Product not found.");
    await this.recordAudit(userId, "merchant.product_update", "product", productId, requestId, { prepMinutes: input.prepMinutes ?? null, archived: input.archived ?? null });
    return { updated: true };
  }

  async archiveProduct(userId: string, productId: string, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query("UPDATE products SET archived_at = now() WHERE id = $1 AND merchant_id = $2 AND archived_at IS NULL RETURNING id", [productId, membership.merchantId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Product not found.");
    await this.recordAudit(userId, "merchant.product_archive", "product", productId, requestId, { archived: true });
    return { productId, archived: true };
  }

  async restoreProduct(userId: string, productId: string, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query("UPDATE products SET archived_at = NULL WHERE id = $1 AND merchant_id = $2 RETURNING id", [productId, membership.merchantId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Product not found.");
    await this.recordAudit(userId, "merchant.product_restore", "product", productId, requestId, { archived: false });
    return { productId, archived: false };
  }

  async updateCategory(userId: string, categoryId: string, input: Readonly<{ displayName?: string | undefined; sortOrder?: number | undefined }>, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query(
      `UPDATE product_categories SET display_name = COALESCE($2, display_name), sort_order = COALESCE($3, sort_order) WHERE id = $1 AND merchant_id = $4 RETURNING id`,
      [categoryId, input.displayName ?? null, input.sortOrder ?? null, membership.merchantId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Category not found.");
    await this.recordAudit(userId, "merchant.category_update", "product_category", categoryId, requestId, { displayName: input.displayName ?? null, sortOrder: input.sortOrder ?? null });
    return { id: row.id };
  }

  async bulkImport(userId: string, items: ReadonlyArray<Readonly<{ displayName: string; basePriceMinor: number; currency: string; categoryId?: string | undefined; sku?: string | undefined; description?: string | undefined; imageUrl?: string | undefined; initialStock?: number | undefined }>>, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const created: string[] = [];
    const failed: Array<{ sku: string | null; displayName: string; error: string }> = [];
    await this.database.withTransaction(async (client) => {
      for (const item of items) {
        if (!item.displayName || item.displayName.length < 1 || item.displayName.length > 160) { failed.push({ sku: item.sku ?? null, displayName: item.displayName, error: "displayName must be 1-160 characters." }); continue; }
        if (!Number.isFinite(item.basePriceMinor) || item.basePriceMinor < 0) { failed.push({ sku: item.sku ?? null, displayName: item.displayName, error: "basePriceMinor must be a positive number." }); continue; }
        const category = item.categoryId
          ? await client.query("SELECT 1 FROM product_categories WHERE id = $1 AND merchant_id = $2 AND archived_at IS NULL", [item.categoryId, membership.merchantId])
          : null;
        if (item.categoryId && (category?.rowCount ?? 0) === 0) { failed.push({ sku: item.sku ?? null, displayName: item.displayName, error: "Category not found." }); continue; }
        const insert = await client.query<{ id: string }>(
          `INSERT INTO products (merchant_id, category_id, sku, display_name, description, image_url, base_price_minor, currency)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [membership.merchantId, category?.rows[0] ? category.rows[0].id as string : null, item.sku ?? null, item.displayName, item.description ?? null, item.imageUrl ?? null, item.basePriceMinor, item.currency]
        );
        const id = insert.rows[0]?.id;
        if (!id) { failed.push({ sku: item.sku ?? null, displayName: item.displayName, error: "Insert failed." }); continue; }
        await client.query("INSERT INTO inventory (product_id, quantity_available) VALUES ($1,$2) ON CONFLICT (product_id) DO UPDATE SET quantity_available = $2, updated_at = now()", [id, item.initialStock ?? 0]);
        created.push(id);
      }
    });
    for (const id of created) await this.recordAudit(userId, "merchant.product_bulk_create", "product", id, requestId, { count: created.length });
    return { created: created.length, failed };
  }

  async bulkArchive(userId: string, productIds: ReadonlyArray<string>, requestId: string | null) {
    const membership = await this.requireManager(userId);
    if (productIds.length === 0) return { archived: 0 };
    const result = await this.database.query("UPDATE products SET archived_at = now() WHERE id = ANY($2) AND merchant_id = $1 AND archived_at IS NULL", [membership.merchantId, productIds]);
    await this.recordAudit(userId, "merchant.product_bulk_archive", "product", null, requestId, { count: result.rowCount ?? 0, ids: productIds });
    return { archived: result.rowCount ?? 0 };
  }

  async exportProducts(userId: string) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query(
      `SELECT p.id, p.category_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, p.prep_minutes, p.archived_at, i.quantity_available
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.merchant_id = $1 AND p.archived_at IS NULL`,
      [membership.merchantId]
    );
    return { items: result.rows.map((row) => ({
      id: row.id as string, categoryId: row.category_id as string | null, sku: row.sku as string | null,
      displayName: row.display_name as string, description: row.description as string | null, imageUrl: row.image_url as string | null,
      basePriceMinor: Number(row.base_price_minor), currency: row.currency as string, isAvailable: row.is_available as boolean,
      prepMinutes: row.prep_minutes as number, quantityAvailable: row.quantity_available as number | null
    })) };
  }

  async setInventory(userId: string, productId: string, quantity: number) {
    const membership = await this.requireManager(userId);
    const product = await this.database.query("SELECT 1 FROM products WHERE id = $1 AND merchant_id = $2", [productId, membership.merchantId]);
    if ((product.rowCount ?? 0) === 0) throw new NotFoundException("Product not found.");
    await this.database.query(
      `INSERT INTO inventory (product_id, quantity_available) VALUES ($1,$2)
       ON CONFLICT (product_id) DO UPDATE SET quantity_available = $2, updated_at = now()`,
      [productId, quantity]
    );
    return { productId, quantityAvailable: quantity };
  }

  async settlements(userId: string, limit: number, offset: number) {
    const membership = await this.membership(userId);
    const result = await this.database.query(
      `SELECT id, period_start, period_end, gross_sales_minor, commission_minor, net_payable_minor, currency, status, paid_at, created_at
       FROM merchant_settlements WHERE merchant_id = $1 ORDER BY period_end DESC LIMIT $2 OFFSET $3`,
      [membership.merchantId, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, periodStart: (row.period_start as Date).toISOString(), periodEnd: (row.period_end as Date).toISOString(),
        grossMinor: Number(row.gross_sales_minor), commissionMinor: Number(row.commission_minor), netPayableMinor: Number(row.net_payable_minor),
        currency: row.currency as string, status: row.status as string, paidAt: (row.paid_at as Date | null)?.toISOString() ?? null
      }))
    };
  }

  async salesSummary(userId: string, days: number) {
    const membership = await this.membership(userId);
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const to = now;
    const merchantRow = await this.database.query<{ display_name: string; commission_bps: number; currency: string }>(
      `SELECT display_name, commission_bps, currency FROM merchants WHERE id = $1`, [membership.merchantId]
    );
    const merchant = merchantRow.rows[0];
    const commissionBps = membership.commissionBps;

    const [orders, refunds, tips, prep] = await Promise.all([
      this.database.query<{
        orders: number; delivered: number; cancelled: number; accepted: number;
        gross_minor: string; delivery_fee_minor: string; service_fee_minor: string; tax_minor: string;
      }>(
        `SELECT count(*)::int AS orders,
                count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
                count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
                count(*) FILTER (WHERE accepted_at IS NOT NULL AND accepted_at >= $2 AND accepted_at < $3)::int AS accepted,
                COALESCE(sum(items_subtotal_minor) FILTER (WHERE status NOT IN ('CANCELLED','FAILED')),0)::text AS gross_minor,
                COALESCE(sum(delivery_fee_minor) FILTER (WHERE status <> 'CANCELLED' AND status <> 'FAILED'),0)::text AS delivery_fee_minor,
                COALESCE(sum(service_fee_minor) FILTER (WHERE status <> 'CANCELLED' AND status <> 'FAILED'),0)::text AS service_fee_minor,
                COALESCE(sum(tax_minor) FILTER (WHERE status <> 'CANCELLED' AND status <> 'FAILED'),0)::text AS tax_minor
           FROM orders WHERE merchant_id = $1 AND created_at >= $2 AND created_at < $3`,
        [membership.merchantId, from, to]
      ),
      this.database.query<{ total: string; count: number }>(
        `SELECT COALESCE(sum(r.amount_minor),0)::text AS total, count(*)::int AS count
           FROM refunds r JOIN orders o ON o.id = r.order_id
          WHERE o.merchant_id = $1 AND r.created_at >= $2 AND r.created_at < $3 AND r.status = 'SUCCEEDED'`,
        [membership.merchantId, from, to]
      ),
      this.database.query<{ tips: string }>(
        `SELECT COALESCE(sum(f.tip_minor),0)::text AS tips
           FROM order_financials f JOIN orders o ON o.id = f.order_id
          WHERE o.merchant_id = $1 AND o.created_at >= $2 AND o.created_at < $3`,
        [membership.merchantId, from, to]
      ),
      this.database.query<{ avg_prep_minutes: string }>(
        `SELECT COALESCE(avg(EXTRACT(EPOCH FROM (ready.ready_at - o.accepted_at)) / 60.0),0)::text AS avg_prep_minutes
           FROM orders o
          CROSS JOIN LATERAL (
            SELECT (SELECT e.created_at FROM order_status_events e WHERE e.order_id = o.id AND e.to_status = 'READY_FOR_PICKUP' ORDER BY e.created_at DESC LIMIT 1) AS ready_at
          ) ready
          WHERE o.merchant_id = $1 AND o.accepted_at IS NOT NULL AND o.accepted_at >= $2 AND o.accepted_at < $3 AND ready.ready_at IS NOT NULL`,
        [membership.merchantId, from, to]
      )
    ]);

    const order = orders.rows[0];
    const grossMinor = Number(order?.gross_minor ?? 0);
    const commissionMinor = Math.round((grossMinor * commissionBps) / 10000);
    const refundsMinor = Number(refunds.rows[0]?.total ?? 0);
    const received = order?.orders ?? 0;
    const accepted = order?.accepted ?? 0;

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      currency: merchant?.currency ?? "ETB",
      commissionBps,
      orders: {
        received,
        accepted,
        delivered: order?.delivered ?? 0,
        cancelled: order?.cancelled ?? 0,
        acceptanceRate: received > 0 ? Math.round((accepted / received) * 1000) / 10 : 0,
        avgPrepMinutes: Math.round(Number(prep.rows[0]?.avg_prep_minutes ?? 0) * 10) / 10
      },
      grossSalesMinor: grossMinor,
      deliveryFeesMinor: Number(order?.delivery_fee_minor ?? 0),
      serviceFeesMinor: Number(order?.service_fee_minor ?? 0),
      taxMinor: Number(order?.tax_minor ?? 0),
      tipsMinor: Number(tips.rows[0]?.tips ?? 0),
      refundsMinor,
      commissionMinor,
      netAfterCommissionMinor: grossMinor - commissionMinor - refundsMinor,
      averageOrderMinor: received > 0 ? Math.round((grossMinor / received) * 100) / 100 : 0,
      calculationRules: {
        currency: merchant?.currency ?? "ETB",
        commissionBps,
        commissionRatePercent: Math.round((commissionBps / 10000) * 1000) / 10,
        grossSalesFormula: "sum(items_subtotal_minor) over orders created in the period excluding CANCELLED/FAILED",
        commissionFormula: "grossSalesMinor * (commissionBps / 10000)",
        netFormula: "grossSalesMinor - commissionMinor - refundsMinor",
        refundFormula: "sum(refunds.amount_minor) where status = SUCCEEDED for merchant orders created in the period",
        averageOrderFormula: "grossSalesMinor / orders received in the period"
      }
    };
  }

  async productPerformance(userId: string, days: number) {
    const membership = await this.membership(userId);
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const to = now;
    const result = await this.database.query(
      `SELECT oi.product_id AS product_id, oi.display_name AS display_name, p.category_id AS category_id,
              COALESCE(pc.display_name, 'Uncategorised') AS category_label,
              SUM(oi.quantity)::int AS quantity, SUM(oi.line_total_minor)::int AS revenue_minor
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE o.merchant_id = $1 AND o.created_at >= $2 AND o.created_at < $3
          AND o.status NOT IN ('CANCELLED','FAILED','REFUNDED')
        GROUP BY oi.product_id, oi.display_name, p.category_id, pc.display_name
        ORDER BY revenue_minor DESC`,
      [membership.merchantId, from, to]
    );
    const items = result.rows.map((row) => ({
      productId: row.product_id as string,
      displayName: row.display_name as string,
      categoryLabel: (row.category_label as string) ?? null,
      quantity: row.quantity as number,
      revenueMinor: Number(row.revenue_minor),
      sharePercent: 0
    }));
    const grossSalesMinor = items.reduce((sum, item) => sum + item.revenueMinor, 0);
    return {
      days,
      currency: "ETB",
      grossSalesMinor,
      items: items.map((item) => ({ ...item, sharePercent: grossSalesMinor > 0 ? Math.round(((item.revenueMinor / grossSalesMinor) * 100) * 10) / 10 : 0 })),
      bestSellers: [...items].sort((a, b) => b.quantity - a.quantity).slice(0, 5).map((item) => ({
        productId: item.productId, displayName: item.displayName, quantity: item.quantity, revenueMinor: item.revenueMinor
      }))
    };
  }

  async merchantReviews(userId: string, limit: number, offset: number) {
    const membership = await this.membership(userId);
    const [summary, items] = await Promise.all([
      this.database.query<{ average: string; count: number; distribution: Record<string, unknown> }>(
        `SELECT COALESCE(round(avg(merchant_rating)::numeric,2),0)::text AS average, count(*)::int AS count,
                jsonb_object_agg(merchant_rating, cnt) AS distribution
           FROM (SELECT merchant_rating, count(*)::int AS cnt FROM reviews WHERE merchant_id = $1 GROUP BY merchant_rating) x`,
        [membership.merchantId]
      ),
      this.database.query(
        `SELECT r.id, r.merchant_rating, r.courier_rating, r.comment, r.created_at, u.display_name AS customer_name
           FROM reviews r JOIN users u ON u.id = r.user_id
          WHERE r.merchant_id = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
        [membership.merchantId, limit, offset]
      )
    ]);
    const summaryRow = summary.rows[0];
    const distribution: Record<string, number> = {};
    const rawDistribution = summaryRow?.distribution;
    if (rawDistribution && typeof rawDistribution === "object") {
      for (const [key, value] of Object.entries(rawDistribution as Record<string, unknown>)) distribution[key] = Number(value);
    }
    return {
      average: Number(summaryRow?.average ?? 0), count: summaryRow?.count ?? 0, distribution,
      items: items.rows.map((row) => ({
        id: row.id as string, merchantRating: row.merchant_rating as number, courierRating: row.courier_rating as number | null,
        comment: row.comment as string | null, customerName: row.customer_name as string | null,
        createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async salesCsv(userId: string, days: number): Promise<string> {
    const membership = await this.membership(userId);
    const summary = await this.salesSummary(userId, days);
    const from = new Date(summary.period.from);
    const to = new Date(summary.period.to);
    const result = await this.database.query(
      `SELECT date_trunc('day', o.created_at)::date AS day,
              count(*)::int AS orders,
              COALESCE(sum(o.items_subtotal_minor) FILTER (WHERE o.status NOT IN ('CANCELLED','FAILED')),0)::text AS gross_minor,
              COALESCE(sum(o.total_minor) FILTER (WHERE o.status NOT IN ('CANCELLED','FAILED')),0)::text AS total_minor
         FROM orders o
        WHERE o.merchant_id = $1 AND o.created_at >= $2 AND o.created_at < $3
        GROUP BY 1 ORDER BY 1`,
      [membership.merchantId, from, to]
    );
    const header = "day,orders,gross_minor,total_minor";
    const rows = result.rows.map((row) => [
      String(row.day), row.orders, row.gross_minor, row.total_minor
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
    return [header, ...rows].join("\n");
  }

  async listOptions(userId: string, productId: string) {
    const membership = await this.membership(userId);
    const product = await this.database.query("SELECT id FROM products WHERE id = $1 AND merchant_id = $2", [productId, membership.merchantId]);
    if ((product.rowCount ?? 0) === 0) throw new NotFoundException("Product not found.");
    const groups = await this.database.query(
      `SELECT g.id, g.display_name, g.selection_type, g.is_required, g.min_selections, g.max_selections, g.sort_order,
              COALESCE(json_agg(json_build_object('id', o.id, 'displayName', o.display_name, 'priceDeltaMinor', o.price_delta_minor, 'isDefault', o.is_default, 'isAvailable', o.is_available, 'sortOrder', o.sort_order) ORDER BY o.sort_order) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
         FROM product_option_groups g
         LEFT JOIN product_options o ON o.group_id = g.id
        WHERE g.product_id = $1
        GROUP BY g.id, g.display_name, g.selection_type, g.is_required, g.min_selections, g.max_selections, g.sort_order
        ORDER BY g.sort_order, g.display_name`
    );
    const rows = groups.rows as Array<Record<string, unknown>>;
    return {
      groups: rows.map((row) => ({
        id: row.id as string, displayName: row.display_name as string, selectionType: row.selection_type as string,
        isRequired: row.is_required as boolean, minSelections: row.min_selections as number, maxSelections: row.max_selections as number,
        options: ((row.options as Array<Record<string, unknown>>) ?? []).map((option) => ({
          id: option.id as string, displayName: (option.displayName as string) ?? "", priceDeltaMinor: Number(option.priceDeltaMinor ?? 0),
          isDefault: option.isDefault === true, isAvailable: option.isAvailable !== false, sortOrder: Number(option.sortOrder ?? 0)
        }))
      }))
    };
  }

  async createOptionGroup(userId: string, productId: string, input: Readonly<{ displayName: string; selectionType?: string | undefined; isRequired?: boolean | undefined; minSelections?: number | undefined; maxSelections?: number | undefined }>, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const product = await this.database.query("SELECT id FROM products WHERE id = $1 AND merchant_id = $2", [productId, membership.merchantId]);
    if ((product.rowCount ?? 0) === 0) throw new NotFoundException("Product not found.");
    const slug = input.displayName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `variation-${Date.now()}`;
    const result = await this.database.query(
      `INSERT INTO product_option_groups (product_id, slug, display_name, selection_type, is_required, min_selections, max_selections, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,0) RETURNING id`,
      [productId, slug, input.displayName, input.selectionType ?? "single", input.isRequired ?? false, input.minSelections ?? 0, input.maxSelections ?? 1]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Option group create failed.");
    const groupId = row.id as string;
    await this.recordAudit(userId, "merchant.option_group_create", "product_option_group", groupId, requestId, { productId, displayName: input.displayName });
    return { id: groupId, productId, displayName: input.displayName };
  }

  async createOption(userId: string, productId: string, optionGroupId: string, input: Readonly<{ displayName: string; priceDeltaMinor: number; isAvailable?: boolean | undefined }>, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const group = await this.database.query("SELECT id FROM product_option_groups WHERE id = $1 AND product_id = $2", [optionGroupId, productId]);
    if ((group.rowCount ?? 0) === 0) throw new NotFoundException("Option group not found.");
    const result = await this.database.query(
      `INSERT INTO product_options (group_id, display_name, price_delta_minor, is_available, sort_order) VALUES ($1,$2,$3,$4,0) RETURNING id`,
      [optionGroupId, input.displayName, input.priceDeltaMinor, input.isAvailable ?? true]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Option create failed.");
    const optionId = row.id as string;
    await this.recordAudit(userId, "merchant.option_create", "product_option", optionId, requestId, { productId, optionGroupId, displayName: input.displayName });
    return { id: optionId, groupId: optionGroupId, displayName: input.displayName, priceDeltaMinor: input.priceDeltaMinor };
  }

  async updateOption(userId: string, optionId: string, input: Readonly<{ displayName?: string | undefined; priceDeltaMinor?: number | undefined; isAvailable?: boolean | undefined; isDefault?: boolean | undefined }>, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const option = await this.database.query<{ product_id: string }>(
      `SELECT g.product_id FROM product_options o JOIN product_option_groups g ON g.id = o.group_id WHERE o.id = $1`,
      [optionId]
    );
    const row = option.rows[0];
    if (!row) throw new NotFoundException("Option not found.");
    const result = await this.database.query(
      `UPDATE product_options SET display_name = COALESCE($2, display_name), price_delta_minor = COALESCE($3, price_delta_minor), is_available = COALESCE($4, is_available), is_default = COALESCE($5, is_default), updated_at = now() WHERE id = $1`,
      [optionId, input.displayName ?? null, input.priceDeltaMinor ?? null, input.isAvailable ?? null, input.isDefault ?? null]
    );
    if (result.rowCount === 0) throw new NotFoundException("Option not found.");
    await this.recordAudit(userId, "merchant.option_update", "product_option", optionId, requestId, { productId: row.product_id, displayName: input.displayName ?? null });
    return { id: optionId, updated: true };
  }

  async deleteOption(userId: string, optionId: string, requestId: string | null) {
    const membership = await this.requireManager(userId);
    const option = await this.database.query<{ product_id: string }>(
      `SELECT g.product_id FROM product_options o JOIN product_option_groups g ON g.id = o.group_id WHERE o.id = $1`,
      [optionId]
    );
    const row = option.rows[0];
    const result = await this.database.query("DELETE FROM product_options WHERE id = $1", [optionId]);
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException("Option not found.");
    await this.recordAudit(userId, "merchant.option_delete", "product_option", optionId, requestId, { productId: row?.product_id ?? null });
    return { id: optionId, deleted: true };
  }

  private async recordAudit(userId: string, action: string, entityType: string, entityId: string | null, requestId: string | null, metadata: Record<string, unknown> = {}) {
    await this.audit.record({ actorUserId: userId, action, entityType, entityId, requestId, metadata });
  }

  private async requireManager(userId: string): Promise<Membership> {
    const membership = await this.membership(userId);
    if (membership.role === "staff") throw new ConflictException("Only owners and managers can change merchant settings or the menu.");
    return membership;
  }
}

