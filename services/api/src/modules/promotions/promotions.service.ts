import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

type PromotionRow = {
  id: string; code: string; display_name: string; kind: "PERCENT" | "FIXED"; value: number; currency: string;
  minimum_order_minor: string; maximum_discount_minor: string | null; merchant_id: string | null;
  usage_limit: number | null; per_user_limit: number; starts_at: Date; ends_at: Date | null; is_active: boolean;
  total_redemptions?: number; user_redemptions?: number;
};

@Injectable()
export class PromotionsService {
  constructor(private readonly database: DatabaseService) {}

  async listActive(merchantId: string | undefined) {
    const result = await this.database.query<PromotionRow>(
      `SELECT * FROM promotions WHERE is_active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
         AND (merchant_id IS NULL OR merchant_id = $1)
       ORDER BY created_at DESC`,
      [merchantId ?? null]
    );
    return { items: result.rows.map((row) => this.toView(row)) };
  }

  async validate(userId: string, code: string, merchantId: string, subtotalMinor: number, currency: string) {
    const row = await this.findRedeemable(userId, code, merchantId, subtotalMinor, currency);
    const discount = row.kind === "PERCENT" ? Math.floor((subtotalMinor * row.value) / 100) : row.value;
    const capped = row.maximum_discount_minor === null ? discount : Math.min(discount, Number(row.maximum_discount_minor));
    return { code: row.code, displayName: row.display_name, discountMinor: Math.min(subtotalMinor, capped), currency: row.currency };
  }

  async adminList(limit: number, offset: number) {
    const result = await this.database.query<PromotionRow>(
      `SELECT p.*, (SELECT count(*) FROM promotion_redemptions pr WHERE pr.promotion_id = p.id)::int AS total_redemptions
       FROM promotions p ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return { items: result.rows.map((row) => ({ ...this.toView(row), totalRedemptions: row.total_redemptions ?? 0 })) };
  }

  async create(input: Readonly<{ code: string; displayName: string; kind: "PERCENT" | "FIXED"; value: number; currency: string; minimumOrderMinor: number; maximumDiscountMinor: number | null; merchantId: string | null; usageLimit: number | null; perUserLimit: number; startsAt: Date | null; endsAt: Date | null }>) {
    const result = await this.database.query<PromotionRow>(
      `INSERT INTO promotions (code, display_name, kind, value, currency, minimum_order_minor, maximum_discount_minor, merchant_id, usage_limit, per_user_limit, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,now()),$12) RETURNING *`,
      [input.code.toUpperCase(), input.displayName, input.kind, input.value, input.currency, input.minimumOrderMinor,
        input.maximumDiscountMinor, input.merchantId, input.usageLimit, input.perUserLimit, input.startsAt, input.endsAt]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Promotion creation failed.");
    return this.toView(row);
  }

  async update(promotionId: string, input: Readonly<{ displayName?: string | undefined; isActive?: boolean | undefined; endsAt?: string | undefined; usageLimit?: number | undefined; maximumDiscountMinor?: number | undefined }>) {
    const result = await this.database.query<PromotionRow>(
      `UPDATE promotions SET display_name = COALESCE($2, display_name), is_active = COALESCE($3, is_active),
              ends_at = COALESCE($4::timestamptz, ends_at), usage_limit = COALESCE($5, usage_limit),
              maximum_discount_minor = COALESCE($6, maximum_discount_minor)
       WHERE id = $1 RETURNING *`,
      [promotionId, input.displayName ?? null, input.isActive ?? null, input.endsAt ?? null, input.usageLimit ?? null, input.maximumDiscountMinor ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Promotion not found.");
    return this.toView(row);
  }

  async redemptions(promotionId: string, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT pr.id, pr.discount_minor, pr.created_at, o.order_number, u.phone_e164
       FROM promotion_redemptions pr JOIN orders o ON o.id = pr.order_id JOIN users u ON u.id = pr.user_id
       WHERE pr.promotion_id = $1 ORDER BY pr.created_at DESC LIMIT $2 OFFSET $3`,
      [promotionId, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderNumber: row.order_number as string, phone: row.phone_e164 as string | null,
        discountMinor: Number(row.discount_minor), createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  private async findRedeemable(userId: string, code: string, merchantId: string, subtotalMinor: number, currency: string): Promise<PromotionRow> {
    const normalized = code.trim().toUpperCase();
    const result = await this.database.query<PromotionRow>(
      `SELECT p.*, (SELECT count(*) FROM promotion_redemptions pr WHERE pr.promotion_id = p.id)::int AS total_redemptions,
              (SELECT count(*) FROM promotion_redemptions pr WHERE pr.promotion_id = p.id AND pr.user_id = $2)::int AS user_redemptions
       FROM promotions p WHERE p.code = $1 AND p.is_active = true AND p.starts_at <= now() AND (p.ends_at IS NULL OR p.ends_at > now())
         AND (p.merchant_id IS NULL OR p.merchant_id = $3)`,
      [normalized, userId, merchantId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Promotion code is not valid for this order.");
    if (row.currency !== currency) throw new ConflictException("Promotion currency does not match the order.");
    if (subtotalMinor < Number(row.minimum_order_minor)) throw new ConflictException("The order does not meet this promotion's minimum spend.");
    if (row.usage_limit !== null && (row.total_redemptions ?? 0) >= row.usage_limit) throw new ConflictException("This promotion has reached its usage limit.");
    if ((row.user_redemptions ?? 0) >= row.per_user_limit) throw new ConflictException("You have already used this promotion.");
    return row;
  }

  private toView(row: PromotionRow) {
    return {
      id: row.id, code: row.code, displayName: row.display_name, kind: row.kind, value: row.value,
      currency: row.currency, minimumOrderMinor: Number(row.minimum_order_minor),
      maximumDiscountMinor: row.maximum_discount_minor === null ? null : Number(row.maximum_discount_minor),
      merchantId: row.merchant_id, usageLimit: row.usage_limit, perUserLimit: row.per_user_limit,
      startsAt: row.starts_at.toISOString(), endsAt: row.ends_at?.toISOString() ?? null, isActive: row.is_active
    };
  }
}
