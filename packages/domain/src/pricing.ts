import { addMoney, money, subtractMoney, type Money } from "./money.js";

export type QuoteLineItem = Readonly<{
  productId: string;
  displayName: string;
  quantity: number;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
}>;

export type CheckoutQuoteBreakdown = Readonly<{
  currency: string;
  itemsSubtotal: Money;
  deliveryFee: Money;
  serviceFee: Money;
  discount: Money;
  total: Money;
  lineItems: readonly QuoteLineItem[];
}>;

export type PricingPolicy = Readonly<{
  deliveryFeeMinor: bigint;
  serviceFeeMinor: bigint;
  maxDeliveryFeeMinor: bigint;
  minDeliveryFeeMinor: bigint;
}>;

export function buildCheckoutQuote(input: Readonly<{
  currency: string;
  lines: readonly Readonly<{ productId: string; displayName: string; quantity: number; unitPriceMinor: bigint }>[];
  policy: PricingPolicy;
  discountMinor?: bigint;
}>): CheckoutQuoteBreakdown {
  if (input.lines.length === 0) throw new Error("At least one line item is required.");
  const currency = input.currency;
  const lineItems: QuoteLineItem[] = input.lines.map((line) => {
    if (line.quantity < 1 || line.quantity > 99) throw new Error("Invalid line quantity.");
    const lineTotalMinor = line.unitPriceMinor * BigInt(line.quantity);
    return { productId: line.productId, displayName: line.displayName, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor, lineTotalMinor };
  });
  const itemsSubtotal = lineItems.reduce((sum, line) => addMoney(sum, money(line.lineTotalMinor, currency)), money(0n, currency));
  let deliveryFeeMinor = input.policy.deliveryFeeMinor;
  if (deliveryFeeMinor < input.policy.minDeliveryFeeMinor) deliveryFeeMinor = input.policy.minDeliveryFeeMinor;
  if (deliveryFeeMinor > input.policy.maxDeliveryFeeMinor) deliveryFeeMinor = input.policy.maxDeliveryFeeMinor;
  const deliveryFee = money(deliveryFeeMinor, currency);
  const serviceFee = money(input.policy.serviceFeeMinor, currency);
  const discount = money(input.discountMinor ?? 0n, currency);
  const totalBeforeDiscount = addMoney(itemsSubtotal, deliveryFee, serviceFee);
  const total = subtractMoney(totalBeforeDiscount, discount);
  return Object.freeze({ currency, itemsSubtotal, deliveryFee, serviceFee, discount, total, lineItems: Object.freeze(lineItems) });
}
