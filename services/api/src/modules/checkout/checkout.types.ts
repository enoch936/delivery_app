import type { PaymentProviderName } from "../../config/runtime-config.js";

export type QuoteOption = Readonly<{
  optionId: string;
  displayName: string;
  priceDeltaMinor: number;
}>;

export type QuoteLine = Readonly<{
  productId: string;
  displayName: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
  options: readonly QuoteOption[];
  optionsLabel: string;
}>;

export type QuoteBreakdown = Readonly<{
  currency: string;
  itemsSubtotalMinor: number;
  deliveryFeeMinor: number;
  distanceFeeMinor: number;
  nightSurchargeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  taxMinor: number;
  tipMinor: number;
  totalMinor: number;
  distanceMeters: number;
  distanceSource: "straight_line" | "road_network";
  deliveryEstimateMinutes: number;
  paymentProvider: PaymentProviderName;
  paymentRequired: boolean;
}>;

export type QuoteFulfillment = Readonly<{
  type: "delivery" | "pickup";
  scheduledFor: string | null;
  pickup: Readonly<{ locationId: string; name: string; addressLine: string | null }> | null;
  deliveryAddressId: string | null;
}>;

export type CheckoutQuoteRecord = Readonly<{
  quoteId: string;
  merchantId: string;
  merchantName: string;
  deliveryAddressId: string | null;
  fulfillment: QuoteFulfillment;
  lines: readonly QuoteLine[];
  breakdown: QuoteBreakdown;
  promotionCode: string | null;
  expiresAt: string;
  createdAt: string;
  warnings: readonly string[];
}>;
