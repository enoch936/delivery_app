export type PaymentMethod = "cash" | "chapa" | "sandbox" | "stripe" | "telebirr";

export type CheckoutSession = Readonly<{
  providerReference: string;
  merchantReference?: string;
  checkoutUrl: string | null;
  expiresAt: Date;
}>;

export type RefundResult = Readonly<{
  providerReference: string;
  status: "succeeded" | "pending" | "failed";
  failureReason?: string;
}>;

export type ProviderPaymentStatus = Readonly<{
  status: "succeeded" | "failed" | "pending" | "unknown";
  amountMinor?: number;
  currency?: string;
  providerFeeMinor?: number;
  failureReason?: string;
}>;

export interface PaymentProvider {
  readonly name: PaymentMethod;
  createCheckout(input: Readonly<{
    paymentId: string; orderId: string; amountMinor: number; currency: string; customerEmail: string | null;
    customerPhone: string; returnUrl: string; cancelUrl: string; idempotencyKey?: string;
  }>): Promise<CheckoutSession>;
  refund(input: Readonly<{
    providerReference: string; amountMinor: number; currency: string; reason: string;
    idempotencyKey?: string; fullRefund?: boolean;
  }>): Promise<RefundResult>;
  fetchStatus(input: Readonly<{ providerReference: string; amountMinor: number; currency: string }>): Promise<ProviderPaymentStatus>;
  verifyWebhook(rawBody: string, signature: string | undefined, payload?: Record<string, unknown>): boolean;
}
