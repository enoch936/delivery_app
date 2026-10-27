export type DeliveryPricingRule = Readonly<{
  baseFeeMinor: bigint;
  perKilometerMinor: bigint;
  minimumFeeMinor: bigint;
  maximumFeeMinor: bigint;
  serviceFeeMinor: bigint;
  nightSurchargeMinor: bigint;
  currency: string;
  nightStartsAtHour?: number;
  nightEndsAtHour?: number;
}>;

export type DeliveryPricingInput = Readonly<{
  rule: DeliveryPricingRule;
  distanceMeters: number;
  distanceIsRoadNetwork: boolean;
  at: Date;
  demandMultiplierBps?: number;
  discountMinor?: bigint;
}>;

export type DeliveryPriceBreakdown = Readonly<{
  currency: string;
  distanceMeters: number;
  distanceIsRoadNetwork: boolean;
  baseFeeMinor: bigint;
  distanceFeeMinor: bigint;
  nightSurchargeMinor: bigint;
  demandAdjustmentMinor: bigint;
  serviceFeeMinor: bigint;
  discountMinor: bigint;
  deliveryTotalMinor: bigint;
  grandTotalMinor: bigint;
}>;

const MAX_DEMAND_MULTIPLIER_BPS = 15_000;

export function calculateDeliveryPrice(input: DeliveryPricingInput): DeliveryPriceBreakdown {
  if (!Number.isFinite(input.distanceMeters) || input.distanceMeters < 0) throw new Error("Distance must be a non-negative finite number.");
  if (!/^[A-Z]{3}$/.test(input.rule.currency)) throw new Error("A valid ISO currency is required.");
  const rule = input.rule;
  if (rule.minimumFeeMinor < 0n || rule.maximumFeeMinor < rule.minimumFeeMinor) throw new Error("Invalid delivery fee bounds.");
  const baseFeeMinor = rule.baseFeeMinor < rule.minimumFeeMinor ? rule.minimumFeeMinor : rule.baseFeeMinor;
  const distanceFeeMinor = (BigInt(Math.ceil(input.distanceMeters)) * rule.perKilometerMinor) / 1000n;
  const hour = input.at.getHours();
  const night = isNight(hour, rule.nightStartsAtHour ?? 22, rule.nightEndsAtHour ?? 6);
  const nightSurchargeMinor = night ? rule.nightSurchargeMinor : 0n;
  const multiplierBps = clamp(input.demandMultiplierBps ?? 10_000, 10_000, MAX_DEMAND_MULTIPLIER_BPS);
  const rawDelivery = baseFeeMinor + distanceFeeMinor + nightSurchargeMinor;
  const demandAdjustmentMinor = (rawDelivery * BigInt(multiplierBps - 10_000)) / 10_000n;
  let deliveryTotalMinor = rawDelivery + demandAdjustmentMinor;
  if (deliveryTotalMinor < rule.minimumFeeMinor) deliveryTotalMinor = rule.minimumFeeMinor;
  if (deliveryTotalMinor > rule.maximumFeeMinor) deliveryTotalMinor = rule.maximumFeeMinor;
  const discountMinor = input.discountMinor ?? 0n;
  if (discountMinor < 0n) throw new Error("Discount cannot be negative.");
  if (discountMinor > deliveryTotalMinor + rule.serviceFeeMinor) throw new Error("Discount cannot exceed the payable amount.");
  return Object.freeze({
    currency: rule.currency,
    distanceMeters: input.distanceMeters,
    distanceIsRoadNetwork: input.distanceIsRoadNetwork,
    baseFeeMinor,
    distanceFeeMinor,
    nightSurchargeMinor,
    demandAdjustmentMinor,
    serviceFeeMinor: rule.serviceFeeMinor,
    discountMinor,
    deliveryTotalMinor,
    grandTotalMinor: deliveryTotalMinor + rule.serviceFeeMinor - discountMinor
  });
}

function isNight(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
