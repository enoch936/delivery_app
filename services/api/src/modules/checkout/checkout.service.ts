import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { calculateDeliveryPrice } from "@delivery-app/domain";
import { readRuntimeConfig, type RuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";
import type { CheckoutQuoteRecord, QuoteLine, QuoteOption } from "./checkout.types.js";

type CartItemRow = {
  product_id: string;
  display_name: string;
  quantity: number;
  unit_price_minor: string;
  base_price_minor: string;
  currency: string;
  is_available: boolean;
  quantity_available: number | null;
  options: readonly QuoteOption[] | null;
  unavailable_options: number;
  missing_required_options: boolean;
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
  commission_bps: number;
};

type MerchantRow = {
  id: string;
  display_name: string;
  status: string;
  category_slug: string | null;
  city_id: string;
  distance_meters: number | null;
  is_open: boolean;
  is_open_at: boolean;
  is_available: boolean;
  eta_min_minutes: number;
  eta_max_minutes: number;
  supports_pickup: boolean;
  allows_scheduling: boolean;
  min_schedule_lead_minutes: number;
  max_schedule_days: number;
  pickup_location_id: string | null;
  pickup_location_name: string | null;
  pickup_address_line: string | null;
};

export type CreateQuoteInput = Readonly<{
  userId: string;
  merchantId?: string;
  fulfillmentType?: "delivery" | "pickup";
  deliveryAddressId?: string;
  pickupLocationId?: string;
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
    const fulfillmentType = input.fulfillmentType ?? "delivery";
    if (fulfillmentType === "delivery" && !input.deliveryAddressId) {
      throw new BadRequestException("A delivery address is required for delivery orders.");
    }
    if (fulfillmentType === "pickup" && !input.pickupLocationId) {
      throw new BadRequestException("Choose the store you will collect from.");
    }
    const scheduledFor = parseScheduledFor(input.scheduledFor);

    const cartResult = await this.database.query<{ id: string; merchant_id: string }>(
      "SELECT id, merchant_id FROM carts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [input.userId]
    );
    const cart = cartResult.rows[0];
    if (!cart) throw new BadRequestException("Your cart is empty.");
    if (input.merchantId && input.merchantId !== cart.merchant_id) throw new ConflictException("The cart belongs to another merchant.");

    if (fulfillmentType === "delivery" && input.deliveryAddressId) {
      const addressResult = await this.database.query<{ id: string; has_location: boolean }>(
        "SELECT id, location IS NOT NULL AS has_location FROM customer_addresses WHERE id = $1 AND user_id = $2",
        [input.deliveryAddressId, input.userId]
      );
      if (!addressResult.rows[0]) throw new NotFoundException("Delivery address not found.");
      if (!addressResult.rows[0].has_location) throw new UnprocessableEntityException("Add a map location to this delivery address before checkout.");
    }

    const targetAt = scheduledFor ?? new Date();
    const merchant = fulfillmentType === "pickup"
      ? await this.loadPickupMerchant(cart.id, input.pickupLocationId ?? "", targetAt)
      : await this.loadDeliveryMerchant(cart.id, input.deliveryAddressId ?? "", targetAt);
    if (!merchant) throw new ConflictException("This merchant is not available right now.");

    if (fulfillmentType === "pickup" && !merchant.supports_pickup) {
      throw new ConflictException("This merchant does not offer collection at the store.");
    }
    if (fulfillmentType === "delivery") {
      if (merchant.distance_meters === null) throw new UnprocessableEntityException("Unable to calculate delivery distance for this address.");
      if (!merchant.is_available) throw new UnprocessableEntityException("This merchant does not deliver to the selected address yet. Choose another address or merchant.");
    }
    if (scheduledFor) {
      if (!merchant.allows_scheduling || merchant.max_schedule_days <= 0) throw new ConflictException("This merchant does not accept scheduled orders.");
      const leadMs = merchant.min_schedule_lead_minutes * 60_000;
      if (scheduledFor.getTime() - Date.now() < leadMs) {
        throw new ConflictException(`Choose a time at least ${merchant.min_schedule_lead_minutes} minutes from now.`);
      }
      if (scheduledFor.getTime() > Date.now() + merchant.max_schedule_days * 86_400_000) {
        throw new ConflictException(`Scheduled orders can be placed at most ${merchant.max_schedule_days} day${merchant.max_schedule_days === 1 ? "" : "s"} ahead.`);
      }
    }
    if (!merchant.is_open_at) {
      throw new ConflictException(scheduledFor
        ? "The merchant is closed at the time you selected. Choose another time."
        : "This merchant is closed right now. Schedule the order or try again during opening hours.");
    }

    const itemsResult = await this.database.query<CartItemRow>(
      `SELECT ci.product_id, p.display_name, ci.quantity, ci.unit_price_minor, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              COALESCE((
                SELECT json_agg(json_build_object('optionId', cio.option_id, 'displayName', cio.display_name, 'priceDeltaMinor', cio.price_delta_minor) ORDER BY cio.display_name)
                FROM cart_item_options cio WHERE cio.cart_item_id = ci.id
              ), '[]'::json) AS options,
              (SELECT count(*)::int FROM cart_item_options cio JOIN product_options o ON o.id = cio.option_id
                WHERE cio.cart_item_id = ci.id AND o.is_available = false) AS unavailable_options,
              EXISTS (SELECT 1 FROM product_option_groups g
                WHERE g.product_id = p.id AND g.is_required
                  AND (SELECT count(*) FROM cart_item_options cio2 JOIN product_options o2 ON o2.id = cio2.option_id
                        WHERE cio2.cart_item_id = ci.id AND o2.group_id = g.id) < GREATEST(g.min_selections, 1)) AS missing_required_options
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE ci.cart_id = $1 ORDER BY ci.created_at`,
      [cart.id]
    );
    if (itemsResult.rows.length === 0) throw new BadRequestException("Your cart is empty.");
    if (itemsResult.rows.some((item) => item.unavailable_options > 0 || item.missing_required_options)) {
      throw new ConflictException("Some item options are no longer available. Refresh your cart and choose again.");
    }
    const unavailable = itemsResult.rows.filter((item) => !item.is_available || (item.quantity_available !== null && item.quantity > item.quantity_available));
    if (unavailable.length > 0) {
      throw new ConflictException({
        message: "Some items are no longer available. Update your cart and try again.",
        details: unavailable.map((item) => ({ productId: item.product_id, displayName: item.display_name }))
      });
    }

    const currency = itemsResult.rows[0]?.currency ?? this.config.defaultCurrency;
    const lines: QuoteLine[] = itemsResult.rows.map((item) => {
      const options = (item.options ?? []).map((option) => ({
        optionId: option.optionId,
        displayName: option.displayName,
        priceDeltaMinor: Number(option.priceDeltaMinor)
      }));
      const expectedUnitPriceMinor = Number(item.base_price_minor) + options.reduce((sum, option) => sum + option.priceDeltaMinor, 0);
      if (Number(item.unit_price_minor) !== expectedUnitPriceMinor) {
        throw new ConflictException(`The price of ${item.display_name} has changed. Refresh your cart to continue.`);
      }
      if (item.currency !== currency) throw new ConflictException("Cart items use different currencies.");
      return {
        productId: item.product_id,
        displayName: item.display_name,
        quantity: item.quantity,
        unitPriceMinor: expectedUnitPriceMinor,
        lineTotalMinor: expectedUnitPriceMinor * item.quantity,
        currency,
        options,
        optionsLabel: options.map((option) => option.displayName).join(" · ")
      };
    });
    const itemsSubtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);

    const pricingResult = await this.database.query<PricingRow>(
      `SELECT id, base_delivery_fee_minor, per_km_fee_minor, minimum_delivery_fee_minor, maximum_delivery_fee_minor,
              service_fee_minor, night_surcharge_minor, currency, commission_bps
       FROM pricing_rules
       WHERE is_active = true AND (city_id = $1 OR city_id IS NULL)
         AND (service_category_slug = $2 OR service_category_slug IS NULL)
         AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
       ORDER BY (city_id IS NOT NULL) DESC, (service_category_slug IS NOT NULL) DESC, effective_from DESC
       LIMIT 1`,
      [merchant.city_id, merchant.category_slug]
    );
    const pricing = pricingResult.rows[0];
    const serviceFeeMinor = Number(pricing?.service_fee_minor ?? this.config.serviceFeeMinor);
    const delivery = fulfillmentType === "delivery" && merchant.distance_meters !== null
      ? calculateDeliveryPrice({
          rule: {
            baseFeeMinor: BigInt(pricing?.base_delivery_fee_minor ?? this.config.deliveryFeeMinor.toString()),
            perKilometerMinor: BigInt(pricing?.per_km_fee_minor ?? "0"),
            minimumFeeMinor: BigInt(pricing?.minimum_delivery_fee_minor ?? "0"),
            maximumFeeMinor: BigInt(pricing?.maximum_delivery_fee_minor ?? "1000000"),
            serviceFeeMinor: BigInt(serviceFeeMinor),
            nightSurchargeMinor: BigInt(pricing?.night_surcharge_minor ?? "0"),
            currency
          },
          distanceMeters: merchant.distance_meters,
          distanceIsRoadNetwork: false,
          at: new Date()
        })
      : null;
    const deliveryFeeMinor = delivery ? Number(delivery.deliveryTotalMinor) : 0;
    const distanceFeeMinor = delivery ? Number(delivery.distanceFeeMinor) : 0;
    const nightSurchargeMinor = delivery ? Number(delivery.nightSurchargeMinor) : 0;

    const promotion = input.promotionCode ? await this.resolvePromotion(input.userId, input.promotionCode, merchant.id, itemsSubtotalMinor, currency) : null;
    const discountMinor = promotion ? calculateDiscount(promotion, itemsSubtotalMinor) : 0;
    if (discountMinor > itemsSubtotalMinor) throw new BadRequestException("The promotion discount exceeds the order subtotal.");
    const tipMinor = input.tipMinor ?? 0;
    if (!Number.isInteger(tipMinor) || tipMinor < 0 || tipMinor > 1_000_000) throw new BadRequestException("Tip must be a non-negative integer within the allowed limit.");
    const taxableMinor = itemsSubtotalMinor + deliveryFeeMinor + serviceFeeMinor - discountMinor;
    const taxMinor = Math.floor((taxableMinor * this.config.taxRateBps) / 10_000);
    const totalMinor = taxableMinor + taxMinor + tipMinor;
    if (totalMinor < 0) throw new BadRequestException("The order total cannot be negative.");

    const expiresAt = new Date(Date.now() + this.config.quoteValiditySeconds * 1000);
    const estimateMinutes = Math.max(10, Math.round((Number(merchant.eta_min_minutes) + Number(merchant.eta_max_minutes)) / 2));
    const distanceMeters = Math.round(merchant.distance_meters ?? 0);
    const lineItemsJson = lines.map((line) => ({ ...line, options: [...line.options] }));
    const result = await this.database.query<{ id: string; created_at: Date }>(
      `INSERT INTO checkout_quotes (
         user_id, merchant_id, delivery_address_id, currency, items_subtotal_minor, delivery_fee_minor,
         service_fee_minor, discount_minor, total_minor, line_items, expires_at, tip_minor, tax_minor,
         distance_meters, distance_source, delivery_estimate_minutes, promotion_id, pricing_rule_id, service_category_slug,
         fulfillment_type, scheduled_for, pickup_location_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'straight_line',$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, created_at`,
      [
        input.userId, merchant.id, fulfillmentType === "delivery" ? input.deliveryAddressId : null, currency, itemsSubtotalMinor,
        deliveryFeeMinor, serviceFeeMinor, discountMinor, totalMinor,
        JSON.stringify(lineItemsJson), expiresAt, tipMinor, taxMinor, distanceMeters,
        estimateMinutes, promotion?.id ?? null, pricing?.id ?? null, merchant.category_slug,
        fulfillmentType, scheduledFor, fulfillmentType === "pickup" ? merchant.pickup_location_id : null
      ]
    );
    const created = result.rows[0];
    if (!created) throw new Error("Quote creation did not return a row.");
    return Object.freeze({
      quoteId: created.id,
      merchantId: merchant.id,
      merchantName: merchant.display_name,
      deliveryAddressId: fulfillmentType === "delivery" ? input.deliveryAddressId ?? null : null,
      fulfillment: {
        type: fulfillmentType,
        scheduledFor: scheduledFor?.toISOString() ?? null,
        pickup: fulfillmentType === "pickup" && merchant.pickup_location_id
          ? {
              locationId: merchant.pickup_location_id,
              name: merchant.pickup_location_name ?? merchant.display_name,
              addressLine: merchant.pickup_address_line
            }
          : null,
        deliveryAddressId: fulfillmentType === "delivery" ? input.deliveryAddressId ?? null : null
      },
      lines,
      breakdown: {
        currency,
        itemsSubtotalMinor,
        deliveryFeeMinor,
        distanceFeeMinor,
        nightSurchargeMinor,
        serviceFeeMinor,
        discountMinor,
        taxMinor,
        tipMinor,
        totalMinor,
        distanceMeters,
        distanceSource: "straight_line" as const,
        deliveryEstimateMinutes: estimateMinutes,
        paymentProvider: this.config.paymentsProvider,
        paymentRequired: this.config.paymentsProvider !== "disabled"
      },
      promotionCode: promotion?.code ?? null,
      expiresAt: expiresAt.toISOString(),
      createdAt: created.created_at.toISOString(),
      warnings: fulfillmentType === "delivery"
        ? ["Delivery distance is a straight-line estimate until a routing provider is configured."]
        : ["Collection orders are paid for online; bring your order number to the store."]
    });
  }

  private async loadDeliveryMerchant(cartId: string, addressId: string, at: Date): Promise<MerchantRow | null> {
    const result = await this.database.query<MerchantRow>(
      `SELECT m.id, m.display_name, m.status,
              (SELECT sc.slug FROM merchant_service_categories msc JOIN service_categories sc ON sc.id = msc.service_category_id
               WHERE msc.merchant_id = m.id AND sc.is_active = true ORDER BY sc.sort_order LIMIT 1) AS category_slug,
              ml.city_id,
              ST_DistanceSphere(ml.location::geometry, ca.location::geometry)::float8 AS distance_meters,
              discovery_is_open(ml.opening_hours) AS is_open,
              discovery_is_open(ml.opening_hours, $3) AS is_open_at,
              discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km,
                ST_Y(ca.location), ST_X(ca.location)) AS is_available,
              (discovery_eta(ST_DistanceSphere(ml.location::geometry, ca.location::geometry)::float8 / 1000.0,
                m.eta_min_minutes, m.eta_max_minutes))[1] AS eta_min_minutes,
              (discovery_eta(ST_DistanceSphere(ml.location::geometry, ca.location::geometry)::float8 / 1000.0,
                m.eta_min_minutes, m.eta_max_minutes))[2] AS eta_max_minutes,
              m.supports_pickup, m.allows_scheduling, m.min_schedule_lead_minutes, m.max_schedule_days,
              NULL::uuid AS pickup_location_id, NULL::text AS pickup_location_name, NULL::text AS pickup_address_line
       FROM carts c
       JOIN merchants m ON m.id = c.merchant_id
       JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
       JOIN customer_addresses ca ON ca.id = $2
       WHERE c.id = $1 AND m.status = 'active' AND ml.location IS NOT NULL AND ca.location IS NOT NULL
       ORDER BY ml.created_at ASC LIMIT 1`,
      [cartId, addressId, at]
    );
    return result.rows[0] ?? null;
  }

  private async loadPickupMerchant(cartId: string, locationId: string, at: Date): Promise<MerchantRow | null> {
    const result = await this.database.query<MerchantRow>(
      `SELECT m.id, m.display_name, m.status,
              (SELECT sc.slug FROM merchant_service_categories msc JOIN service_categories sc ON sc.id = msc.service_category_id
               WHERE msc.merchant_id = m.id AND sc.is_active = true ORDER BY sc.sort_order LIMIT 1) AS category_slug,
              ml.city_id,
              0::float8 AS distance_meters,
              discovery_is_open(ml.opening_hours) AS is_open,
              discovery_is_open(ml.opening_hours, $3) AS is_open_at,
              true AS is_available,
              (discovery_eta(0::float8, m.eta_min_minutes, m.eta_max_minutes))[1] AS eta_min_minutes,
              (discovery_eta(0::float8, m.eta_min_minutes, m.eta_max_minutes))[2] AS eta_max_minutes,
              m.supports_pickup, m.allows_scheduling, m.min_schedule_lead_minutes, m.max_schedule_days,
              ml.id AS pickup_location_id, ml.name AS pickup_location_name, ml.address_line AS pickup_address_line
       FROM carts c
       JOIN merchants m ON m.id = c.merchant_id
       JOIN merchant_locations ml ON ml.id = $2 AND ml.merchant_id = m.id AND ml.is_active = true
       WHERE c.id = $1 AND m.status = 'active'
       LIMIT 1`,
      [cartId, locationId, at]
    );
    return result.rows[0] ?? null;
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

function parseScheduledFor(value: string | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new BadRequestException("scheduledFor must be an ISO-8601 timestamp.");
  if (at.getTime() <= Date.now()) throw new BadRequestException("scheduledFor must be in the future.");
  return at;
}

function calculateDiscount(promotion: PromotionRow, subtotalMinor: number): number {
  const raw = promotion.kind === "PERCENT" ? Math.floor((subtotalMinor * promotion.value) / 100) : promotion.value;
  const cappedByMaximum = promotion.maximum_discount_minor === null ? raw : Math.min(raw, Number(promotion.maximum_discount_minor));
  return Math.min(Math.max(0, cappedByMaximum), subtotalMinor);
}
