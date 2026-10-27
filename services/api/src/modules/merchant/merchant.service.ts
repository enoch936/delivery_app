import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import { OrdersService } from "../orders/orders.service.js";

type Membership = Readonly<{ merchantId: string; role: "owner" | "manager" | "staff"; merchantName: string; commissionBps: number }>;

@Injectable()
export class MerchantService {
  constructor(private readonly database: DatabaseService, private readonly orders: OrdersService) {}

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
      this.database.query<{ id: string; slug: string; display_name: string; description: string | null; logo_url: string | null; status: string; commission_bps: number }>(
        "SELECT id, slug, display_name, description, logo_url, status, commission_bps FROM merchants WHERE id = $1", [membership.merchantId]
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
      merchant: { id: row.id, slug: row.slug, displayName: row.display_name, description: row.description, logoUrl: row.logo_url, status: row.status, commissionBps: row.commission_bps },
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

  async updateMerchant(userId: string, input: Readonly<{ displayName?: string | undefined; description?: string | undefined; logoUrl?: string | undefined }>) {
    const membership = await this.requireManager(userId);
    await this.database.query(
      `UPDATE merchants SET display_name = COALESCE($2, display_name), description = COALESCE($3, description), logo_url = COALESCE($4, logo_url) WHERE id = $1`,
      [membership.merchantId, input.displayName ?? null, input.description ?? null, input.logoUrl ?? null]
    );
    return this.me(userId);
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
      this.database.query("SELECT id, slug, display_name, sort_order FROM product_categories WHERE merchant_id = $1 ORDER BY sort_order", [membership.merchantId]),
      this.database.query(
        `SELECT p.id, p.category_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available,
                COALESCE(i.quantity_available, 0) AS quantity_available
         FROM products p LEFT JOIN inventory i ON i.product_id = p.id
         WHERE p.merchant_id = $1 ORDER BY p.display_name`, [membership.merchantId]
      )
    ]);
    return {
      categories: categories.rows.map((row) => ({ id: row.id as string, slug: row.slug as string, displayName: row.display_name as string, sortOrder: row.sort_order as number })),
      products: products.rows.map((row) => ({
        id: row.id as string, categoryId: row.category_id as string | null, sku: row.sku as string | null,
        displayName: row.display_name as string, description: row.description as string | null, imageUrl: row.image_url as string | null,
        basePriceMinor: Number(row.base_price_minor), currency: row.currency as string, isAvailable: row.is_available as boolean,
        quantityAvailable: row.quantity_available as number
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
    return { id: result.rows[0]?.id };
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

  async updateProduct(userId: string, productId: string, input: Readonly<{ displayName?: string | undefined; description?: string | undefined; imageUrl?: string | undefined; basePriceMinor?: number | undefined; isAvailable?: boolean | undefined; categoryId?: string | undefined }>) {
    const membership = await this.requireManager(userId);
    const result = await this.database.query(
      `UPDATE products SET display_name = COALESCE($3, display_name), description = COALESCE($4, description),
              image_url = COALESCE($5, image_url), base_price_minor = COALESCE($6, base_price_minor),
              is_available = COALESCE($7, is_available), category_id = COALESCE($8, category_id), updated_at = now()
       WHERE id = $1 AND merchant_id = $2`,
      [productId, membership.merchantId, input.displayName ?? null, input.description ?? null, input.imageUrl ?? null, input.basePriceMinor ?? null, input.isAvailable ?? null, input.categoryId ?? null]
    );
    if (result.rowCount === 0) throw new NotFoundException("Product not found.");
    return { updated: true };
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

  private async requireManager(userId: string): Promise<Membership> {
    const membership = await this.membership(userId);
    if (membership.role === "staff") throw new ConflictException("Only owners and managers can change merchant settings or the menu.");
    return membership;
  }
}

