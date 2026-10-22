import { Inject, Injectable } from "@nestjs/common";
import { buildCheckoutQuote, type PricingPolicy } from "@delivery-app/domain";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./checkout.types.js";

export const CHECKOUT_REPOSITORY = Symbol("CHECKOUT_REPOSITORY");

export type QuoteInputLine = Readonly<{ productId: string; displayName: string; quantity: number; unitPriceMinor: bigint }>;

@Injectable()
export class CheckoutService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  createQuote(input: Readonly<{ currency: string; lines: readonly QuoteInputLine[]; discountMinor?: bigint }>) {
    const policy: PricingPolicy = {
      deliveryFeeMinor: BigInt(this.config.deliveryFeeMinor ?? 0),
      serviceFeeMinor: BigInt(this.config.serviceFeeMinor ?? 0),
      minDeliveryFeeMinor: 0n,
      maxDeliveryFeeMinor: 100000n
    };
    const quoteInput: { currency: string; lines: readonly QuoteInputLine[]; policy: PricingPolicy; discountMinor?: bigint } = { currency: input.currency, lines: input.lines, policy };
    if (input.discountMinor !== undefined) quoteInput.discountMinor = input.discountMinor;
    return buildCheckoutQuote(quoteInput);
  }
}