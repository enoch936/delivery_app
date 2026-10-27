import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { calculateDeliveryPrice } from "@delivery-app/domain";
import { readRuntimeConfig, type RuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";
import type { CheckoutQuoteRecord, QuoteLine } from "./checkout.types.js";

type CartItemRow = {
  product_id: string;
  display_name: string;
  quantity: number;
  base_price_minor: string;
  currency: string;
  is_available: boolean;
  quantity_available: number | null;
};

type PricingRow = {
  id: string;
  base_delivery_fee_minor: string;
  per_km_fee_minor: string;
  minimum_delivery_fee_minor: string;
  maximum_delivery_fee_minor: string;
  service_fee_minor: string;
  night_surcharge_minor: string;
  currency: string;
};

export type CreateQuoteInput = Readonly<{
  userId: string;
  merchantId?: string;
  deliveryAddressId: string;
  promotionCode?: string;
  tipMinor?: number;
  scheduledFor?: string;
}>;

@Injectable()
export class CheckoutService {
  private readonly config: RuntimeConfig;

  constructor(private readonly database: DatabaseService) {
    this.config = readRuntimeConfig();
  }

  async createQuote(input: CreateQuoteInput): Promise<CheckoutQuoteRecord> {
    const cartResult = await this.database.query<{ id: string; merchant_id: string; currency: string }>(
      "SELECT id, merchant_id, 'ETB'::char(3) AS currency FROM carts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [input.userId]
    );
    const cart = cartResult.rows[0];
    if (!cart) throw new BadRequestException("Your cart is empty.");
    if (input.merchantId && input.merchantId !== cart.merchant_id) throw new ConflictException("The cart belongs to another merchant.");

    const addressResult = await this.database.query<{ id: string; has_location: boolean }>(
      "SELECT id, location IS NOT NULL AS has_location FROM customer_addresses WHERE id = $1 AND user_id = $2",
      [input.deliveryAddressId, input.userId]
    );
    if (!addressResult.rows[0]) throw new NotFoundException("Delivery address not found.");
    if (!addressResult.rows[0].has_location) throw new UnprocessableEntityException("Add a map location to this delivery address before checkout.");

    const merchantResult = await this.database.query<{ id: string; display_name: string; status: string; category_slug: string | null; city_id: string; distance_meters: number | null }>(
      `SELECT m.id, m.display_name, m.status,
              (SELECT sc.slug FROM merchant_service_categories msc JOIN service_categories sc ON sc.id = msc.service_category_id
               WHERE msc.merchant_id = m.id AND sc.is_active = true ORDER BY sc.sort_order LIMIT 1) AS category_slug,
              ml.city_id,
              ST_DistanceSphere(ml.location::geometry, ca.location::geometry)::float8 AS distance_meters
       FROM carts c
       JOIN merchants m ON m.id = c.merchant_id
       JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
       JOIN customer_addresses ca ON ca.id = $2
       WHERE c.id = $1 AND m.status = 'active' AND ml.location IS NOT NULL
       ORDER BY ml.created_at ASC LIMIT 1`,
      [cart.id, input.deliveryAddressId]
    );
    const merchant = merchantResult.rows[0];
    if (!merchant) throw new ConflictException("This merchant is not available for delivery right now.");
    if (merchant.distance_meters === null) throw new UnprocessableEntityException("Unable to calculate delivery distance for this address.");

    const itemsResult = await this.database.query<CartItemRow>(
      `SELECT ci.product_id, p.display_name, ci.quantity, p.base_price_minor, p.currency, p.is_available, i.quantity_available
       FROM cart_items ci JOIN products p ON p.id = ci.product_id LEFT JOIN inventory i ON i.product_id = p.id
       WHERE ci.cart_id = $1 ORDER BY ci.created_at`,
      [cart.id]
    );
    if (itemsResult.rows.length === 0) throw new BadRequestException("Your cart is empty.");
    const unavailable = itemsResult.rows.filter((item) => !item.is_available || (item.quantity_available !== null && item.quantity > item.quantity_available));
    if (unavailable.length > 0) {
      throw new ConflictException({
        message: "Some items are no longer available. Update your cart and try again.",
        details: unavailable.map((item) => ({ productId: item.product_id, displayName: item.display_name }))
      });
    }

    const currency = itemsResult.rows[0]?.currency ?? this.config.defaultCurrency;
    const lines: QuoteLine[] = itemsResult.rows.map((item) => {
      const unitPriceMinor = Number(item.base_price_minor);
      if (item.currency !== currency) throw new ConflictException("Cart items use different currencies.");
      return { productId: item.product_id, displayName: item.display_name, quantity: item.quantity, unitPriceMinor, lineTotalMinor: unitPriceMinor * item.quantity, currency };
    });
    const itemsSubtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);

    const pricingResult = await this.database.query<PricingRow>(
      `SELECT id, base_delivery_fee_minor, per_km_fee_minor, minimum_delivery_fee_minor, maximum_delivery_fee_minor,
              service_fee_minor, night_surcharge_minor, currency
       FROM pricing_rules
       WHERE is_active = true AND (city_id = $1 OR city_id IS NULL)
         AND (service_category_slug = $2 OR service_category_slug IS NULL)
         AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
       ORDER BY (city_id IS NOT NULL) DESC, (service_category_slug IS NOT NULL) DESC, effective_from DESC
       LIMIT 1`,
      [merchant.city_id, merchant.category_slug]
    );
    const pricing = pricingResult.rows[0];
    const delivery = calculateDeliveryPrice({
      rule: {
        baseFeeMinor: BigInt(pricing?.base_delivery_fee_minor ?? this.config.deliveryFeeMinor.toString()),
        perKilometerMinor: BigInt(pricing?.per_km_fee_minor ?? "0"),
        minimumFeeMinor: BigInt(pricing?.minimum_delivery_fee_minor ?? "0"),
        maximumFeeMinor: BigInt(pricing?.maximum_delivery_fee_minor ?? "1000000"),
        serviceFeeMinor: BigInt(pricing?.service_fee_minor ?? this.config.serviceFeeMinor.toString()),
        nightSurchargeMinor: BigInt(pricing?.night_surcharge_minor ?? "0"),
        currency
      },
      distanceMeters: merchant.distance_meters,
      distanceIsRoadNetwork: false,
      at: new Date()
    });

    const promotion = input.promotionCode ? await this.resolvePromotion(input.userId, input.promotionCode, merchant.id, itemsSubtotalMinor, currency) : null;
    const discountMinor = promotion ? calculateDiscount(promotion, itemsSubtotalMinor) : 0;
    if (discountMinor > itemsSubtotalMinor) throw new BadRequestException("The promotion discount exceeds the order subtotal.");
    const tipMinor = input.tipMinor ?? 0;
    if (!Number.isInteger(tipMinor) || tipMinor < 0 || tipMinor > 1_000_000) throw new BadRequestException("Tip must be a non-negative integer within the allowed limit.");
    const taxableMinor = itemsSubtotalMinor + Number(delivery.deliveryTotalMinor) + Number(delivery.serviceFeeMinor) - discountMinor;
    const taxMinor = Math.floor((taxableMinor * this.config.taxRateBps) / 10_000);
    const totalMinor = taxableMinor + taxMinor + tipMinor;
    if (totalMinor < 0) throw new BadRequestException("The order total cannot be negative.");

    const expiresAt = new Date(Date.now() + this.config.quoteValiditySeconds * 1000);
    const estimateMinutes = Math.max(15, Math.round(15 + merchant.distance_meters / 250));
    const lineItemsJson = lines.map((line) => ({ ...line }));
    const result = await this.database.query<{ id: string; created_at: Date }>(
      `INSERT INTO checkout_quotes (
         user_id, merchant_id, delivery_address_id, currency, items_subtotal_minor, delivery_fee_minor,
         service_fee_minor, discount_minor, total_minor, line_items, expires_at, tip_minor, tax_minor,
         distance_meters, distance_source, delivery_estimate_minutes, promotion_id, pricing_rule_id, service_category_slug
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'straight_line',$15,$16,$17,$18)
       RETURNING id, created_at`,
      [
        input.userId, merchant.id, input.deliveryAddressId, currency, itemsSubtotalMinor,
        Number(delivery.deliveryTotalMinor), Number(delivery.serviceFeeMinor), discountMinor, totalMinor,
        JSON.stringify(lineItemsJson), expiresAt, tipMinor, taxMinor, Math.round(merchant.distance_meters),
        estimateMinutes, promotion?.id ?? null, pricing?.id ?? null, merchant.category_slug
      ]
    );
    const created = result.rows[0];
    if (!created) throw new Error("Quote creation did not return a row.");
    return Object.freeze({
      quoteId: created.id,
      merchantId: merchant.id,
      merchantName: merchant.display_name,
      deliveryAddressId: input.deliveryAddressId,
      lines,
      breakdown: {
        currency,
        itemsSubtotalMinor,
        deliveryFeeMinor: Number(delivery.deliveryTotalMinor),
        distanceFeeMinor: Number(delivery.distanceFeeMinor),
        nightSurchargeMinor: Number(delivery.nightSurchargeMinor),
        serviceFeeMinor: Number(delivery.serviceFeeMinor),
        discountMinor,
        taxMinor,
        tipMinor,
        totalMinor,
        distanceMeters: Math.round(merchant.distance_meters),
        distanceSource: "straight_line" as const,
        deliveryEstimateMinutes: estimateMinutes,
        paymentProvider: this.config.paymentsProvider,
        paymentRequired: this.config.paymentsProvider !== "disabled"
      },
      promotionCode: promotion?.code ?? null,
      expiresAt: expiresAt.toISOString(),
      createdAt: created.created_at.toISOString(),
      warnings: ["Delivery distance is a straight-line estimate until a routing provider is configured."]
    });
  }

  private async resolvePromotion(userId: string, code: string, merchantId: string, subtotalMinor: number, currency: string): Promise<PromotionRow> {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,40}$/.test(normalized)) throw new BadRequestException("Promotion code is invalid.");
    const result = await this.database.query<PromotionRow>(
      `SELECT p.id, p.code, p.kind, p.value, p.currency, p.minimum_order_minor, p.maximum_discount_minor, p.usage_limit, p.per_user_limit,
              (SELECT count(*) FROM promotion_redemptions pr WHERE pr.promotion_id = p.id)::int AS total_redemptions,
              (SELECT count(*) FROM promotion_redemptions pr WHERE pr.promotion_id = p.id AND pr.user_id = $2)::int AS user_redemptions
       FROM promotions p
       WHERE p.code = $1 AND p.is_active = true AND p.starts_at <= now() AND (p.ends_at IS NULL OR p.ends_at > now())
         AND (p.merchant_id IS NULL OR p.merchant_id = $3)`,
      [normalized, userId, merchantId]
    );
    const promotion = result.rows[0];
    if (!promotion) throw new NotFoundException("Promotion code is not valid for this order.");
    if (promotion.currency !== currency) throw new ConflictException("Promotion currency does not match the order currency.");
    if (subtotalMinor < Number(promotion.minimum_order_minor)) throw new ConflictException("The order does not meet this promotion's minimum spend.");
    if (promotion.usage_limit !== null && promotion.total_redemptions >= promotion.usage_limit) throw new ConflictException("This promotion has reached its usage limit.");
    if (promotion.user_redemptions >= promotion.per_user_limit) throw new ConflictException("You have already used this promotion.");
    return promotion;
  }
}

type PromotionRow = {
  id: string;
  code: string;
  kind: "PERCENT" | "FIXED";
  value: number;
  currency: string;
  minimum_order_minor: string;
  maximum_discount_minor: string | null;
  usage_limit: number | null;
  per_user_limit: number;
  total_redemptions: number;
  user_redemptions: number;
};

function calculateDiscount(promotion: PromotionRow, subtotalMinor: number): number {
  const raw = promotion.kind === "PERCENT" ? Math.floor((subtotalMinor * promotion.value) / 100) : promotion.value;
  const cappedByMaximum = promotion.maximum_discount_minor === null ? raw : Math.min(raw, Number(promotion.maximum_discount_minor));
  return Math.min(Math.max(0, cappedByMaximum), subtotalMinor);
}
