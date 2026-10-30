import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { canTransition, decideCancellation, type OrderStatus } from "@delivery-app/domain";
import { readRuntimeConfig, type RuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";
import { AuditService } from "../../common/audit.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import type { OrderDetailRecord, OrderEventRecord, OrderItemRecord, OrderSummaryRecord, OrderViewer } from "./orders.types.js";

type Queryable = Pool | PoolClient;

type OrderRow = {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  merchant_name: string;
  delivery_address_id: string;
  status: string;
  kind: string;
  payment_status: string;
  currency: string;
  items_subtotal_minor: string;
  delivery_fee_minor: string;
  service_fee_minor: string;
  discount_minor: string;
  tax_minor: string;
  tip_minor: string;
  total_minor: string;
  version: number;
  delivery_instructions: string | null;
  delivery_address_snapshot: Record<string, unknown> | null;
  fulfillment_type: "delivery" | "pickup";
  pickup_location_id: string | null;
  scheduled_for: Date | null;
  delivery_estimate_minutes: number | null;
  distance_meters: number | null;
  delivery_otp_hash: string | null;
  delivery_proof_required: boolean;
  created_at: Date;
  updated_at: Date;
  accepted_at: Date | null;
  delivered_at: Date | null;
};

type QuoteRow = {
  id: string;
  user_id: string;
  merchant_id: string;
  delivery_address_id: string | null;
  fulfillment_type: "delivery" | "pickup";
  scheduled_for: Date | null;
  pickup_location_id: string | null;
  currency: string;
  items_subtotal_minor: string;
  delivery_fee_minor: string;
  service_fee_minor: string;
  discount_minor: string;
  total_minor: string;
  line_items: QuoteLineRow[];
  expires_at: Date;
  consumed_at: Date | null;
  tip_minor: string;
  tax_minor: string;
  distance_meters: number | null;
  distance_source: string;
  delivery_estimate_minutes: number | null;
  promotion_id: string | null;
  pricing_rule_id: string | null;
};

type QuoteLineRow = {
  productId: string;
  displayName: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
  options?: readonly { optionId: string; displayName: string; priceDeltaMinor: number }[];
};

type AddressSnapshot = {
  label: string;
  recipientName: string;
  phoneE164: string;
  addressLine: string;
  deliveryInstructions: string | null;
  latitude: number | null;
  longitude: number | null;
};

@Injectable()
export class OrdersService {
  private readonly config: RuntimeConfig;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService
  ) {
    this.config = readRuntimeConfig();
  }

  async create(input: Readonly<{ userId: string; quoteId: string; idempotencyKey: string; requestId: string | null; ipHash: string | null }>): Promise<OrderDetailRecord> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey)) throw new BadRequestException("A valid Idempotency-Key header is required.");
    return this.database.withTransaction(async (client): Promise<OrderDetailRecord> => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`order:${input.userId}:${input.idempotencyKey}`]);
      const existing = await client.query<{ response_status: number; response_body: OrderDetailRecord }>(
        "SELECT response_status, response_body FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2",
        [input.userId, input.idempotencyKey]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].response_status === 0) throw new ConflictException("A request with this idempotency key is still being processed.");
        return existing.rows[0].response_body;
      }

      const quoteResult = await client.query<QuoteRow>("SELECT * FROM checkout_quotes WHERE id = $1 AND user_id = $2 FOR UPDATE", [input.quoteId, input.userId]);
      const quote = quoteResult.rows[0];
      if (!quote) throw new NotFoundException("Checkout quote not found.");
      if (quote.consumed_at) throw new ConflictException("This checkout quote has already been used.");
      if (quote.expires_at <= new Date()) throw new GoneException("This checkout quote has expired. Please request a new quote.");

      const isPickup = quote.fulfillment_type === "pickup";
      const addressResult = isPickup
        ? { rows: [] as { label: string; recipient_name: string; phone_e164: string; address_line: string; delivery_instructions: string | null; latitude: number | null; longitude: number | null }[] }
        : await client.query<{ label: string; recipient_name: string; phone_e164: string; address_line: string; delivery_instructions: string | null; latitude: number | null; longitude: number | null }>(
            `SELECT label, recipient_name, phone_e164, address_line, delivery_instructions,
                    ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
             FROM customer_addresses WHERE id = $1 AND user_id = $2`,
            [quote.delivery_address_id, input.userId]
          );
      const address = addressResult.rows[0] ?? null;
      if (!isPickup && !address) throw new ConflictException("The delivery address is no longer available.");
      if (isPickup && !quote.pickup_location_id) throw new ConflictException("This collection quote is missing its store location.");

      const merchantResult = await client.query<{ id: string; display_name: string; location_id: string; commission_bps: number }>(
        `SELECT m.id, m.display_name, ml.id AS location_id,
                COALESCE((SELECT commission_bps FROM pricing_rules WHERE id = $2), 1500) AS commission_bps
         FROM merchants m JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
         WHERE m.id = $1 AND m.status = 'active' ORDER BY ml.created_at LIMIT 1`,
        [quote.merchant_id, quote.pricing_rule_id]
      );
      const merchant = merchantResult.rows[0];
      if (!merchant) throw new ConflictException("The merchant is no longer available.");

      const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
      if (lineItems.length === 0) throw new BadRequestException("The checkout quote has no items.");
      for (const line of lineItems) {
        const product = await client.query<{ base_price_minor: string; is_available: boolean; quantity_available: number | null }>(
          `SELECT p.base_price_minor, p.is_available, i.quantity_available
           FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = $1 FOR UPDATE OF p`,
          [line.productId]
        );
        const current = product.rows[0];
        if (!current || !current.is_available) throw new ConflictException(`${line.displayName} is no longer available.`);
        const optionDelta = (line.options ?? []).reduce((sum, option) => sum + Number(option.priceDeltaMinor), 0);
        if (Number(current.base_price_minor) + optionDelta !== line.unitPriceMinor) throw new ConflictException(`The price of ${line.displayName} has changed. Please request a new quote.`);
        if (current.quantity_available !== null && current.quantity_available < line.quantity) throw new ConflictException(`There is not enough stock for ${line.displayName}.`);
      }

      const paymentRequired = this.config.paymentsProvider !== "disabled";
      const initialStatus: OrderStatus = paymentRequired ? "AWAITING_PAYMENT" : "CONFIRMED";
      const snapshot: AddressSnapshot | null = address
        ? {
            label: address.label,
            recipientName: address.recipient_name,
            phoneE164: address.phone_e164,
            addressLine: address.address_line,
            deliveryInstructions: address.delivery_instructions,
            latitude: address.latitude === null ? null : Number(address.latitude),
            longitude: address.longitude === null ? null : Number(address.longitude)
          }
        : null;
      const insert = await client.query<OrderRow>(
        `INSERT INTO orders (
           order_number, user_id, merchant_id, merchant_location_id, delivery_address_id, quote_id, kind, status, currency,
           items_subtotal_minor, delivery_fee_minor, service_fee_minor, discount_minor, total_minor, idempotency_key,
           tip_minor, tax_minor, payment_status, delivery_instructions, delivery_lat, delivery_lng,
           delivery_address_snapshot, merchant_name_snapshot, scheduled_for, distance_meters,
           delivery_estimate_minutes, delivery_otp_hash, delivery_proof_required, promotion_id,
           fulfillment_type, pickup_location_id
         ) VALUES (
           'D-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
           $22,$23,$24,$25,NULL,$26,$27,$28,$29
         ) RETURNING *`,
        [
          input.userId, quote.merchant_id, isPickup ? quote.pickup_location_id : merchant.location_id, quote.delivery_address_id, quote.id,
          "MERCHANT_DELIVERY", initialStatus, quote.currency,
          quote.items_subtotal_minor, quote.delivery_fee_minor, quote.service_fee_minor, quote.discount_minor, quote.total_minor,
          input.idempotencyKey, quote.tip_minor, quote.tax_minor,
          paymentRequired ? "PENDING" : "UNPAID", snapshot?.deliveryInstructions ?? null, snapshot?.latitude ?? null, snapshot?.longitude ?? null,
          snapshot ? JSON.stringify(snapshot) : null, merchant.display_name,
          quote.scheduled_for, quote.distance_meters, quote.delivery_estimate_minutes, this.config.deliveryProofOtpRequired, quote.promotion_id,
          quote.fulfillment_type ?? "delivery", isPickup ? quote.pickup_location_id : null
        ]
      );
      const order = insert.rows[0];
      if (!order) throw new Error("Order insert did not return a row.");
      await client.query("UPDATE orders SET delivery_otp_hash = $2 WHERE id = $1", [order.id, this.hashCode(this.deliveryCodeForOrder(order))]);

      for (const line of lineItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, display_name, quantity, unit_price_minor, line_total_minor, currency, options)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [order.id, line.productId, line.displayName, line.quantity, line.unitPriceMinor, line.lineTotalMinor, line.currency, JSON.stringify(line.options ?? [])]
        );
        const inventory = await client.query(
          "UPDATE inventory SET quantity_available = quantity_available - $2 WHERE product_id = $1 AND quantity_available >= $2",
          [line.productId, line.quantity]
        );
        if (inventory.rowCount === 0) throw new ConflictException(`${line.displayName} just went out of stock.`);
      }
      await client.query("UPDATE checkout_quotes SET consumed_at = now() WHERE id = $1", [quote.id]);
      await this.insertEvent(client, order.id, null, "PENDING_CONFIRMATION", input.userId, "Order created");
      await this.insertEvent(client, order.id, "PENDING_CONFIRMATION", initialStatus, input.userId, paymentRequired ? "Awaiting payment" : "Platform confirmed");

      const commissionRateBps = merchant.commission_bps;
      const commissionBaseMinor = Number(quote.items_subtotal_minor);
      const commissionMinor = Math.floor((commissionBaseMinor * commissionRateBps) / 10_000);
      await client.query(
        `INSERT INTO order_financials (order_id, merchant_gross_minor, commission_minor, courier_earning_minor, platform_revenue_minor, tax_minor, tip_minor, currency, commission_rate_bps, commission_base_minor, provider_fee_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [order.id, quote.items_subtotal_minor, commissionMinor, quote.delivery_fee_minor,
          commissionMinor + Number(quote.service_fee_minor), quote.tax_minor, quote.tip_minor, quote.currency,
          commissionRateBps, commissionBaseMinor, 0]
      );
      if (quote.promotion_id && Number(quote.discount_minor) > 0) {
        await client.query(
          "INSERT INTO promotion_redemptions (promotion_id, user_id, order_id, discount_minor) VALUES ($1,$2,$3,$4)",
          [quote.promotion_id, input.userId, order.id, quote.discount_minor]
        );
      }
      await this.notifications.create({
        userId: input.userId, type: "order.created", title: "Order received",
        body: `Your order ${order.order_number} has been sent to ${merchant.display_name}.`,
        data: { orderId: order.id }
      }, client);
      await client.query(
        "INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ('order.created', 'order', $1, $2)",
        [order.id, JSON.stringify({ orderId: order.id, userId: input.userId, totalMinor: Number(quote.total_minor), currency: quote.currency })]
      );
      await this.audit.record({ actorUserId: input.userId, action: "order.created", entityType: "order", entityId: order.id, requestId: input.requestId, ipHash: input.ipHash, metadata: { totalMinor: Number(quote.total_minor), currency: quote.currency } }, client);
      const detail = await this.loadDetail(client, order.id, { userId: input.userId, roles: ["customer"] });
      await client.query(
        `INSERT INTO idempotency_records (user_id, idempotency_key, request_path, response_status, response_body)
         VALUES ($1,$2,'/v1/orders',201,$3)`,
        [input.userId, input.idempotencyKey, JSON.stringify(detail)]
      );
      return detail;
    });
  }

  async list(input: Readonly<{ userId: string; status?: string | undefined; limit: number; offset: number }>): Promise<{ items: OrderSummaryRecord[]; total: number }> {
    const params: unknown[] = [input.userId];
    let statusFilter = "";
    if (input.status) {
      params.push(input.status);
      statusFilter = `AND o.status = $${params.length}`;
    }
    const count = await this.database.query<{ count: string }>(`SELECT count(*)::text AS count FROM orders o WHERE o.user_id = $1 ${statusFilter}`, params);
    params.push(input.limit, input.offset);
    const result = await this.database.query<{ id: string; order_number: string; status: string; payment_status: string; currency: string; total_minor: string; merchant_name: string; item_count: string; created_at: Date; updated_at: Date }>(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.currency, o.total_minor,
              COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name,
              (SELECT COALESCE(sum(oi.quantity), 0)::text FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
              o.created_at, o.updated_at
       FROM orders o JOIN merchants m ON m.id = o.merchant_id
       WHERE o.user_id = $1 ${statusFilter}
       ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id, orderNumber: row.order_number, status: row.status, paymentStatus: row.payment_status,
        currency: row.currency, totalMinor: Number(row.total_minor), merchantName: row.merchant_name,
        itemCount: Number(row.item_count), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
      })),
      total: Number(count.rows[0]?.count ?? "0")
    };
  }

  async detail(orderId: string, viewer: OrderViewer): Promise<OrderDetailRecord> {
    return this.database.withTransaction(async (client) => this.loadDetail(client, orderId, viewer));
  }

  async cancel(input: Readonly<{ orderId: string; userId: string; reason: string; requestId: string | null; ipHash: string | null }>): Promise<OrderDetailRecord> {
    await this.database.withTransaction(async (client) => {
      const orderResult = await client.query<OrderRow & { accepted_at: Date | null; courier_picked_up_at: Date | null }>(
        `SELECT o.*, da.picked_up_at AS courier_picked_up_at,
                COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name
         FROM orders o JOIN merchants m ON m.id = o.merchant_id
         LEFT JOIN delivery_assignments da ON da.order_id = o.id AND da.status IN ('accepted','arrived_pickup','picked_up')
         WHERE o.id = $1 AND o.user_id = $2 FOR UPDATE OF o`,
        [input.orderId, input.userId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException("Order not found.");
      const decision = decideCancellation({
        status: order.status as OrderStatus,
        paymentStatus: order.payment_status as "UNPAID" | "PENDING" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED",
        orderCreatedAt: order.created_at,
        merchantAcceptedAt: order.accepted_at,
        courierPickedUpAt: order.courier_picked_up_at,
        now: new Date(),
        freeCancellationWindowSeconds: 120
      });
      if (!decision.allowed) throw new ConflictException(decision.reason);
      if (!canTransition("MERCHANT_DELIVERY", order.status as OrderStatus, "CANCELLED")) throw new ConflictException("This order cannot be cancelled in its current state.");
      await client.query("UPDATE orders SET status = 'CANCELLED', cancellation_reason = $2, cancelled_at = now(), version = version + 1 WHERE id = $1", [order.id, input.reason]);
      const items = await client.query<{ product_id: string | null; quantity: number }>("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [order.id]);
      for (const item of items.rows) {
        if (item.product_id) await client.query("UPDATE inventory SET quantity_available = quantity_available + $2 WHERE product_id = $1", [item.product_id, item.quantity]);
      }
      await client.query("UPDATE delivery_assignments SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $2 WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup')", [order.id, "Customer cancelled"]);
      await client.query("UPDATE dispatch_offers SET status = 'cancelled', responded_at = now() WHERE order_id = $1 AND status = 'pending'", [order.id]);
      await this.insertEvent(client, order.id, order.status, "CANCELLED", input.userId, decision.reason);
      let refundId: string | null = null;
      if (order.payment_status === "PAID" || order.payment_status === "PARTIALLY_REFUNDED") {
        const payment = await client.query<{ id: string; amount_minor: string }>("SELECT id, amount_minor FROM payments WHERE order_id = $1 AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [order.id]);
        if (payment.rows[0]) {
          const refund = await client.query<{ id: string }>(
            `INSERT INTO refunds (payment_id, order_id, amount_minor, currency, status, reason, requested_by, provider_merchant_reference)
             VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7) RETURNING id`,
            [payment.rows[0].id, order.id, payment.rows[0].amount_minor, order.currency, input.reason, input.userId, `RF-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`]
          );
          refundId = refund.rows[0]?.id ?? null;
          await client.query("UPDATE orders SET status = 'REFUND_PENDING', version = version + 1 WHERE id = $1", [order.id]);
          await this.insertEvent(client, order.id, "CANCELLED", "REFUND_PENDING", input.userId, "Refund requested");
        }
      }
      await this.notifications.create({
        userId: order.user_id, type: "order.cancelled", title: "Order cancelled",
        body: refundId ? `Order ${order.order_number} was cancelled. A refund is pending review.` : `Order ${order.order_number} was cancelled.`,
        data: { orderId: order.id, refundId }
      }, client);
      await client.query("INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ('order.cancelled','order',$1,$2)", [order.id, JSON.stringify({ orderId: order.id, refundId })]);
      await this.audit.record({ actorUserId: input.userId, action: "order.cancelled", entityType: "order", entityId: order.id, requestId: input.requestId, ipHash: input.ipHash, metadata: { reason: input.reason, refundId } }, client);
    });
    return this.detail(input.orderId, { userId: input.userId, roles: ["customer"] });
  }

  async merchantTransition(input: Readonly<{ orderId: string; actorUserId: string; action: "accept" | "prepare" | "ready" | "reject"; reason?: string | undefined; requestId: string | null; ipHash: string | null }>): Promise<OrderDetailRecord> {
    await this.database.withTransaction(async (client) => {
      const order = await this.lockMerchantOrder(client, input.orderId, input.actorUserId);
      const target: OrderStatus = input.action === "accept" ? "ACCEPTED_BY_MERCHANT" : input.action === "prepare" ? "PREPARING" : input.action === "ready" ? "READY_FOR_PICKUP" : "CANCELLED";
      if (input.action === "reject") {
        if (["PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED", "REFUNDED", "REFUND_PENDING"].includes(order.status)) throw new ConflictException("This order can no longer be rejected.");
      } else if (!canTransition("MERCHANT_DELIVERY", order.status as OrderStatus, target)) {
        throw new ConflictException(`Cannot ${input.action} an order that is ${order.status}.`);
      }
      if (input.action === "reject" && !input.reason?.trim()) throw new BadRequestException("A rejection reason is required.");
      await client.query(
        `UPDATE orders SET status = $2, version = version + 1,
           accepted_at = CASE WHEN $2 = 'ACCEPTED_BY_MERCHANT' THEN now() ELSE accepted_at END,
           cancellation_reason = CASE WHEN $2 = 'CANCELLED' THEN $3 ELSE cancellation_reason END
         WHERE id = $1`,
        [order.id, target, input.reason ?? null]
      );
      if (input.action === "reject") {
        const items = await client.query<{ product_id: string | null; quantity: number }>("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [order.id]);
        for (const item of items.rows) {
          if (item.product_id) await client.query("UPDATE inventory SET quantity_available = quantity_available + $2 WHERE product_id = $1", [item.product_id, item.quantity]);
        }
        await client.query("UPDATE delivery_assignments SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $2 WHERE order_id = $1 AND status IN ('offered','accepted','arrived_pickup')", [order.id, "Merchant rejected"]);
        await client.query("UPDATE dispatch_offers SET status = 'cancelled', responded_at = now() WHERE order_id = $1 AND status = 'pending'", [order.id]);
      }
      await this.insertEvent(client, order.id, order.status, target, input.actorUserId, input.reason ?? `Merchant ${input.action}`);
      await this.notifications.create({
        userId: order.user_id, type: `order.${target.toLowerCase()}`, title: "Order update",
        body: `Order ${order.order_number} is now ${labelStatus(target)}.`, data: { orderId: order.id, status: target }
      }, client);
      await client.query("INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ('order.status_changed','order',$1,$2)", [order.id, JSON.stringify({ orderId: order.id, status: target })]);
      await this.audit.record({ actorUserId: input.actorUserId, action: `merchant.order_${input.action}`, entityType: "order", entityId: order.id, requestId: input.requestId, ipHash: input.ipHash, metadata: { from: order.status, to: target } }, client);
    });
    return this.detail(input.orderId, { userId: input.actorUserId, roles: ["merchant_staff"] });
  }

  async courierTransition(input: Readonly<{ orderId: string; courierUserId: string; action: "arrived_pickup" | "picked_up" | "in_transit" | "delivered" | "failed"; proofCode?: string | undefined; notes?: string | undefined; requestId: string | null; ipHash: string | null }>): Promise<OrderDetailRecord> {
    await this.database.withTransaction(async (client) => {
      const orderResult = await client.query<OrderRow>(
        `SELECT o.*, COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name
         FROM orders o JOIN merchants m ON m.id = o.merchant_id
         WHERE o.id = $1 FOR UPDATE OF o`,
        [input.orderId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException("Order not found.");
      const assignment = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM delivery_assignments WHERE order_id = $1 AND courier_user_id = $2 AND status IN ('accepted','arrived_pickup','picked_up') FOR UPDATE",
        [order.id, input.courierUserId]
      );
      const active = assignment.rows[0];
      if (!active) throw new ForbiddenException("You are not assigned to this delivery.");
      const target: OrderStatus =
        input.action === "arrived_pickup" ? "COURIER_ARRIVING_PICKUP" :
        input.action === "picked_up" ? "PICKED_UP" :
        input.action === "in_transit" ? "IN_TRANSIT" :
        input.action === "delivered" ? "DELIVERED" : "FAILED";
      if (!canTransition(order.kind, order.status as OrderStatus, target)) throw new ConflictException(`Cannot move this order from ${order.status} to ${target}.`);
      if (input.action === "delivered" && order.delivery_proof_required) {
        if (!input.proofCode) throw new BadRequestException("A delivery verification code is required.");
        if (this.hashCode(input.proofCode) !== order.delivery_otp_hash) throw new BadRequestException("The delivery verification code is incorrect.");
      }
      if (input.action === "arrived_pickup" && active.status !== "accepted") throw new ConflictException("This assignment is not in an accepted state.");
      if (input.action === "picked_up" && active.status !== "arrived_pickup") throw new ConflictException("Confirm arrival at the merchant before pickup.");
      if (input.action === "in_transit" && active.status !== "picked_up") throw new ConflictException("Confirm pickup before starting transit.");
      if (input.action === "delivered" && active.status !== "picked_up" && order.status !== "IN_TRANSIT") throw new ConflictException("The order has not been picked up.");
      const assignmentStatus = input.action === "arrived_pickup" ? "arrived_pickup" : input.action === "picked_up" ? "picked_up" : input.action === "delivered" ? "delivered" : active.status;
      const assignmentTimeColumn = input.action === "arrived_pickup" ? "arrived_at" : input.action === "picked_up" ? "picked_up_at" : input.action === "delivered" ? "delivered_at" : null;
      await client.query(
        `UPDATE delivery_assignments SET status = $2${assignmentTimeColumn ? `, ${assignmentTimeColumn} = now()` : ""} WHERE id = $1`,
        [active.id, assignmentStatus]
      );
      await client.query(
        `UPDATE orders SET status = $2, version = version + 1,
           delivered_at = CASE WHEN $2 = 'DELIVERED' THEN now() ELSE delivered_at END,
           courier_user_id = $3
         WHERE id = $1`,
        [order.id, target, input.courierUserId]
      );
      if (input.action === "delivered") {
        await client.query(
          `INSERT INTO delivery_proofs (order_id, assignment_id, proof_type, notes, captured_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [order.id, active.id, order.delivery_proof_required ? "otp" : "customer_handoff", input.notes ?? null, input.courierUserId]
        );
        await client.query("UPDATE courier_profiles SET completed_deliveries = completed_deliveries + 1 WHERE user_id = $1", [input.courierUserId]);
        await client.query("UPDATE courier_availability SET active_order_id = NULL, updated_at = now() WHERE courier_user_id = $1", [input.courierUserId]);
      }
      if (input.action === "failed") {
        await client.query("UPDATE delivery_assignments SET status = 'failed', cancelled_at = now(), cancellation_reason = $2 WHERE id = $1", [active.id, input.notes ?? "Delivery failed"]);
        await client.query("UPDATE dispatch_offers SET status = 'cancelled', responded_at = now() WHERE order_id = $1 AND status = 'pending'", [order.id]);
        await client.query("UPDATE courier_availability SET active_order_id = NULL, updated_at = now() WHERE courier_user_id = $1", [input.courierUserId]);
      }
      await this.insertEvent(client, order.id, order.status, target, input.courierUserId, input.notes ?? `Courier ${input.action}`);
      await this.notifications.create({
        userId: order.user_id, type: `order.${target.toLowerCase()}`, title: "Delivery update",
        body: `Order ${order.order_number} is now ${labelStatus(target)}.`, data: { orderId: order.id, status: target }
      }, client);
      await client.query("INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload) VALUES ('order.status_changed','order',$1,$2)", [order.id, JSON.stringify({ orderId: order.id, status: target })]);
      await this.audit.record({ actorUserId: input.courierUserId, action: `courier.${input.action}`, entityType: "order", entityId: order.id, requestId: input.requestId, ipHash: input.ipHash, metadata: { from: order.status, to: target } }, client);
    });
    return this.detail(input.orderId, { userId: input.courierUserId, roles: ["courier"] });
  }

  async markPaymentSucceeded(orderId: string, paymentId: string, requestId: string | null, existingClient?: PoolClient): Promise<void> {
    if (existingClient) return this.markPaymentSucceededInTransaction(existingClient, orderId, paymentId, requestId);
    await this.database.withTransaction((client) => this.markPaymentSucceededInTransaction(client, orderId, paymentId, requestId));
  }

  private async markPaymentSucceededInTransaction(client: PoolClient, orderId: string, paymentId: string, requestId: string | null): Promise<void> {
      const orderResult = await client.query<OrderRow>(
        `SELECT o.*, COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name
         FROM orders o JOIN merchants m ON m.id = o.merchant_id WHERE o.id = $1 FOR UPDATE OF o`,
        [orderId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException("Order not found.");
      await client.query("UPDATE orders SET payment_status = 'PAID', version = version + 1 WHERE id = $1", [order.id]);
      if (order.status === "AWAITING_PAYMENT" && canTransition(order.kind, order.status as OrderStatus, "CONFIRMED")) {
        await client.query("UPDATE orders SET status = 'CONFIRMED' WHERE id = $1", [order.id]);
        await this.insertEvent(client, order.id, order.status, "CONFIRMED", null, "Payment confirmed");
      }
      const financials = await client.query<{ merchant_gross_minor: string; commission_minor: string; courier_earning_minor: string; platform_revenue_minor: string; tax_minor: string; tip_minor: string; currency: string }>(
        "SELECT * FROM order_financials WHERE order_id = $1", [order.id]
      );
      const financial = financials.rows[0];
      if (financial) {
        await this.ledger.post({
          referenceType: "payment", referenceId: paymentId, description: `Payment for ${order.order_number}`,
          lines: [
            { accountCode: "payment_clearing", side: "debit", amountMinor: Number(order.total_minor), currency: order.currency },
            { accountCode: "discount_expense", side: "debit", amountMinor: Number(order.discount_minor), currency: order.currency },
            { accountCode: "merchant_payable", side: "credit", amountMinor: Number(financial.merchant_gross_minor) - Number(financial.commission_minor), currency: order.currency },
            { accountCode: "platform_revenue", side: "credit", amountMinor: Number(financial.platform_revenue_minor), currency: order.currency },
            { accountCode: "courier_payable", side: "credit", amountMinor: Number(financial.courier_earning_minor), currency: order.currency },
            { accountCode: "tax_payable", side: "credit", amountMinor: Number(financial.tax_minor), currency: order.currency },
            { accountCode: "tips_payable", side: "credit", amountMinor: Number(financial.tip_minor), currency: order.currency }
          ]
        }, client);
      }
      await this.notifications.create({
        userId: order.user_id, type: "payment.succeeded", title: "Payment confirmed",
        body: `Payment for order ${order.order_number} was confirmed.`, data: { orderId: order.id, paymentId }
      }, client);
      await this.audit.record({ actorUserId: null, action: "payment.confirmed", entityType: "order", entityId: order.id, requestId, metadata: { paymentId } }, client);
  }

  private async lockMerchantOrder(client: PoolClient, orderId: string, actorUserId: string): Promise<OrderRow> {
    const result = await client.query<OrderRow & { member_role: string }>(
      `SELECT o.*, COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name, mm.role AS member_role
       FROM orders o JOIN merchants m ON m.id = o.merchant_id
       JOIN merchant_members mm ON mm.merchant_id = o.merchant_id AND mm.user_id = $2
       WHERE o.id = $1 FOR UPDATE OF o`,
      [orderId, actorUserId]
    );
    const order = result.rows[0];
    if (!order) throw new NotFoundException("Order not found or you are not a member of this merchant.");
    return order;
  }

  private async loadDetail(executor: Queryable, orderId: string, viewer: OrderViewer): Promise<OrderDetailRecord> {
    const orderResult = await executor.query<OrderRow>(
      `SELECT o.*, COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name
       FROM orders o JOIN merchants m ON m.id = o.merchant_id WHERE o.id = $1`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) throw new NotFoundException("Order not found.");
    const isOwner = order.user_id === viewer.userId;
    const roles = Array.isArray((viewer as any).roles) ? (viewer as any).roles : []; const isAdmin = roles.includes("admin") || roles.includes("support");
    const membership = await executor.query("SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND user_id = $2", [order.merchant_id, viewer.userId]);
    const isMerchant = (membership.rowCount ?? 0) > 0;
    const assignmentResult = await executor.query<{
      id: string; status: string; courier_user_id: string; accepted_at: Date | null; picked_up_at: Date | null; delivered_at: Date | null;
      display_name: string | null; phone_e164: string | null; vehicle_type: string | null; rating_average: string | null;
      latitude: number | null; longitude: number | null; last_seen_at: Date | null;
    }>(
      `SELECT da.id, da.status, da.courier_user_id, da.accepted_at, da.picked_up_at, da.delivered_at,
              u.display_name, u.phone_e164, cp.vehicle_type, cp.rating_average,
              ST_Y(ca.last_location::geometry) AS latitude, ST_X(ca.last_location::geometry) AS longitude, ca.last_seen_at
       FROM delivery_assignments da
       JOIN users u ON u.id = da.courier_user_id
       LEFT JOIN courier_profiles cp ON cp.user_id = u.id
       LEFT JOIN courier_availability ca ON ca.courier_user_id = u.id
       WHERE da.order_id = $1 AND da.status IN ('accepted','arrived_pickup','picked_up','delivered')
       ORDER BY da.created_at DESC LIMIT 1`,
      [orderId]
    );
    const assignment = assignmentResult.rows[0] ?? null;
    const isCourier = assignment?.courier_user_id === viewer.userId;
    if (!isOwner && !isMerchant && !isCourier && !isAdmin) throw new NotFoundException("Order not found.");

    const items = await executor.query<{ id: string; product_id: string | null; display_name: string; quantity: number; unit_price_minor: string; line_total_minor: string; options: unknown }>(
      "SELECT id, product_id, display_name, quantity, unit_price_minor, line_total_minor, options FROM order_items WHERE order_id = $1 ORDER BY display_name",
      [orderId]
    );
    const events = await executor.query<{ id: string; from_status: string | null; to_status: string; actor_user_id: string | null; metadata: Record<string, unknown>; created_at: Date }>(
      "SELECT id, from_status, to_status, actor_user_id, metadata, created_at FROM order_status_events WHERE order_id = $1 ORDER BY created_at ASC",
      [orderId]
    );
    const refunds = await executor.query<{ id: string; status: string; amount_minor: string; reason: string; created_at: Date }>(
      "SELECT id, status, amount_minor, reason, created_at FROM refunds WHERE order_id = $1 ORDER BY created_at DESC",
      [orderId]
    );
    const review = await executor.query("SELECT 1 FROM reviews WHERE order_id = $1", [orderId]);
    const assignmentPickedUp = assignment?.picked_up_at ?? null;
    const decision = decideCancellation({
      status: order.status as OrderStatus,
      paymentStatus: order.payment_status as "UNPAID" | "PENDING" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED",
      orderCreatedAt: order.created_at,
      merchantAcceptedAt: order.accepted_at,
      courierPickedUpAt: assignmentPickedUp,
      now: new Date(),
      freeCancellationWindowSeconds: 120
    });
    const snapshot = (order.delivery_address_snapshot ?? {}) as Record<string, unknown>;
    const pickup = order.fulfillment_type === "pickup" && order.pickup_location_id
      ? (await executor.query<{ id: string; name: string; address_line: string | null }>(
          "SELECT id, name, address_line FROM merchant_locations WHERE id = $1",
          [order.pickup_location_id]
        )).rows[0] ?? null
      : null;
    const locationFresh = assignment?.last_seen_at ? Date.now() - assignment.last_seen_at.getTime() < 120_000 : false;
    const deliveryCode = isOwner && ["COURIER_ASSIGNED", "COURIER_ARRIVING_PICKUP", "PICKED_UP", "IN_TRANSIT"].includes(order.status)
      ? this.deliveryCodeForOrder(order)
      : null;
    return {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      kind: order.kind,
      paymentStatus: order.payment_status,
      currency: order.currency,
      merchant: { id: order.merchant_id, displayName: order.merchant_name },
      totals: {
        itemsSubtotalMinor: Number(order.items_subtotal_minor), deliveryFeeMinor: Number(order.delivery_fee_minor),
        serviceFeeMinor: Number(order.service_fee_minor), discountMinor: Number(order.discount_minor),
        taxMinor: Number(order.tax_minor), tipMinor: Number(order.tip_minor), totalMinor: Number(order.total_minor), currency: order.currency
      },
      items: items.rows.map((item) => ({
        id: item.id, productId: item.product_id, displayName: item.display_name, quantity: item.quantity,
        unitPriceMinor: Number(item.unit_price_minor), lineTotalMinor: Number(item.line_total_minor), options: item.options
      })),
      deliveryAddress: Object.keys(snapshot).length > 0 ? snapshot : { addressId: order.delivery_address_id },
      fulfillmentType: order.fulfillment_type ?? "delivery",
      pickupLocation: pickup ? { id: pickup.id, name: pickup.name, addressLine: pickup.address_line } : null,
      deliveryInstructions: order.delivery_instructions,
      scheduledFor: order.scheduled_for?.toISOString() ?? null,
      deliveryEstimateMinutes: order.delivery_estimate_minutes,
      distanceMeters: order.distance_meters,
      timeline: events.rows.map((event) => ({
        id: event.id, fromStatus: event.from_status, toStatus: event.to_status, actorUserId: event.actor_user_id,
        metadata: event.metadata, createdAt: event.created_at.toISOString()
      })) satisfies OrderEventRecord[],
      delivery: {
        assignmentId: assignment?.id ?? null,
        status: assignment?.status ?? null,
        courier: assignment ? {
          id: assignment.courier_user_id, displayName: isOwner || isMerchant || isCourier || isAdmin ? assignment.display_name : null,
          phoneE164: isOwner || isCourier || isAdmin ? assignment.phone_e164 : null,
          vehicleType: assignment.vehicle_type, rating: assignment.rating_average === null ? null : Number(assignment.rating_average)
        } : null,
        acceptedAt: assignment?.accepted_at?.toISOString() ?? null,
        pickedUpAt: assignment?.picked_up_at?.toISOString() ?? null,
        deliveredAt: assignment?.delivered_at?.toISOString() ?? null,
        lastLocation: assignment?.latitude !== null && assignment?.latitude !== undefined && assignment.longitude !== null && assignment.longitude !== undefined && assignment.last_seen_at
          ? { latitude: Number(assignment.latitude), longitude: Number(assignment.longitude), recordedAt: assignment.last_seen_at.toISOString(), stale: !locationFresh }
          : null
      },
      refunds: refunds.rows.map((refund) => ({ id: refund.id, status: refund.status, amountMinor: Number(refund.amount_minor), reason: refund.reason, createdAt: refund.created_at.toISOString() })),
      capabilities: {
        canCancel: isOwner && decision.allowed,
        canReview: isOwner && order.status === "DELIVERED" && review.rowCount === 0,
        canRate: isOwner && order.status === "DELIVERED" && review.rowCount === 0,
        isOwner, isMerchant, isCourier, isAdmin
      },
      deliveryCode,
      version: order.version,
      createdAt: order.created_at.toISOString(),
      updatedAt: order.updated_at.toISOString()
    };
  }

  private deliveryCodeForOrder(order: { id: string }): string {
    return this.computeCode(`order:${order.id}`);
  }

  private computeCode(seed: string): string {
    const secret = this.config.authTokenSecret ?? "development-delivery-code-secret";
    const digest = createHmac("sha256", secret).update(seed).digest();
    const value = digest.readUInt32BE(0) % 1_000_000;
    return value.toString().padStart(6, "0");
  }

  private hashCode(code: string): string {
    const secret = this.config.authTokenSecret ?? "development-delivery-code-secret";
    return createHmac("sha256", secret).update(`verify:${code}`).digest("hex");
  }

  private async insertEvent(client: Queryable, orderId: string, fromStatus: string | null, toStatus: string, actorUserId: string | null, note: string): Promise<void> {
    await client.query(
      "INSERT INTO order_status_events (order_id, from_status, to_status, actor_user_id, metadata) VALUES ($1,$2,$3,$4,$5)",
      [orderId, fromStatus, toStatus, actorUserId, JSON.stringify({ note })]
    );
  }
}

function labelStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}


