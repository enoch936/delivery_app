import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  async summary(from: Date, to: Date) {
    const result = await this.database.query<{
      orders: number; delivered: number; cancelled: number; gmv: string; delivery_fees: string; tips: string;
      commission: string; refunded: string; new_users: number; avg_order: string; avg_delivery_minutes: string;
    }>(
      `SELECT
        count(*)::int AS orders,
        count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
        count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
        COALESCE(sum(total_minor) FILTER (WHERE status NOT IN ('CANCELLED','FAILED')),0)::text AS gmv,
        COALESCE(sum(delivery_fee_minor) FILTER (WHERE status = 'DELIVERED'),0)::text AS delivery_fees,
        COALESCE(sum(tip_minor) FILTER (WHERE status = 'DELIVERED'),0)::text AS tips,
        COALESCE((SELECT sum(f.commission_minor) FROM order_financials f JOIN orders o2 ON o2.id = f.order_id WHERE o2.created_at >= $1 AND o2.created_at < $2 AND o2.status = 'DELIVERED'),0)::text AS commission,
        COALESCE((SELECT sum(r.amount_minor) FROM refunds r WHERE r.created_at >= $1 AND r.created_at < $2 AND r.status = 'SUCCEEDED'),0)::text AS refunded,
        (SELECT count(*)::int FROM users WHERE created_at >= $1 AND created_at < $2) AS new_users,
        COALESCE(avg(total_minor) FILTER (WHERE status NOT IN ('CANCELLED','FAILED')),0)::text AS avg_order,
        COALESCE(avg(EXTRACT(EPOCH FROM (delivered_at - created_at))/60) FILTER (WHERE status = 'DELIVERED' AND delivered_at IS NOT NULL),0)::text AS avg_delivery_minutes
       FROM orders WHERE created_at >= $1 AND created_at < $2`,
      [from, to]
    );
    const row = result.rows[0];
    return {
      from: from.toISOString(), to: to.toISOString(),
      orders: row?.orders ?? 0, delivered: row?.delivered ?? 0, cancelled: row?.cancelled ?? 0,
      gmvMinor: Number(row?.gmv ?? 0), deliveryFeesMinor: Number(row?.delivery_fees ?? 0), tipsMinor: Number(row?.tips ?? 0),
      commissionMinor: Number(row?.commission ?? 0), refundedMinor: Number(row?.refunded ?? 0),
      newUsers: row?.new_users ?? 0, averageOrderMinor: Math.round(Number(row?.avg_order ?? 0)),
      averageDeliveryMinutes: Math.round(Number(row?.avg_delivery_minutes ?? 0) * 10) / 10
    };
  }

  async daily(from: Date, to: Date) {
    const result = await this.database.query(
      `SELECT date_trunc('day', created_at)::date AS day,
              count(*)::int AS orders,
              count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
              COALESCE(sum(total_minor) FILTER (WHERE status NOT IN ('CANCELLED','FAILED')),0)::text AS gmv
       FROM orders WHERE created_at >= $1 AND created_at < $2
       GROUP BY 1 ORDER BY 1`,
      [from, to]
    );
    return { items: result.rows.map((row) => ({ day: row.day, orders: row.orders, delivered: row.delivered, gmvMinor: Number(row.gmv) })) };
  }

  async orders(from: Date, to: Date, status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_minor, o.currency, o.created_at, o.delivered_at,
              COALESCE(o.merchant_name_snapshot, m.display_name) AS merchant_name, u.phone_e164 AS customer_phone,
              (SELECT u2.phone_e164 FROM delivery_assignments da JOIN users u2 ON u2.id = da.courier_user_id WHERE da.order_id = o.id AND da.status = 'delivered' LIMIT 1) AS courier_phone
       FROM orders o JOIN merchants m ON m.id = o.merchant_id JOIN users u ON u.id = o.user_id
       WHERE o.created_at >= $1 AND o.created_at < $2 AND ($3::text IS NULL OR o.status = $3)
       ORDER BY o.created_at DESC LIMIT $4 OFFSET $5`,
      [from, to, status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id, orderNumber: row.order_number, status: row.status, paymentStatus: row.payment_status,
        totalMinor: Number(row.total_minor), currency: row.currency, merchantName: row.merchant_name,
        customerPhone: row.customer_phone, courierPhone: row.courier_phone,
        createdAt: (row.created_at as Date).toISOString(), deliveredAt: (row.delivered_at as Date | null)?.toISOString() ?? null
      }))
    };
  }

  async merchants(from: Date, to: Date) {
    const result = await this.database.query(
      `SELECT m.id, m.display_name, count(o.id)::int AS orders,
              COALESCE(sum(o.items_subtotal_minor) FILTER (WHERE o.status = 'DELIVERED'),0)::text AS gross,
              COALESCE((SELECT sum(f.commission_minor) FROM order_financials f JOIN orders o2 ON o2.id = f.order_id WHERE o2.merchant_id = m.id AND o2.created_at >= $1 AND o2.created_at < $2 AND o2.status = 'DELIVERED'),0)::text AS commission,
              COALESCE(avg(r.merchant_rating),0)::text AS rating
       FROM merchants m LEFT JOIN orders o ON o.merchant_id = m.id AND o.created_at >= $1 AND o.created_at < $2
       LEFT JOIN reviews r ON r.merchant_id = m.id
       GROUP BY m.id ORDER BY gross DESC LIMIT 100`,
      [from, to]
    );
    return {
      items: result.rows.map((row) => ({
        merchantId: row.id, merchantName: row.display_name, orders: row.orders,
        grossMinor: Number(row.gross), commissionMinor: Number(row.commission), rating: Number(row.rating)
      }))
    };
  }

  async couriers(from: Date, to: Date) {
    const result = await this.database.query(
      `SELECT u.id, u.display_name, u.phone_e164, count(da.id) FILTER (WHERE da.status = 'delivered')::int AS deliveries,
              COALESCE(sum(f.courier_earning_minor + f.tip_minor) FILTER (WHERE da.status = 'delivered'),0)::text AS earnings,
              COALESCE(avg(EXTRACT(EPOCH FROM (da.delivered_at - da.picked_up_at))/60) FILTER (WHERE da.status = 'delivered' AND da.picked_up_at IS NOT NULL),0)::text AS avg_minutes,
              COALESCE(cp.rating_average,0)::text AS rating
       FROM users u JOIN courier_profiles cp ON cp.user_id = u.id
       LEFT JOIN delivery_assignments da ON da.courier_user_id = u.id AND da.assigned_at >= $1 AND da.assigned_at < $2
       LEFT JOIN order_financials f ON f.order_id = da.order_id
       GROUP BY u.id, cp.rating_average ORDER BY deliveries DESC LIMIT 100`,
      [from, to]
    );
    return {
      items: result.rows.map((row) => ({
        courierUserId: row.id, displayName: row.display_name, phoneE164: row.phone_e164,
        deliveries: row.deliveries, earningsMinor: Number(row.earnings), averageMinutes: Math.round(Number(row.avg_minutes) * 10) / 10,
        rating: Number(row.rating)
      }))
    };
  }

  async finance(from: Date, to: Date) {
    const [payments, refunds, balances] = await Promise.all([
      this.database.query(
        `SELECT provider, status, count(*)::int AS count, COALESCE(sum(amount_minor),0)::text AS total
         FROM payments WHERE created_at >= $1 AND created_at < $2 GROUP BY provider, status ORDER BY provider, status`,
        [from, to]
      ),
      this.database.query(
        `SELECT status, count(*)::int AS count, COALESCE(sum(amount_minor),0)::text AS total
         FROM refunds WHERE created_at >= $1 AND created_at < $2 GROUP BY status`,
        [from, to]
      ),
      this.database.query(
        `SELECT a.code, a.account_type,
                COALESCE(sum(e.amount_minor) FILTER (WHERE e.side = 'debit'),0)::text AS debit,
                COALESCE(sum(e.amount_minor) FILTER (WHERE e.side = 'credit'),0)::text AS credit
         FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.id ORDER BY a.code`
      )
    ]);
    return {
      payments: payments.rows.map((row) => ({ provider: row.provider, status: row.status, count: row.count, totalMinor: Number(row.total) })),
      refunds: refunds.rows.map((row) => ({ status: row.status, count: row.count, totalMinor: Number(row.total) })),
      ledgerBalances: balances.rows.map((row) => ({
        accountCode: row.code, accountType: row.account_type,
        debitMinor: Number(row.debit), creditMinor: Number(row.credit), netMinor: Number(row.debit) - Number(row.credit)
      }))
    };
  }

  async ordersCsv(from: Date, to: Date): Promise<string> {
    const result = await this.database.query(
      `SELECT o.order_number, o.status, o.payment_status, o.total_minor, o.currency, o.created_at, m.display_name AS merchant_name
       FROM orders o JOIN merchants m ON m.id = o.merchant_id
       WHERE o.created_at >= $1 AND o.created_at < $2 ORDER BY o.created_at`,
      [from, to]
    );
    const header = "order_number,status,payment_status,total_minor,currency,created_at,merchant_name";
    const rows = result.rows.map((row) => [
      row.order_number, row.status, row.payment_status, row.total_minor, row.currency, (row.created_at as Date).toISOString(), row.merchant_name
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
    return [header, ...rows].join("\n");
  }
}
