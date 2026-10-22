import { Body, Controller, Post } from "@nestjs/common";
import { CheckoutService } from "./checkout.service.js";

@Controller("api/v1/checkout")
export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  @Post("quote")
  createQuote(@Body() body: { currency: string; lines: { productId: string; displayName: string; quantity: number; unitPriceMinor: string }[]; discountMinor?: string }) {
    const lines = body.lines.map((line) => ({ ...line, unitPriceMinor: BigInt(line.unitPriceMinor) }));
    const input: { currency: string; lines: { productId: string; displayName: string; quantity: number; unitPriceMinor: bigint }[]; discountMinor?: bigint } = { currency: body.currency, lines };
    if (body.discountMinor) input.discountMinor = BigInt(body.discountMinor);
    return this.service.createQuote(input);
  }
}