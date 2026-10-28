import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { AuditService } from "../../common/audit.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { LedgerService } from "../ledger/ledger.service.js";

export type SettlementKind = "merchant" | "courier";
export type SettlementDecision = "approve" | "fail" | "pay";

type MerchantOrderRow = {
  order_id: string; merchant_id: string; merchant_name: string; currency: string;
  merchant_gross_minor: string; commission_minor: string;
};

type CourierOrderRow = {
  order_id: string; courier_user_id: string; courier_name: string | null; courier_phone: string | null; currency: string;
  courier_earning_minor: string; tip_minor: string;
};

type SettlementRow = {
  id: string; merchant_id?: string; courier_user_id?: string; period_start: Date; period_end: Date;
  gross_sales_minor?: string; gross_earnings_minor?: string; commission_minor?: string; deductions_minor?: string;
  refunds_minor?: string; tips_minor?: string; net_payable_minor: string; currency: string; status: string;
  payment_reference?: string | null; notes?: string | null; paid_at: Date | null; created_at: Date;
};

@Injectable()
export class SettlementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService
  ) {}

  async preview(kind: SettlementKind, from: Date, to: Date) {
    this.assertPeriod(from, to);
    if (kind === "merchant") {
      const rows = await this.merchantOrders(this.database.getPool(), from, to);
      return { kind, from: from.toISOString(), to: to.toISOString(), items: this.groupMerchantRows(rows) };
    }
    const rows = await this.courierOrders(this.database.getPool(), from, to);
    return { kind, from: from.toISOString(), to: to.toISOString(), items: this.groupCourierRows(rows) };
  }

  async generate(input: Readonly<{ kind: SettlementKind; from: Date; to: Date; actorUserId: string; requestId: string | null }>) {
    this.assertPeriod(input.from, input.to);
    return this.database.withTransaction(async (client) => {
      if (input.kind === "merchant") {
        const rows = await this.merchantOrders(client, input.from, input.to, true);
        const generated = await this.generateMerchantSettlements(client, rows, input.from, input.to, input.actorUserId, input.requestId);
        return { kind: input.kind, ...generated };
      }
      const rows = await this.courierOrders(client, input.from, input.to, true);
      const generated = await this.generateCourierPayouts(client, rows, input.from, input.to, input.actorUserId, input.requestId);
      return { kind: input.kind, ...generated };
    });
  }

  async listMerchants(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query<SettlementRow & { merchant_name: string; order_count: number }>(
      `SELECT s.*, m.display_name AS merchant_name,
              (SELECT count(*)::int FROM merchant_settlement_orders so WHERE so.settlement_id = s.id) AS order_count
       FROM merchant_settlements s JOIN merchants m ON m.id = s.merchant_id
       WHERE ($1::text IS NULL OR s.status = $1)
       ORDER BY s.period_end DESC, s.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id, merchantId: row.merchant_id, merchantName: row.merchant_name, periodStart: row.period_start.toISOString(),
        periodEnd: row.period_end.toISOString(), grossMinor: Number(row.gross_sales_minor), commissionMinor: Number(row.commission_minor),
        refundsMinor: Number(row.refunds_minor), netPayableMinor: Number(row.net_payable_minor), currency: row.currency,
        status: row.status, orderCount: row.order_count, paymentReference: row.payment_reference ?? null,
        notes: row.notes ?? null, paidAt: row.paid_at?.toISOString() ?? null, createdAt: row.created_at.toISOString()
      }))
    };
  }

  async listCouriers(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query<SettlementRow & { courier_name: string | null; courier_phone: string | null; order_count: number }>(
      `SELECT p.*, cp.full_name AS courier_name, u.phone_e164 AS courier_phone,
              (SELECT count(*)::int FROM courier_payout_orders po WHERE po.payout_id = p.id) AS order_count
       FROM courier_payouts p JOIN courier_profiles cp ON cp.user_id = p.courier_user_id JOIN users u ON u.id = p.courier_user_id
       WHERE ($1::text IS NULL OR p.status = $1)
       ORDER BY p.period_end DESC, p.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id, courierUserId: row.courier_user_id, courierName: row.courier_name, courierPhone: row.courier_phone,
        periodStart: row.period_start.toISOString(), periodEnd: row.period_end.toISOString(),
        grossMinor: Number(row.gross_earnings_minor), deductionsMinor: Number(row.deductions_minor), tipsMinor: Number(row.tips_minor),
        netPayableMinor: Number(row.net_payable_minor), currency: row.currency, status: row.status, orderCount: row.order_count,
        paymentReference: row.payment_reference ?? null, notes: row.notes ?? null,
        paidAt: row.paid_at?.toISOString() ?? null, createdAt: row.created_at.toISOString()
      }))
    };
  }

  async merchantDetail(settlementId: string) {
    const result = await this.database.query<SettlementRow & { merchant_name: string }>(
      "SELECT s.*, m.display_name AS merchant_name FROM merchant_settlements s JOIN merchants m ON m.id = s.merchant_id WHERE s.id = $1",
      [settlementId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Settlement not found.");
    const orders = await this.database.query(
      `SELECT so.order_id, o.order_number, o.delivered_at, so.merchant_gross_minor, so.commission_minor, so.net_minor
       FROM merchant_settlement_orders so JOIN orders o ON o.id = so.order_id
       WHERE so.settlement_id = $1 ORDER BY o.delivered_at ASC`,
      [settlementId]
    );
    return {
      id: row.id, merchantName: row.merchant_name, periodStart: row.period_start.toISOString(), periodEnd: row.period_end.toISOString(),
      grossMinor: Number(row.gross_sales_minor), commissionMinor: Number(row.commission_minor), refundsMinor: Number(row.refunds_minor),
      netPayableMinor: Number(row.net_payable_minor), currency: row.currency, status: row.status,
      paymentReference: row.payment_reference ?? null, notes: row.notes ?? null, paidAt: row.paid_at?.toISOString() ?? null,
      orders: orders.rows.map((order) => ({
        orderId: order.order_id, orderNumber: order.order_number, deliveredAt: (order.delivered_at as Date | null)?.toISOString() ?? null,
        grossMinor: Number(order.merchant_gross_minor), commissionMinor: Number(order.commission_minor), netMinor: Number(order.net_minor)
      }))
    };
  }

  async courierDetail(payoutId: string) {
    const result = await this.database.query<SettlementRow & { courier_name: string | null; courier_phone: string | null }>(
      `SELECT p.*, cp.full_name AS courier_name, u.phone_e164 AS courier_phone
       FROM courier_payouts p JOIN courier_profiles cp ON cp.user_id = p.courier_user_id JOIN users u ON u.id = p.courier_user_id
       WHERE p.id = $1`,
      [payoutId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Courier payout not found.");
    const orders = await this.database.query(
      `SELECT po.order_id, o.order_number, o.delivered_at, po.courier_earning_minor, po.tip_minor, po.net_minor
       FROM courier_payout_orders po JOIN orders o ON o.id = po.order_id
       WHERE po.payout_id = $1 ORDER BY o.delivered_at ASC`,
      [payoutId]
    );
    return {
      id: row.id, courierName: row.courier_name, courierPhone: row.courier_phone,
      periodStart: row.period_start.toISOString(), periodEnd: row.period_end.toISOString(),
      grossMinor: Number(row.gross_earnings_minor), deductionsMinor: Number(row.deductions_minor), tipsMinor: Number(row.tips_minor),
      netPayableMinor: Number(row.net_payable_minor), currency: row.currency, status: row.status,
      paymentReference: row.payment_reference ?? null, notes: row.notes ?? null, paidAt: row.paid_at?.toISOString() ?? null,
      orders: orders.rows.map((order) => ({
        orderId: order.order_id, orderNumber: order.order_number, deliveredAt: (order.delivered_at as Date | null)?.toISOString() ?? null,
        earningMinor: Number(order.courier_earning_minor), tipMinor: Number(order.tip_minor), netMinor: Number(order.net_minor)
      }))
    };
  }

  async transitionMerchant(input: Readonly<{
    settlementId: string; decision: SettlementDecision; actorUserId: string; requestId: string | null;
    paymentReference?: string | undefined; notes?: string | undefined;
  }>) {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<SettlementRow>("SELECT * FROM merchant_settlements WHERE id = $1 FOR UPDATE", [input.settlementId]);
      const row = result.rows[0];
      if (!row) throw new NotFoundException("Settlement not found.");
      const next = this.nextStatus(row.status, input.decision);
      if (next === "PAID") {
        if (!input.paymentReference) throw new BadRequestException("A payment reference is required to mark a settlement as paid.");
        const net = Number(row.net_payable_minor);
        if (net > 0) {
          await this.ledger.post({
            referenceType: "merchant_settlement", referenceId: row.id, description: `Merchant settlement ${row.id}`,
            lines: [
              { accountCode: "merchant_payable", side: "debit", amountMinor: net, currency: row.currency },
              { accountCode: "platform_bank", side: "credit", amountMinor: net, currency: row.currency }
            ]
          }, client);
        }
      }
      await client.query(
        `UPDATE merchant_settlements SET status = $2,
          approved_by = CASE WHEN $2 = 'APPROVED' THEN $3 ELSE approved_by END,
          approved_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END,
          paid_by = CASE WHEN $2 = 'PAID' THEN $3 ELSE paid_by END,
          paid_at = CASE WHEN $2 = 'PAID' THEN now() ELSE paid_at END,
          payment_reference = COALESCE($4, payment_reference),
          notes = COALESCE($5, notes), updated_at = now()
         WHERE id = $1`,
        [row.id, next, input.actorUserId, input.paymentReference ?? null, input.notes ?? null]
      );
      await this.audit.record({
        actorUserId: input.actorUserId, action: `settlement.merchant_${next.toLowerCase()}`, entityType: "merchant_settlement",
        entityId: row.id, requestId: input.requestId, metadata: { netPayableMinor: Number(row.net_payable_minor), paymentReference: input.paymentReference ?? null }
      }, client);
      return { id: row.id, status: next };
    });
  }

  async transitionCourier(input: Readonly<{
    payoutId: string; decision: SettlementDecision; actorUserId: string; requestId: string | null;
    paymentReference?: string | undefined; notes?: string | undefined;
  }>) {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<SettlementRow>("SELECT * FROM courier_payouts WHERE id = $1 FOR UPDATE", [input.payoutId]);
      const row = result.rows[0];
      if (!row) throw new NotFoundException("Courier payout not found.");
      const next = this.nextStatus(row.status, input.decision);
      if (next === "PAID") {
        if (!input.paymentReference) throw new BadRequestException("A payment reference is required to mark a payout as paid.");
        const net = Number(row.net_payable_minor);
        if (net > 0) {
          const earnings = Number(row.gross_earnings_minor) - Number(row.deductions_minor);
          const tips = Number(row.tips_minor);
          if (earnings < 0 || earnings + tips !== net) throw new ConflictException("Courier payout totals are inconsistent.");
          await this.ledger.post({
            referenceType: "courier_payout", referenceId: row.id, description: `Courier payout ${row.id}`,
            lines: [
              { accountCode: "courier_payable", side: "debit", amountMinor: earnings, currency: row.currency },
              { accountCode: "tips_payable", side: "debit", amountMinor: tips, currency: row.currency },
              { accountCode: "platform_bank", side: "credit", amountMinor: net, currency: row.currency }
            ]
          }, client);
        }
      }
      await client.query(
        `UPDATE courier_payouts SET status = $2,
          approved_by = CASE WHEN $2 = 'APPROVED' THEN $3 ELSE approved_by END,
          approved_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END,
          paid_by = CASE WHEN $2 = 'PAID' THEN $3 ELSE paid_by END,
          paid_at = CASE WHEN $2 = 'PAID' THEN now() ELSE paid_at END,
          payment_reference = COALESCE($4, payment_reference),
          notes = COALESCE($5, notes), updated_at = now()
         WHERE id = $1`,
        [row.id, next, input.actorUserId, input.paymentReference ?? null, input.notes ?? null]
      );
      await this.audit.record({
        actorUserId: input.actorUserId, action: `settlement.courier_${next.toLowerCase()}`, entityType: "courier_payout",
        entityId: row.id, requestId: input.requestId, metadata: { netPayableMinor: Number(row.net_payable_minor), paymentReference: input.paymentReference ?? null }
      }, client);
      return { id: row.id, status: next };
    });
  }

  private async generateMerchantSettlements(
    client: PoolClient, rows: readonly MerchantOrderRow[], from: Date, to: Date, actorUserId: string, requestId: string | null
  ) {
    const generated: Array<{ id: string; merchantId: string; netPayableMinor: number; currency: string; orderCount: number }> = [];
    const skipped: Array<{ merchantId: string; reason: string }> = [];
    for (const group of this.groupRawMerchantRows(rows)) {
      const existing = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM merchant_settlements
         WHERE merchant_id = $1 AND period_start = $2 AND period_end = $3 AND currency = $4 FOR UPDATE`,
        [group.merchantId, from, to, group.currency]
      );
      if (existing.rows[0] && existing.rows[0].status !== "PENDING") {
        skipped.push({ merchantId: group.merchantId, reason: `Settlement is already ${existing.rows[0].status}.` });
        continue;
      }
      const settlementId = existing.rows[0]?.id ?? (await client.query<{ id: string }>(
        `INSERT INTO merchant_settlements (merchant_id, period_start, period_end, currency)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [group.merchantId, from, to, group.currency]
      )).rows[0]?.id;
      if (!settlementId) throw new Error("Merchant settlement creation failed.");
      let inserted = 0;
      for (const order of group.orders) {
        const line = await client.query(
          `INSERT INTO merchant_settlement_orders (settlement_id, order_id, merchant_gross_minor, commission_minor, net_minor)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING`,
          [settlementId, order.orderId, order.grossMinor, order.commissionMinor, order.netMinor]
        );
        inserted += line.rowCount ?? 0;
      }
      const totals = await client.query<{ gross: string; commission: string; net: string; order_count: number }>(
        `SELECT COALESCE(sum(merchant_gross_minor),0)::text AS gross, COALESCE(sum(commission_minor),0)::text AS commission,
                COALESCE(sum(net_minor),0)::text AS net, count(*)::int AS order_count
         FROM merchant_settlement_orders WHERE settlement_id = $1`,
        [settlementId]
      );
      const total = totals.rows[0];
      await client.query(
        `UPDATE merchant_settlements SET gross_sales_minor = $2, commission_minor = $3, refunds_minor = 0,
                net_payable_minor = $4, status = 'PENDING', updated_at = now() WHERE id = $1`,
        [settlementId, total?.gross ?? "0", total?.commission ?? "0", total?.net ?? "0"]
      );
      if (inserted > 0) {
        generated.push({
          id: settlementId, merchantId: group.merchantId, netPayableMinor: Number(total?.net ?? 0),
          currency: group.currency, orderCount: total?.order_count ?? 0
        });
      }
    }
    if (generated.length > 0) {
      await this.audit.record({
        actorUserId, action: "settlement.merchants_generated", entityType: "merchant_settlement", entityId: null, requestId,
        metadata: { from: from.toISOString(), to: to.toISOString(), settlements: generated.length }
      }, client);
    }
    return { generated, skipped };
  }

  private async generateCourierPayouts(
    client: PoolClient, rows: readonly CourierOrderRow[], from: Date, to: Date, actorUserId: string, requestId: string | null
  ) {
    const generated: Array<{ id: string; courierUserId: string; netPayableMinor: number; currency: string; orderCount: number }> = [];
    const skipped: Array<{ courierUserId: string; reason: string }> = [];
    for (const group of this.groupRawCourierRows(rows)) {
      const existing = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM courier_payouts
         WHERE courier_user_id = $1 AND period_start = $2 AND period_end = $3 AND currency = $4 FOR UPDATE`,
        [group.courierUserId, from, to, group.currency]
      );
      if (existing.rows[0] && existing.rows[0].status !== "PENDING") {
        skipped.push({ courierUserId: group.courierUserId, reason: `Payout is already ${existing.rows[0].status}.` });
        continue;
      }
      const payoutId = existing.rows[0]?.id ?? (await client.query<{ id: string }>(
        `INSERT INTO courier_payouts (courier_user_id, period_start, period_end, currency)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [group.courierUserId, from, to, group.currency]
      )).rows[0]?.id;
      if (!payoutId) throw new Error("Courier payout creation failed.");
      let inserted = 0;
      for (const order of group.orders) {
        const line = await client.query(
          `INSERT INTO courier_payout_orders (payout_id, order_id, courier_earning_minor, tip_minor, net_minor)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING`,
          [payoutId, order.orderId, order.earningMinor, order.tipMinor, order.netMinor]
        );
        inserted += line.rowCount ?? 0;
      }
      const totals = await client.query<{ earnings: string; tips: string; net: string; order_count: number }>(
        `SELECT COALESCE(sum(courier_earning_minor),0)::text AS earnings, COALESCE(sum(tip_minor),0)::text AS tips,
                COALESCE(sum(net_minor),0)::text AS net, count(*)::int AS order_count
         FROM courier_payout_orders WHERE payout_id = $1`,
        [payoutId]
      );
      const total = totals.rows[0];
      await client.query(
        `UPDATE courier_payouts SET gross_earnings_minor = $2, deductions_minor = 0, tips_minor = $3,
                net_payable_minor = $4, status = 'PENDING', updated_at = now() WHERE id = $1`,
        [payoutId, total?.earnings ?? "0", total?.tips ?? "0", total?.net ?? "0"]
      );
      if (inserted > 0) {
        generated.push({
          id: payoutId, courierUserId: group.courierUserId, netPayableMinor: Number(total?.net ?? 0),
          currency: group.currency, orderCount: total?.order_count ?? 0
        });
      }
    }
    if (generated.length > 0) {
      await this.audit.record({
        actorUserId, action: "settlement.couriers_generated", entityType: "courier_payout", entityId: null, requestId,
        metadata: { from: from.toISOString(), to: to.toISOString(), payouts: generated.length }
      }, client);
    }
    return { generated, skipped };
  }

  private async merchantOrders(executor: Pick<PoolClient, "query">, from: Date, to: Date, lock = false) {
    const result = await executor.query<MerchantOrderRow>(
      `SELECT o.id AS order_id, o.merchant_id, m.display_name AS merchant_name, f.currency,
              f.merchant_gross_minor, f.commission_minor
       FROM orders o JOIN merchants m ON m.id = o.merchant_id JOIN order_financials f ON f.order_id = o.id
       WHERE o.delivered_at >= $1 AND o.delivered_at < $2 AND o.status = 'DELIVERED'
         AND o.payment_status IN ('PAID', 'PARTIALLY_REFUNDED')
         AND NOT EXISTS (SELECT 1 FROM merchant_settlement_orders so WHERE so.order_id = o.id)
       ORDER BY o.merchant_id, o.delivered_at ASC ${lock ? "FOR UPDATE OF o" : ""}`,
      [from, to]
    );
    return result.rows;
  }

  private async courierOrders(executor: Pick<PoolClient, "query">, from: Date, to: Date, lock = false) {
    const result = await executor.query<CourierOrderRow>(
      `SELECT o.id AS order_id, da.courier_user_id, cp.full_name AS courier_name, u.phone_e164 AS courier_phone, f.currency,
              f.courier_earning_minor, f.tip_minor
       FROM orders o JOIN delivery_assignments da ON da.order_id = o.id AND da.status = 'delivered'
       JOIN courier_profiles cp ON cp.user_id = da.courier_user_id JOIN users u ON u.id = da.courier_user_id
       JOIN order_financials f ON f.order_id = o.id
       WHERE o.delivered_at >= $1 AND o.delivered_at < $2 AND o.status = 'DELIVERED'
         AND o.payment_status IN ('PAID', 'PARTIALLY_REFUNDED')
         AND NOT EXISTS (SELECT 1 FROM courier_payout_orders po WHERE po.order_id = o.id)
       ORDER BY da.courier_user_id, o.delivered_at ASC ${lock ? "FOR UPDATE OF o" : ""}`,
      [from, to]
    );
    return result.rows;
  }

  private groupMerchantRows(rows: readonly MerchantOrderRow[]) {
    return this.groupRawMerchantRows(rows).map((group) => ({
      merchantId: group.merchantId, merchantName: group.merchantName, currency: group.currency, orderCount: group.orders.length,
      grossMinor: group.orders.reduce((sum, order) => sum + order.grossMinor, 0),
      commissionMinor: group.orders.reduce((sum, order) => sum + order.commissionMinor, 0),
      netPayableMinor: group.orders.reduce((sum, order) => sum + order.netMinor, 0)
    }));
  }

  private groupCourierRows(rows: readonly CourierOrderRow[]) {
    return this.groupRawCourierRows(rows).map((group) => ({
      courierUserId: group.courierUserId, courierName: group.courierName, courierPhone: group.courierPhone, currency: group.currency,
      orderCount: group.orders.length, grossMinor: group.orders.reduce((sum, order) => sum + order.earningMinor, 0),
      tipsMinor: group.orders.reduce((sum, order) => sum + order.tipMinor, 0),
      netPayableMinor: group.orders.reduce((sum, order) => sum + order.netMinor, 0)
    }));
  }

  private groupRawMerchantRows(rows: readonly MerchantOrderRow[]) {
    const groups = new Map<string, {
      merchantId: string; merchantName: string; currency: string;
      orders: Array<{ orderId: string; grossMinor: number; commissionMinor: number; netMinor: number }>;
    }>();
    for (const row of rows) {
      const key = `${row.merchant_id}:${row.currency}`;
      const group = groups.get(key) ?? { merchantId: row.merchant_id, merchantName: row.merchant_name, currency: row.currency, orders: [] };
      const gross = Number(row.merchant_gross_minor);
      const commission = Number(row.commission_minor);
      group.orders.push({ orderId: row.order_id, grossMinor: gross, commissionMinor: commission, netMinor: Math.max(0, gross - commission) });
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private groupRawCourierRows(rows: readonly CourierOrderRow[]) {
    const groups = new Map<string, {
      courierUserId: string; courierName: string | null; courierPhone: string | null; currency: string;
      orders: Array<{ orderId: string; earningMinor: number; tipMinor: number; netMinor: number }>;
    }>();
    for (const row of rows) {
      const key = `${row.courier_user_id}:${row.currency}`;
      const group = groups.get(key) ?? {
        courierUserId: row.courier_user_id, courierName: row.courier_name, courierPhone: row.courier_phone, currency: row.currency, orders: []
      };
      const earning = Number(row.courier_earning_minor);
      const tip = Number(row.tip_minor);
      group.orders.push({ orderId: row.order_id, earningMinor: earning, tipMinor: tip, netMinor: earning + tip });
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private nextStatus(current: string, decision: SettlementDecision) {
    if (decision === "approve") {
      if (current !== "PENDING") throw new ConflictException("Only pending settlements can be approved.");
      return "APPROVED" as const;
    }
    if (decision === "pay") {
      if (current !== "APPROVED") throw new ConflictException("Only approved settlements can be paid.");
      return "PAID" as const;
    }
    if (current !== "PENDING" && current !== "APPROVED") throw new ConflictException("Only pending or approved settlements can be failed.");
    return "FAILED" as const;
  }

  private assertPeriod(from: Date, to: Date) {
    if (!(from instanceof Date) || Number.isNaN(from.getTime()) || !(to instanceof Date) || Number.isNaN(to.getTime())) {
      throw new BadRequestException("A valid settlement period is required.");
    }
    if (to <= from) throw new BadRequestException("The settlement period end must be after its start.");
    if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException("Settlement periods cannot exceed 366 days.");
    }
  }
}
