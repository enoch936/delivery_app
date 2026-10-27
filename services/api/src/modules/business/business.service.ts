import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class BusinessService {
  constructor(private readonly database: DatabaseService) {}

  async register(userId: string, input: Readonly<{ name: string; billingEmail: string | null; billingPhone: string | null; taxIdentifier: string | null; monthlySpendLimitMinor: number | null; currency: string }>) {
    return this.database.withTransaction(async (client) => {
      const account = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO business_accounts (display_name, billing_email, billing_phone_e164, tax_identifier, monthly_spend_limit_minor, currency, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
        [input.name, input.billingEmail, input.billingPhone, input.taxIdentifier, input.monthlySpendLimitMinor, input.currency, userId]
      );
      const id = account.rows[0]?.id;
      if (!id) throw new Error("Business account creation failed.");
      await client.query("INSERT INTO business_members (business_account_id, user_id, member_role) VALUES ($1,$2,'owner')", [id, userId]);
      return { id, status: "pending", createdAt: account.rows[0]?.created_at.toISOString() };
    });
  }

  async mine(userId: string) {
    const result = await this.database.query(
      `SELECT ba.id, ba.display_name AS name, ba.status, ba.currency, ba.monthly_spend_limit_minor, bm.member_role
       FROM business_accounts ba JOIN business_members bm ON bm.business_account_id = ba.id AND bm.user_id = $1
       ORDER BY ba.created_at DESC`,
      [userId]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, name: row.name as string, status: row.status as string, currency: row.currency as string,
        role: row.member_role as string, monthlySpendLimitMinor: (row.monthly_spend_limit_minor as string | null) === null ? null : Number(row.monthly_spend_limit_minor)
      }))
    };
  }

  async detail(userId: string, accountId: string) {
    await this.requireMember(userId, accountId);
    const [account, members, locations, spend] = await Promise.all([
      this.database.query("SELECT id, display_name AS name, status, billing_email, billing_phone_e164, tax_identifier, monthly_spend_limit_minor, currency, created_at FROM business_accounts WHERE id = $1", [accountId]),
      this.database.query("SELECT bm.user_id, bm.member_role, u.display_name, u.phone_e164 FROM business_members bm JOIN users u ON u.id = bm.user_id WHERE bm.business_account_id = $1", [accountId]),
      this.database.query("SELECT id, label, address_line, contact_name, contact_phone_e164, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude FROM business_locations WHERE business_account_id = $1 ORDER BY label", [accountId]),
      this.database.query<{ month_spend: string; total_orders: number }>(
        `SELECT COALESCE(sum(o.total_minor) FILTER (WHERE o.created_at >= date_trunc('month', now()) AND o.status NOT IN ('CANCELLED','FAILED')),0)::text AS month_spend,
                count(*)::int AS total_orders
         FROM business_orders bo JOIN orders o ON o.id = bo.order_id WHERE bo.business_account_id = $1`, [accountId]
      )
    ]);
    const row = account.rows[0];
    if (!row) throw new NotFoundException("Business account not found.");
    return {
      id: row.id, name: row.name, status: row.status, billingEmail: row.billing_email, billingPhone: row.billing_phone_e164,
      taxIdentifier: row.tax_identifier, monthlySpendLimitMinor: row.monthly_spend_limit_minor === null ? null : Number(row.monthly_spend_limit_minor),
      currency: row.currency, createdAt: (row.created_at as Date).toISOString(),
      members: members.rows.map((member) => ({ userId: member.user_id, role: member.member_role, displayName: member.display_name, phoneE164: member.phone_e164 })),
      locations: locations.rows.map((location) => ({
        id: location.id, label: location.label, addressLine: location.address_line, contactName: location.contact_name,
        contactPhoneE164: location.contact_phone_e164, latitude: location.latitude === null ? null : Number(location.latitude),
        longitude: location.longitude === null ? null : Number(location.longitude)
      })),
      spend: { monthSpendMinor: Number(spend.rows[0]?.month_spend ?? 0), totalOrders: spend.rows[0]?.total_orders ?? 0 }
    };
  }

  async addMember(userId: string, accountId: string, phoneE164: string, role: "admin" | "member" | "driver") {
    const membership = await this.requireMember(userId, accountId);
    if (!["owner", "admin"].includes(membership.role)) throw new ForbiddenException("Only business owners and admins can add members.");
    const user = await this.database.query<{ id: string }>("SELECT id FROM users WHERE phone_e164 = $1", [phoneE164]);
    const target = user.rows[0];
    if (!target) throw new NotFoundException("No user with that phone number exists.");
    await this.database.query(
      `INSERT INTO business_members (business_account_id, user_id, member_role) VALUES ($1,$2,$3)
       ON CONFLICT (business_account_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role`,
      [accountId, target.id, role]
    );
    return { userId: target.id, role };
  }

  async addLocation(userId: string, accountId: string, input: Readonly<{ label: string; addressLine: string; contactName: string | null; contactPhone: string | null; latitude: number | null; longitude: number | null }>) {
    await this.requireMember(userId, accountId);
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO business_locations (business_account_id, label, address_line, contact_name, contact_phone_e164, location)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7,$6),4326) END) RETURNING id`,
      [accountId, input.label, input.addressLine, input.contactName, input.contactPhone, input.latitude, input.longitude]
    );
    return { id: result.rows[0]?.id };
  }

  async attachOrder(userId: string, accountId: string, orderId: string, input: Readonly<{ costCenter: string | null; referenceCode: string | null }>) {
    await this.requireMember(userId, accountId);
    const order = await this.database.query("SELECT 1 FROM orders WHERE id = $1 AND user_id = $2", [orderId, userId]);
    if ((order.rowCount ?? 0) === 0) throw new NotFoundException("Order not found.");
    const existing = await this.database.query("SELECT 1 FROM business_orders WHERE order_id = $1", [orderId]);
    if ((existing.rowCount ?? 0) > 0) throw new ConflictException("This order is already linked to a business account.");
    await this.database.query(
      "INSERT INTO business_orders (order_id, business_account_id, cost_center, reference_code, created_by) VALUES ($1,$2,$3,$4,$5)",
      [orderId, accountId, input.costCenter, input.referenceCode, userId]
    );
    return { linked: true };
  }

  async orders(userId: string, accountId: string, limit: number, offset: number) {
    await this.requireMember(userId, accountId);
    const result = await this.database.query(
      `SELECT o.id, o.order_number, o.status, o.total_minor, o.currency, o.created_at, bo.cost_center, bo.reference_code
       FROM business_orders bo JOIN orders o ON o.id = bo.order_id
       WHERE bo.business_account_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [accountId, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderNumber: row.order_number as string, status: row.status as string,
        totalMinor: Number(row.total_minor), currency: row.currency as string, costCenter: row.cost_center,
        referenceCode: row.reference_code, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async adminList(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT ba.id, ba.display_name AS name, ba.status, ba.currency, ba.billing_email, ba.billing_phone_e164, ba.created_at,
              u.phone_e164 AS creator_phone
       FROM business_accounts ba JOIN users u ON u.id = ba.created_by
       WHERE ($1::text IS NULL OR ba.status = $1) ORDER BY ba.created_at DESC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, name: row.name as string, status: row.status as string, currency: row.currency as string,
        billingEmail: row.billing_email, billingPhone: row.billing_phone_e164, creatorPhone: row.creator_phone,
        createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async review(accountId: string, actorUserId: string, decision: "approve" | "reject") {
    const result = await this.database.query(
      `UPDATE business_accounts SET status = $2, approved_by = $3, approved_at = now(), updated_at = now() WHERE id = $1`,
      [accountId, decision === "approve" ? "active" : "closed", actorUserId]
    );
    if (result.rowCount === 0) throw new NotFoundException("Business account not found.");
    return { status: decision === "approve" ? "active" : "closed" };
  }

  private async requireMember(userId: string, accountId: string): Promise<{ role: string }> {
    const result = await this.database.query<{ member_role: string }>("SELECT member_role FROM business_members WHERE business_account_id = $1 AND user_id = $2", [accountId, userId]);
    const row = result.rows[0];
    if (!row) throw new ForbiddenException("You are not a member of this business account.");
    return { role: row.member_role };
  }
}

