import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { readRuntimeConfig, type RuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";
import { AuditService } from "../../common/audit.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { ChapaPaymentProvider, SandboxPaymentProvider, StripePaymentProvider } from "./payments.providers.js";
import { TelebirrPaymentProvider } from "./payments.telebirr.js";
import type { PaymentMethod, PaymentProvider, RefundResult } from "./payments.types.js";

type PaymentRow = {
  id: string; order_id: string; user_id: string; provider: string; provider_reference: string | null;
  amount_minor: string; currency: string; status: string; checkout_url: string | null; expires_at: Date | null; paid_at: Date | null;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function webhookData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = objectValue(payload["data"]);
  if (!data) return payload;
  return objectValue(data["object"]) ?? data;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function paymentMethodFromProvider(provider: string): PaymentMethod | null {
  return provider === "chapa" || provider === "stripe" || provider === "sandbox" || provider === "telebirr" ? provider : null;
}

function webhookReferences(payload: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const values = [
    data.chapa_reference, data.merchant_reference, data.merch_order_id, data.merchOrderId,
    data.out_trade_no, data.outTradeNo, data.tx_ref, data.trx_ref, data.reference, data.id,
    payload.chapa_reference, payload.merchant_reference, payload.tx_ref
  ];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value !== ""))];
}

@Injectable()
export class PaymentsService {
  private readonly config: RuntimeConfig;

  constructor(
    private readonly database: DatabaseService,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService
  ) {
    this.config = readRuntimeConfig();
  }

  async initiate(input: Readonly<{ userId: string; orderId: string; method: PaymentMethod; idempotencyKey: string | null; requestId: string | null }>) {
    const method = input.method;
    if (method === "chapa" && this.config.paymentsProvider !== "chapa") throw new ServiceUnavailableException("Chapa payments are not enabled.");
    if (method === "stripe" && this.config.paymentsProvider !== "stripe") throw new ServiceUnavailableException("Stripe card payments are not enabled.");
    if (method === "sandbox" && this.config.paymentsProvider !== "sandbox") throw new ServiceUnavailableException("The sandbox payment provider is not enabled.");
    if (method === "telebirr" && this.config.paymentsProvider !== "telebirr") throw new ServiceUnavailableException("Telebirr payments are not enabled.");
    const provider = this.providerFor(method);
    return this.database.withTransaction(async (client) => {
      const orderResult = await client.query<{ id: string; user_id: string; status: string; payment_status: string; total_minor: string; currency: string; order_number: string }>(
        "SELECT id, user_id, status, payment_status, total_minor, currency, order_number FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [input.orderId, input.userId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException("Order not found.");
      if (order.payment_status === "PAID") throw new ConflictException("This order is already paid.");
      if (order.status !== "AWAITING_PAYMENT" && order.status !== "CONFIRMED") throw new ConflictException("This order is not awaiting payment.");
      let cashPaymentId: string | null = null;
      if (method === "cash") {
        const existingCash = await client.query<{ id: string }>("SELECT id FROM payments WHERE order_id = $1 AND provider = 'cash' AND status = 'PENDING' LIMIT 1", [order.id]);
        cashPaymentId = existingCash.rows[0]?.id ?? null;
        if (!cashPaymentId) {
          const createdCash = await client.query<{ id: string }>(
            "INSERT INTO payments (order_id, user_id, provider, amount_minor, currency, status) VALUES ($1,$2,'cash',$3,$4,'PENDING') RETURNING id",
            [order.id, order.user_id, order.total_minor, order.currency]
          );
          cashPaymentId = createdCash.rows[0]?.id ?? null;
        }
        await client.query("UPDATE orders SET payment_method = 'cash' WHERE id = $1", [order.id]);
        if (order.status === "AWAITING_PAYMENT") {
          await client.query("UPDATE orders SET status = 'CONFIRMED', version = version + 1 WHERE id = $1", [order.id]);
          await client.query("INSERT INTO order_status_events (order_id, from_status, to_status, actor_user_id, metadata) VALUES ($1,'AWAITING_PAYMENT','CONFIRMED',$2,$3)", [order.id, input.userId, JSON.stringify({ note: "Cash on delivery selected" })]);
        }
        return { paymentId: cashPaymentId, method, checkoutUrl: null, providerReference: null, status: "PENDING" as const };
      }
      const user = await client.query<{ phone_e164: string | null; email: string | null }>("SELECT phone_e164, email FROM users WHERE id = $1", [order.user_id]);
      const idempotencyKey = input.idempotencyKey ?? `pay-${randomUUID()}`;
      const existing = await client.query<PaymentRow>("SELECT * FROM payments WHERE user_id = $1 AND idempotency_key = $2", [order.user_id, idempotencyKey]);
      if (existing.rows[0]) return this.toPaymentView(existing.rows[0]);
      const payment = await client.query<PaymentRow>(
        `INSERT INTO payments (order_id, user_id, provider, amount_minor, currency, status, idempotency_key, expires_at)
         VALUES ($1,$2,$3,$4,$5,'PENDING',$6, now() + interval '30 minutes') RETURNING *`,
        [order.id, order.user_id, provider.name, order.total_minor, order.currency, idempotencyKey]
      );
      const paymentRow = payment.rows[0];
      if (!paymentRow) throw new Error("Payment creation failed.");
      const session = await provider.createCheckout({
        paymentId: paymentRow.id, orderId: order.id, amountMinor: Number(order.total_minor), currency: order.currency,
        customerEmail: user.rows[0]?.email ?? null, customerPhone: user.rows[0]?.phone_e164 ?? "+251000000000",
        returnUrl: this.config.paymentReturnUrl ?? this.config.publicApiBaseUrl,
        cancelUrl: this.config.paymentCancelUrl ?? this.config.paymentReturnUrl ?? this.config.publicApiBaseUrl,
        idempotencyKey: `checkout-${paymentRow.id}`
      });
      const updated = await client.query<PaymentRow>(
        `UPDATE payments SET provider_reference = $2, provider_merchant_reference = $3,
                checkout_url = $4, expires_at = $5, updated_at = now() WHERE id = $1 RETURNING *`,
        [paymentRow.id, session.providerReference, session.merchantReference ?? null, session.checkoutUrl, session.expiresAt]
      );
      await client.query("UPDATE orders SET payment_status = 'PENDING', payment_method = $2 WHERE id = $1", [order.id, provider.name]);
      await client.query("INSERT INTO payment_attempts (payment_id, status, provider_reference, response_metadata) VALUES ($1,'PENDING',$2,$3)", [paymentRow.id, session.providerReference, JSON.stringify({ checkoutUrl: session.checkoutUrl })]);
      await this.audit.record({ actorUserId: input.userId, action: "payment.initiated", entityType: "payment", entityId: paymentRow.id, requestId: input.requestId, metadata: { orderId: order.id, method: provider.name } }, client);
      return this.toPaymentView(updated.rows[0] ?? paymentRow);
    });
  }

  async get(userId: string, paymentId: string) {
    const result = await this.database.query<PaymentRow>("SELECT * FROM payments WHERE id = $1 AND user_id = $2", [paymentId, userId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Payment not found.");
    return this.toPaymentView(row);
  }

  async listForOrder(userId: string, orderId: string) {
    const result = await this.database.query<PaymentRow>("SELECT * FROM payments WHERE order_id = $1 AND user_id = $2 ORDER BY created_at DESC", [orderId, userId]);
    return { items: result.rows.map((row) => this.toPaymentView(row)) };
  }

  async sandboxComplete(userId: string, paymentId: string, outcome: "succeeded" | "failed", requestId: string | null): Promise<void> {
    if (this.config.paymentsProvider !== "sandbox") throw new ServiceUnavailableException("The sandbox payment provider is not enabled.");
    const result = await this.database.query<PaymentRow>("SELECT * FROM payments WHERE id = $1 AND user_id = $2 AND provider = 'sandbox'", [paymentId, userId]);
    const payment = result.rows[0];
    if (!payment) throw new NotFoundException("Sandbox payment not found.");
    if (payment.status === "SUCCEEDED") return;
    if (outcome === "failed") {
      await this.database.query("UPDATE payments SET status = 'FAILED', failure_reason = 'Sandbox declined', updated_at = now() WHERE id = $1", [payment.id]);
      await this.database.query("UPDATE orders SET payment_status = 'FAILED' WHERE id = $1 AND payment_status = 'PENDING'", [payment.order_id]);
      return;
    }
    await this.markSucceeded(payment, requestId);
  }

  async handleWebhook(providerName: string, rawBody: string, signature: string | undefined, payload: Record<string, unknown>): Promise<{ received: boolean }> {
    const method = paymentMethodFromProvider(providerName);
    if (!method) throw new BadRequestException("Unsupported payment provider.");
    const provider = this.providerFor(method);
    const valid = provider.verifyWebhook(rawBody, signature, payload);
    const data = webhookData(payload);
    const references = webhookReferences(payload, data);
    const eventStatus = firstString(data.trade_status, data.tradeStatus, data.payment_status, data.status, payload.status, payload.event);
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const eventId = firstString(payload.id, payload.event_id) || payloadHash;
    const inserted = await this.database.query<{ id: string }>(
      `INSERT INTO payment_webhook_events (provider, provider_event_id, payload, payload_hash, signature_valid)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
      [providerName, eventId, JSON.stringify(payload), payloadHash, valid]
    );
    const event = inserted.rows[0];
    if (!event) return { received: true };
    if (!valid) {
      await this.database.query("UPDATE payment_webhook_events SET processed_at = now(), processing_error = 'Invalid signature' WHERE id = $1", [event.id]);
      throw new UnauthorizedException("Invalid webhook signature.");
    }
    try {
      return await this.applyWebhookPayload(payload, event.id, providerName);
    } catch (error) {
      await this.database.query("UPDATE payment_webhook_events SET processed_at = now(), processing_error = $2 WHERE id = $1", [event.id, error instanceof Error ? error.message : "unknown"]);
      throw error;
    }
  }

  private async applyWebhookPayload(payload: Record<string, unknown>, eventId: string, providerName: string): Promise<{ received: boolean }> {
    const data = webhookData(payload);
    const webhookType = firstString(payload.webhook_type, data.webhook_type, payload.webhookType).toLowerCase();
    if (webhookType === "refund") {
      await this.database.query("UPDATE payment_webhook_events SET processed_at = now(), processing_error = NULL WHERE id = $1", [eventId]);
      return { received: true };
    }
    const references = webhookReferences(payload, data);
    if (references.length === 0) throw new Error("Webhook does not include a provider reference.");
    const paymentResult = await this.database.query<PaymentRow>(
      `SELECT * FROM payments
       WHERE provider = $1 AND (provider_reference = ANY($2::text[]) OR provider_merchant_reference = ANY($2::text[]))
       ORDER BY created_at DESC LIMIT 1`,
      [providerName, references]
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new Error(`No payment matches provider reference ${references[0]}.`);
    const status = firstString(data.trade_status, data.tradeStatus, data.payment_status, data.status, payload.status, payload.event).toLowerCase();
    const eventType = firstString(payload.type, payload.event).toLowerCase();
    const paid = ["success", "succeeded", "paid", "charge.success", "completed", "pay_success", "payment.success"].includes(status)
      || eventType === "payment.success" || eventType === "checkout.session.async_payment_succeeded";
    if (paid && payment.provider === "telebirr") {
      const amount = Number(data.total_amount ?? data.totalAmount ?? data.amount);
      if (!Number.isFinite(amount)) throw new Error("Telebirr webhook does not include a valid total amount.");
      if (Math.round(amount * 100) !== Number(payment.amount_minor)) {
        throw new Error(`Telebirr amount ${Math.round(amount * 100)} does not match ${payment.amount_minor}.`);
      }
      const currency = firstString(data.trans_currency, data.transCurrency);
      if (currency && currency.toUpperCase() !== payment.currency.toUpperCase()) {
        throw new Error(`Telebirr currency ${currency} does not match ${payment.currency}.`);
      }
    }
    if (paid && payment.provider === "chapa") {
      const remote = await this.providerFor("chapa").fetchStatus({
        providerReference: payment.provider_reference ?? references[0] ?? "",
        amountMinor: Number(payment.amount_minor),
        currency: payment.currency
      });
      if (remote.status !== "succeeded") {
        throw new Error(`Chapa verification did not confirm payment ${payment.id}: ${remote.failureReason ?? remote.status}.`);
      }
      if (remote.amountMinor !== undefined && remote.amountMinor !== Number(payment.amount_minor)) {
        throw new Error(`Chapa amount ${remote.amountMinor} does not match ${payment.amount_minor}.`);
      }
      if (remote.currency && remote.currency.toUpperCase() !== payment.currency.toUpperCase()) {
        throw new Error(`Chapa currency ${remote.currency} does not match ${payment.currency}.`);
      }
      if (remote.providerFeeMinor !== undefined) {
        await this.database.query("UPDATE payments SET provider_fee_minor = $2, updated_at = now() WHERE id = $1", [payment.id, remote.providerFeeMinor]);
      }
    }
    if (paid) await this.markSucceeded(payment, null);
    else if (["failed", "cancelled", "canceled", "expired", "unpaid", "incomplete", "blocked", "auth_needed", "pay_failed", "pay_cancel", "cancel"].includes(status) || eventType === "checkout.session.expired") {
      await this.database.query("UPDATE payments SET status = 'FAILED', failure_reason = $2, updated_at = now() WHERE id = $1 AND status = 'PENDING'", [payment.id, status]);
      await this.database.query("UPDATE orders SET payment_status = 'FAILED' WHERE id = $1 AND payment_status = 'PENDING'", [payment.order_id]);
    }
    await this.database.query("UPDATE payment_webhook_events SET processed_at = now(), processing_error = NULL WHERE id = $1", [eventId]);
    return { received: true };
  }

  async reconciliationSummary() {
    const counts = await this.database.query<{
      pending_payments: number; expired_payments: number; invalid_webhooks: number; failed_webhooks: number;
      succeeded_unreflected: number; paid_without_payment: number; pending_merchant_settlements: number; pending_courier_payouts: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM payments WHERE provider <> 'cash' AND status = 'PENDING') AS pending_payments,
        (SELECT count(*)::int FROM payments WHERE provider <> 'cash' AND status = 'PENDING' AND expires_at < now()) AS expired_payments,
        (SELECT count(*)::int FROM payment_webhook_events WHERE signature_valid = false) AS invalid_webhooks,
        (SELECT count(*)::int FROM payment_webhook_events WHERE processing_error IS NOT NULL) AS failed_webhooks,
        (SELECT count(*)::int FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.status = 'SUCCEEDED' AND o.payment_status NOT IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')) AS succeeded_unreflected,
        (SELECT count(*)::int FROM orders o WHERE o.payment_status IN ('PAID','PARTIALLY_REFUNDED')
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('SUCCEEDED','REFUNDED','PARTIALLY_REFUNDED'))) AS paid_without_payment,
        (SELECT count(*)::int FROM merchant_settlements WHERE status = 'PENDING') AS pending_merchant_settlements,
        (SELECT count(*)::int FROM courier_payouts WHERE status = 'PENDING') AS pending_courier_payouts`
    );
    const row = counts.rows[0];
    const succeededWithoutOrderPaid = await this.database.query(
      `SELECT p.id AS payment_id, p.provider, p.status AS payment_status, o.id AS order_id, o.order_number, o.payment_status AS order_payment_status
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.status = 'SUCCEEDED' AND o.payment_status NOT IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
       ORDER BY p.updated_at DESC LIMIT 20`
    );
    const paidWithoutSucceededPayment = await this.database.query(
      `SELECT o.id AS order_id, o.order_number, o.payment_status, o.status
       FROM orders o WHERE o.payment_status IN ('PAID','PARTIALLY_REFUNDED')
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status IN ('SUCCEEDED','REFUNDED','PARTIALLY_REFUNDED'))
       ORDER BY o.created_at DESC LIMIT 20`
    );
    return {
      counts: {
        pendingPayments: row?.pending_payments ?? 0, expiredPayments: row?.expired_payments ?? 0,
        invalidWebhooks: row?.invalid_webhooks ?? 0, failedWebhooks: row?.failed_webhooks ?? 0,
        succeededUnreflected: row?.succeeded_unreflected ?? 0, paidWithoutPayment: row?.paid_without_payment ?? 0,
        pendingMerchantSettlements: row?.pending_merchant_settlements ?? 0, pendingCourierPayouts: row?.pending_courier_payouts ?? 0
      },
      issues: {
        succeededWithoutOrderPaid: succeededWithoutOrderPaid.rows,
        paidWithoutSucceededPayment: paidWithoutSucceededPayment.rows
      }
    };
  }

  async listWebhookEvents(filter: string | undefined, limit: number, offset: number) {
    const result = await this.database.query<{
      id: string; provider: string; provider_event_id: string; signature_valid: boolean;
      processed_at: Date | null; processing_error: string | null; created_at: Date;
    }>(
      `SELECT id, provider, provider_event_id, signature_valid, processed_at, processing_error, created_at
       FROM payment_webhook_events
       WHERE ($1::text IS NULL
         OR ($1 = 'failed' AND processing_error IS NOT NULL)
         OR ($1 = 'invalid' AND signature_valid = false)
         OR ($1 = 'unprocessed' AND processed_at IS NULL))
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [filter ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id, provider: row.provider, providerEventId: row.provider_event_id, signatureValid: row.signature_valid,
        processedAt: row.processed_at?.toISOString() ?? null, processingError: row.processing_error,
        createdAt: row.created_at.toISOString(), replayable: row.signature_valid && (row.processing_error !== null || row.processed_at === null)
      }))
    };
  }

  async replayWebhookEvent(input: Readonly<{ eventId: string; actorUserId: string; requestId: string | null }>) {
    const result = await this.database.query<{ id: string; provider: string; payload: Record<string, unknown>; signature_valid: boolean; processed_at: Date | null; processing_error: string | null }>(
      "SELECT id, provider, payload, signature_valid, processed_at, processing_error FROM payment_webhook_events WHERE id = $1",
      [input.eventId]
    );
    const event = result.rows[0];
    if (!event) throw new NotFoundException("Webhook event not found.");
    if (!event.signature_valid) throw new BadRequestException("Only webhook events with a valid signature can be replayed.");
    if (event.processed_at && !event.processing_error) throw new ConflictException("This webhook event has already been processed.");
    try {
      await this.applyWebhookPayload(event.payload, event.id, event.provider);
    } catch (error) {
      await this.database.query("UPDATE payment_webhook_events SET processed_at = now(), processing_error = $2 WHERE id = $1", [event.id, error instanceof Error ? error.message : "unknown"]);
      throw error;
    }
    await this.audit.record({
      actorUserId: input.actorUserId, action: "payment.webhook_replayed", entityType: "payment_webhook_event",
      entityId: event.id, requestId: input.requestId, metadata: { provider: event.provider, previousError: event.processing_error }
    });
    return { replayed: true };
  }

  async reconcilePayments(input: Readonly<{ actorUserId: string; requestId: string | null; paymentId?: string | undefined; limit: number }>) {
    const result = await this.database.query<PaymentRow>(
      `SELECT * FROM payments
       WHERE provider <> 'cash' AND status = 'PENDING' AND provider_reference IS NOT NULL
         AND created_at < now() - interval '2 minutes'
         AND ($1::uuid IS NULL OR id = $1)
       ORDER BY created_at ASC LIMIT $2`,
      [input.paymentId ?? null, input.limit]
    );
    const summary = { checked: result.rows.length, succeeded: 0, failed: 0, pending: 0, errors: 0, issues: [] as Array<{ paymentId: string; reason: string }> };
    for (const payment of result.rows) {
      const method = paymentMethodFromProvider(payment.provider);
      if (!method) {
        summary.errors++;
        summary.issues.push({ paymentId: payment.id, reason: `Unsupported payment provider ${payment.provider}.` });
        continue;
      }
      try {
        const remote = await this.providerFor(method).fetchStatus({
          providerReference: payment.provider_reference ?? "", amountMinor: Number(payment.amount_minor), currency: payment.currency
        });
        if (payment.provider === "chapa" && remote.providerFeeMinor !== undefined) {
          await this.database.query("UPDATE payments SET provider_fee_minor = $2, updated_at = now() WHERE id = $1", [payment.id, remote.providerFeeMinor]);
        }
        if (remote.status === "succeeded") {
          if (remote.amountMinor !== undefined && remote.amountMinor !== Number(payment.amount_minor)) {
            summary.issues.push({ paymentId: payment.id, reason: `Provider amount ${remote.amountMinor} does not match ${payment.amount_minor}.` });
            continue;
          }
          await this.markSucceeded(payment, input.requestId);
          summary.succeeded++;
          await this.audit.record({
            actorUserId: input.actorUserId, action: "payment.reconciled_succeeded", entityType: "payment",
            entityId: payment.id, requestId: input.requestId, metadata: { provider: payment.provider }
          });
        } else if (remote.status === "failed") {
          await this.database.withTransaction(async (client) => {
            const failureReason = remote.failureReason ?? `Provider reported ${remote.status}`;
            await client.query("UPDATE payments SET status = 'FAILED', failure_reason = $2, updated_at = now() WHERE id = $1 AND status = 'PENDING'", [payment.id, failureReason]);
            await client.query("INSERT INTO payment_attempts (payment_id, status, provider_reference) VALUES ($1,'FAILED',$2)", [payment.id, payment.provider_reference]);
            await client.query("UPDATE orders SET payment_status = 'FAILED' WHERE id = $1 AND payment_status = 'PENDING'", [payment.order_id]);
            await this.audit.record({
              actorUserId: input.actorUserId, action: "payment.reconciled_failed", entityType: "payment",
              entityId: payment.id, requestId: input.requestId, metadata: { provider: payment.provider, failureReason }
            }, client);
          });
          summary.failed++;
        } else {
          summary.pending++;
          if (remote.status === "unknown" || remote.failureReason) {
            summary.issues.push({ paymentId: payment.id, reason: remote.failureReason ?? "Provider returned an unknown status." });
          }
        }
      } catch (error) {
        summary.errors++;
        summary.issues.push({ paymentId: payment.id, reason: error instanceof Error ? error.message : "Reconciliation failed." });
      }
    }
    await this.audit.record({
      actorUserId: input.actorUserId, action: "payment.reconciliation_run", entityType: "payment", entityId: null, requestId: input.requestId,
      metadata: { checked: summary.checked, succeeded: summary.succeeded, failed: summary.failed, pending: summary.pending, errors: summary.errors }
    });
    return summary;
  }

  async listRefunds(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT r.*, o.order_number, u.phone_e164 AS requester_phone
       FROM refunds r JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.requested_by
       WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at ASC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderId: row.order_id as string, orderNumber: row.order_number as string,
        amountMinor: Number(row.amount_minor), currency: row.currency as string, status: row.status as string,
        reason: row.reason as string, providerReference: row.provider_reference as string | null,
        requesterPhone: row.requester_phone as string | null, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async reviewRefund(input: Readonly<{ refundId: string; actorUserId: string; decision: "approve" | "reject"; note?: string | undefined; requestId: string | null }>) {
    const staged = await this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string; payment_id: string; order_id: string; amount_minor: string; currency: string; status: string; reason: string }>(
        "SELECT * FROM refunds WHERE id = $1 FOR UPDATE", [input.refundId]
      );
      const refund = result.rows[0];
      if (!refund) throw new NotFoundException("Refund not found.");
      if (refund.status !== "PENDING") throw new ConflictException("Only pending refunds can be reviewed.");
      if (input.decision === "reject") {
        await client.query("UPDATE refunds SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now(), updated_at = now(), failure_reason = $3 WHERE id = $1", [refund.id, input.actorUserId, input.note ?? null]);
        await client.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1 AND status = 'REFUND_PENDING'", [refund.order_id]);
        await this.audit.record({ actorUserId: input.actorUserId, action: "refund.rejected", entityType: "refund", entityId: refund.id, requestId: input.requestId, metadata: { note: input.note ?? null } }, client);
        return null;
      }
      await client.query("UPDATE refunds SET status = 'PROCESSING', reviewed_by = $2, reviewed_at = now(), updated_at = now() WHERE id = $1", [refund.id, input.actorUserId]);
      const payment = await client.query<PaymentRow>("SELECT * FROM payments WHERE id = $1 FOR UPDATE", [refund.payment_id]);
      return { refund, payment: payment.rows[0] };
    });
    if (!staged) return { status: "REJECTED" as const };
    const { refund, payment } = staged;
    if (!payment) throw new NotFoundException("The payment for this refund no longer exists.");
    let result: RefundResult = { status: "succeeded", providerReference: payment.provider_reference ?? refund.id };
    if (payment.provider !== "cash") {
      const method = paymentMethodFromProvider(payment.provider);
      if (!method) throw new BadRequestException(`Unsupported payment provider ${payment.provider}.`);
      const order = await this.database.query<{ total_minor: string }>("SELECT total_minor FROM orders WHERE id = $1", [refund.order_id]);
      const fullRefund = Number(refund.amount_minor) >= Number(order.rows[0]?.total_minor ?? "0");
      result = await this.providerFor(method).refund({
        providerReference: payment.provider_reference ?? "",
        amountMinor: Number(refund.amount_minor),
        currency: refund.currency,
        reason: refund.reason,
        idempotencyKey: `refund-${refund.id}`,
        fullRefund
      });
    }
    await this.database.withTransaction(async (client) => {
      if (result.status === "failed") {
        await client.query("UPDATE refunds SET status = 'FAILED', provider_reference = COALESCE($2, provider_reference), failure_reason = $3, updated_at = now() WHERE id = $1", [refund.id, result.providerReference, result.failureReason ?? "Provider refund failed"]);
        await this.audit.record({ actorUserId: input.actorUserId, action: "refund.failed", entityType: "refund", entityId: refund.id, requestId: input.requestId, metadata: { failure: result.failureReason ?? null } }, client);
        return;
      }
      await client.query("UPDATE refunds SET status = $2, provider_reference = COALESCE($3, provider_reference), completed_at = now(), updated_at = now() WHERE id = $1", [refund.id, result.status === "pending" ? "PROCESSING" : "SUCCEEDED", result.providerReference]);
      if (result.status === "succeeded") {
        const order = await client.query<{ id: string; status: string; total_minor: string; discount_minor: string; currency: string; order_number: string }>(
          "SELECT id, status, total_minor, discount_minor, currency, order_number FROM orders WHERE id = $1 FOR UPDATE", [refund.order_id]
        );
        const orderRow = order.rows[0];
        if (!orderRow) throw new NotFoundException("Order not found.");
        const fullRefund = Number(refund.amount_minor) >= Number(orderRow.total_minor);
        await client.query("UPDATE orders SET payment_status = $2, status = $3, version = version + 1 WHERE id = $1", [orderRow.id, fullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED", fullRefund ? "REFUNDED" : orderRow.status]);
        await this.postRefundLedger(client, refund.id, orderRow, Number(refund.amount_minor), fullRefund);
        await this.notifications.create({ userId: payment.user_id, type: "refund.succeeded", title: "Refund completed", body: `Your refund for order ${orderRow.order_number} has been processed.`, data: { orderId: orderRow.id, refundId: refund.id } }, client);
        await this.audit.record({ actorUserId: input.actorUserId, action: "refund.succeeded", entityType: "refund", entityId: refund.id, requestId: input.requestId, metadata: { amountMinor: Number(refund.amount_minor) } }, client);
      }
    });
    return { status: result.status };
  }

  private async markSucceeded(payment: PaymentRow, requestId: string | null): Promise<void> {
    await this.database.withTransaction(async (client) => {
      const result = await client.query<PaymentRow>("SELECT * FROM payments WHERE id = $1 FOR UPDATE", [payment.id]);
      const row = result.rows[0];
      if (!row) throw new NotFoundException("Payment not found.");
      if (row.status === "SUCCEEDED") return;
      await client.query("UPDATE payments SET status = 'SUCCEEDED', paid_at = now(), failure_reason = NULL, updated_at = now() WHERE id = $1", [row.id]);
      await client.query("INSERT INTO payment_attempts (payment_id, status, provider_reference) VALUES ($1,'SUCCEEDED',$2)", [row.id, row.provider_reference]);
      await this.orders.markPaymentSucceeded(payment.order_id, payment.id, requestId, client);
    });
  }

  private async postRefundLedger(client: import("pg").PoolClient, refundId: string, order: Readonly<{ id: string; total_minor: string; discount_minor: string; currency: string }>, amountMinor: number, fullRefund: boolean): Promise<void> {
    if (!fullRefund) {
      await this.ledger.post({
        referenceType: "refund", referenceId: refundId, description: "Partial refund",
        lines: [
          { accountCode: "refund_expense", side: "debit", amountMinor, currency: order.currency },
          { accountCode: "payment_clearing", side: "credit", amountMinor, currency: order.currency }
        ]
      }, client);
      return;
    }
    const financials = await client.query<{ merchant_gross_minor: string; commission_minor: string; courier_earning_minor: string; platform_revenue_minor: string; tax_minor: string; tip_minor: string }>(
      "SELECT * FROM order_financials WHERE order_id = $1", [order.id]
    );
    const financial = financials.rows[0];
    if (!financial) throw new Error("Cannot post a refund without order financials.");
    await this.ledger.post({
      referenceType: "refund", referenceId: refundId, description: "Full refund reversal",
      lines: [
        { accountCode: "merchant_payable", side: "debit", amountMinor: Number(financial.merchant_gross_minor) - Number(financial.commission_minor), currency: order.currency },
        { accountCode: "platform_revenue", side: "debit", amountMinor: Number(financial.platform_revenue_minor), currency: order.currency },
        { accountCode: "courier_payable", side: "debit", amountMinor: Number(financial.courier_earning_minor), currency: order.currency },
        { accountCode: "tax_payable", side: "debit", amountMinor: Number(financial.tax_minor), currency: order.currency },
        { accountCode: "tips_payable", side: "debit", amountMinor: Number(financial.tip_minor), currency: order.currency },
        { accountCode: "payment_clearing", side: "credit", amountMinor: Number(order.total_minor), currency: order.currency },
        { accountCode: "discount_expense", side: "credit", amountMinor: Number(order.discount_minor), currency: order.currency }
      ]
    }, client);
  }

  private providerFor(method: PaymentMethod): PaymentProvider {
    if (method === "chapa") {
      if (!this.config.chapaSecretKey) throw new ServiceUnavailableException("Chapa is not configured.");
      return new ChapaPaymentProvider(this.config.chapaSecretKey, this.config.chapaWebhookSecret, {
        baseUrl: this.config.chapaBaseUrl,
        callbackUrl: `${this.config.publicApiBaseUrl.replace(/\/$/, "")}/api/v1/payments/webhooks/chapa`
      });
    }
    if (method === "stripe") {
      if (!this.config.stripeSecretKey) throw new ServiceUnavailableException("Stripe is not configured.");
      return new StripePaymentProvider(this.config.stripeSecretKey, this.config.stripeWebhookSecret);
    }
    if (method === "telebirr") {
      const required = {
        fabricAppId: this.config.telebirrFabricAppId,
        appSecret: this.config.telebirrAppSecret,
        merchantAppId: this.config.telebirrMerchantAppId,
        merchantCode: this.config.telebirrMerchantCode,
        privateKey: this.config.telebirrPrivateKey,
        publicKey: this.config.telebirrPublicKey
      };
      if (Object.values(required).some((value) => !value)) throw new ServiceUnavailableException("Telebirr is not configured.");
      return new TelebirrPaymentProvider({
        baseUrl: this.config.telebirrBaseUrl,
        webBaseUrl: this.config.telebirrWebBaseUrl,
        fabricAppId: required.fabricAppId!,
        appSecret: required.appSecret!,
        merchantAppId: required.merchantAppId!,
        merchantCode: required.merchantCode!,
        privateKey: required.privateKey!,
        publicKey: required.publicKey!,
        notifyUrl: this.config.telebirrNotifyUrl,
        redirectUrl: this.config.telebirrRedirectUrl ?? this.config.paymentReturnUrl ?? this.config.publicApiBaseUrl
      });
    }
    if (method === "sandbox") return new SandboxPaymentProvider(this.config.publicApiBaseUrl, this.config.paymentWebhookSecret);
    throw new BadRequestException("Cash payments do not use a payment provider.");
  }

  private toPaymentView(row: PaymentRow) {
    return {
      id: row.id, orderId: row.order_id, provider: row.provider, status: row.status,
      amountMinor: Number(row.amount_minor), currency: row.currency, checkoutUrl: row.checkout_url,
      providerReference: row.provider_reference, expiresAt: row.expires_at?.toISOString() ?? null,
      paidAt: row.paid_at?.toISOString() ?? null
    };
  }
}


