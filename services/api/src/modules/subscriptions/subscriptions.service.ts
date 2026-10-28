import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../../common/audit.service.js";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService
  ) {}

  async listPlans() {
    const result = await this.database.query("SELECT * FROM subscription_plans WHERE status = 'ACTIVE' ORDER BY price_minor ASC");
    return { items: result.rows.map((row) => this.mapPlan(row)) };
  }

  async createPlan(input: Readonly<{
    code: string; name: string; description?: string; billingInterval: "month" | "year";
    priceMinor: number; currency: string; includedDeliveries?: number; discountBps?: number; actorUserId: string; requestId: string | null;
  }>) {
    if (!/^[a-z0-9-]+$/.test(input.code)) throw new BadRequestException("Plan code must be lowercase alphanumeric with hyphens.");
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException("Currency must be a three-letter ISO code.");
    const result = await this.database.query(
      `INSERT INTO subscription_plans (code, name, description, billing_interval, price_minor, currency, included_deliveries, discount_bps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.code, input.name, input.description ?? null, input.billingInterval, input.priceMinor, input.currency, input.includedDeliveries ?? null, input.discountBps ?? 0]
    );
    const plan = result.rows[0];
    if (!plan?.id) throw new Error("Plan creation failed.");
    await this.audit.record({ actorUserId: input.actorUserId, action: "subscription_plan.created", entityType: "subscription_plan", entityId: plan.id, requestId: input.requestId });
    return this.mapPlan(plan);
  }

  async subscribe(input: Readonly<{
    userId?: string; businessAccountId?: string; planId: string; provider: string; providerReference?: string;
    actorUserId: string; requestId: string | null;
  }>) {
    if ((!input.userId && !input.businessAccountId) || (input.userId && input.businessAccountId)) throw new BadRequestException("Specify either userId or businessAccountId.");
    const plan = await this.database.query("SELECT * FROM subscription_plans WHERE id = $1 AND status = 'ACTIVE'", [input.planId]);
    if (!plan.rows[0]) throw new NotFoundException("Active subscription plan not found.");
    const existing = await this.database.query(
      input.userId
        ? "SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ('TRIALING','ACTIVE','PAST_DUE')"
        : "SELECT id FROM subscriptions WHERE business_account_id = $1 AND status IN ('TRIALING','ACTIVE','PAST_DUE')",
      [input.userId ?? input.businessAccountId]
    );
    if (existing.rows[0]) throw new ConflictException("An active subscription already exists.");
    const now = new Date();
    const periodEnd = new Date(now);
    if (plan.rows[0].billing_interval === "year") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);
    const result = await this.database.query(
      `INSERT INTO subscriptions (user_id, business_account_id, plan_id, provider, provider_reference, status, current_period_start, current_period_end)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7) RETURNING *`,
      [input.userId ?? null, input.businessAccountId ?? null, input.planId, input.provider, input.providerReference ?? null, now, periodEnd]
    );
    const subscription = result.rows[0];
    if (!subscription?.id) throw new Error("Subscription creation failed.");
    await this.database.query(
      "INSERT INTO subscription_invoices (subscription_id, amount_minor, currency, status, due_at) VALUES ($1,$2,$3,'OPEN',$4)",
      [subscription.id, plan.rows[0].price_minor, plan.rows[0].currency, periodEnd]
    );
    await this.audit.record({ actorUserId: input.actorUserId, action: "subscription.created", entityType: "subscription", entityId: subscription.id, requestId: input.requestId, metadata: { planId: input.planId } });
    return this.getSubscription(subscription.id);
  }

  async getSubscription(subscriptionId: string) {
    const result = await this.database.query(
      `SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.billing_interval, p.price_minor, p.currency, p.included_deliveries
       FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.id = $1`,
      [subscriptionId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Subscription not found.");
    const invoices = await this.database.query("SELECT * FROM subscription_invoices WHERE subscription_id = $1 ORDER BY created_at DESC", [subscriptionId]);
    return {
      id: row.id, userId: row.user_id, businessAccountId: row.business_account_id,
      plan: { id: row.plan_id, code: row.plan_code, name: row.plan_name, billingInterval: row.billing_interval, priceMinor: Number(row.price_minor), currency: row.currency, includedDeliveries: row.included_deliveries },
      status: row.status, currentPeriodStart: row.current_period_start.toISOString(), currentPeriodEnd: row.current_period_end.toISOString(),
      cancelAtPeriodEnd: row.cancel_at_period_end, invoices: invoices.rows.map((inv) => ({ id: inv.id, amountMinor: Number(inv.amount_minor), currency: inv.currency, status: inv.status, dueAt: inv.due_at?.toISOString() ?? null, paidAt: inv.paid_at?.toISOString() ?? null }))
    };
  }

  async cancel(subscriptionId: string, actorUserId: string, requestId: string | null) {
    const result = await this.database.query("UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = $1 AND status IN ('TRIALING','ACTIVE') RETURNING id", [subscriptionId]);
    if (result.rowCount === 0) throw new NotFoundException("Subscription not found or cannot be cancelled.");
    await this.audit.record({ actorUserId, action: "subscription.cancelled", entityType: "subscription", entityId: subscriptionId, requestId });
    return this.getSubscription(subscriptionId);
  }

  private mapPlan(row: any) {
    return {
      id: row.id, code: row.code, name: row.name, description: row.description,
      billingInterval: row.billing_interval, priceMinor: Number(row.price_minor), currency: row.currency,
      includedDeliveries: row.included_deliveries, discountBps: row.discount_bps, status: row.status
    };
  }
}
