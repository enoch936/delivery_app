export type PaymentMethod = "cash" | "chapa" | "sandbox" | "stripe";

export type CheckoutSession = Readonly<{
  providerReference: string;
  checkoutUrl: string | null;
  expiresAt: Date;
}>;

export type RefundResult = Readonly<{
  providerReference: string;
  status: "succeeded" | "pending" | "failed";
  failureReason?: string;
}>;

export interface PaymentProvider {
  readonly name: PaymentMethod;
  createCheckout(input: Readonly<{ paymentId: string; orderId: string; amountMinor: number; currency: string; customerEmail: string | null; customerPhone: string; returnUrl: string; cancelUrl: string }>): Promise<CheckoutSession>;
  refund(input: Readonly<{ providerReference: string; amountMinor: number; currency: string; reason: string }>): Promise<RefundResult>;
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
}
