import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import type { CheckoutSession, PaymentProvider, ProviderPaymentStatus, RefundResult } from "./payments.types.js";

export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox" as const;

  constructor(private readonly publicApiBaseUrl: string, private readonly webhookSecret: string | undefined) {}

  async createCheckout(input: Readonly<{ paymentId: string; amountMinor: number; currency: string }>): Promise<CheckoutSession> {
    return {
      providerReference: `SBX-${input.paymentId}`,
      checkoutUrl: `${this.publicApiBaseUrl.replace(/\/$/, "")}/api/v1/payments/sandbox/${input.paymentId}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    };
  }

  async refund(input: Readonly<{ providerReference: string }>): Promise<RefundResult> {
    return { providerReference: `SBX-RF-${input.providerReference}`, status: "succeeded" };
  }

  async fetchStatus(): Promise<ProviderPaymentStatus> {
    return { status: "unknown", failureReason: "The sandbox provider has no remote payment status." };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!this.webhookSecret) return true;
    if (!signature) return false;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const provided = signature.replace(/^sha256=/, "");
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  }
}

type ChapaErrorResponse = {
  status?: string; message?: string; error?: { code?: string; details?: unknown };
};
type ChapaHostedResponse = ChapaErrorResponse & {
  data?: { checkout_url?: string; created_at?: string; expires_at?: string };
};
type ChapaVerifyResponse = ChapaErrorResponse & {
  data?: {
    chapa_reference?: string; merchant_reference?: string; amount?: string | number;
    currency?: string; status?: string; service_fee?: string | number; reason?: string;
  };
};
type ChapaRefundResponse = ChapaErrorResponse & {
  data?: {
    chapa_reference?: string; payment_reference?: string; amount?: string | number;
    currency?: string; status?: string; reason?: string;
  };
};

export type ChapaProviderOptions = Readonly<{
  baseUrl?: string;
  callbackUrl?: string;
  fetcher?: typeof fetch;
}>;

function chapaStatus(value: unknown): "succeeded" | "failed" | "pending" | "unknown" {
  const status = String(value ?? "").toUpperCase();
  if (status === "SUCCESS" || status === "SUCCEEDED" || status === "PAID") return "succeeded";
  if (["FAILED", "CANCELLED", "CANCELED", "INCOMPLETE", "BLOCKED"].includes(status)) return "failed";
  if (["PENDING", "PROCESSING", "AUTH_NEEDED"].includes(status)) return "pending";
  return "unknown";
}

function positiveMinorAmount(value: unknown): number | undefined {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

export class ChapaPaymentProvider implements PaymentProvider {
  readonly name = "chapa" as const;
  private readonly baseUrl: string;
  private readonly callbackUrl: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(private readonly secretKey: string, private readonly webhookSecret: string | undefined, options: ChapaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.chapa.global").replace(/\/$/, "");
    this.callbackUrl = options.callbackUrl;
    this.fetcher = options.fetcher ?? fetch;
  }

  async createCheckout(input: Readonly<{
    paymentId: string; orderId: string; amountMinor: number; currency: string; customerEmail: string | null;
    customerPhone: string; returnUrl: string; idempotencyKey?: string;
  }>): Promise<CheckoutSession> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 100) throw new Error("Chapa payments require at least 100 minor units.");
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("Chapa currency must be a three-letter ISO code.");
    const merchantReference = `PAY${input.paymentId.replace(/-/g, "").slice(0, 16)}`;
    const phone = input.customerPhone.replace(/[^\d]/g, "").replace(/^0/, "251");
    const customer: Record<string, string> = {};
    if (input.customerEmail) customer.email = input.customerEmail;
    if (phone) customer.phone_number = phone;
    const callbackUrl = this.callbackUrl ?? `${input.returnUrl.replace(/\/$/, "")}/api/v1/payments/webhooks/chapa`;
    const response = await this.fetcher(`${this.baseUrl}/v2/payments/hosted`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey ?? `checkout-${input.paymentId}`
      },
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        merchant_reference: merchantReference,
        ...(Object.keys(customer).length > 0 ? { customer } : {}),
        callback_url: callbackUrl,
        return_url: input.returnUrl,
        meta: { payment_id: input.paymentId, order_id: input.orderId },
        customization: { title: "Delivery", description: `Order ${input.orderId}` }
      }),
      signal: AbortSignal.timeout(15_000)
    });
    const body = (await response.json().catch(() => ({}))) as ChapaHostedResponse;
    const checkoutUrl = body.data?.checkout_url;
    if (!response.ok || body.status === "error" || !checkoutUrl) throw new Error(body.message ?? "Chapa checkout initialization failed.");
    let providerReference = merchantReference;
    try {
      providerReference = new URL(checkoutUrl).pathname.split("/").filter(Boolean).pop() ?? merchantReference;
    } catch {
      // Keep the merchant reference when a non-standard checkout host is returned.
    }
    const expiresAt = body.data?.expires_at ? new Date(body.data.expires_at) : new Date(Date.now() + 30 * 60 * 1000);
    return {
      providerReference,
      merchantReference,
      checkoutUrl,
      expiresAt: Number.isNaN(expiresAt.getTime()) ? new Date(Date.now() + 30 * 60 * 1000) : expiresAt
    };
  }

  async refund(input: Readonly<{
    providerReference: string; amountMinor: number; currency: string; reason: string;
    idempotencyKey?: string; fullRefund?: boolean;
  }>): Promise<RefundResult> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { providerReference: input.providerReference, status: "failed", failureReason: "Refund amount must be a positive integer in minor units." };
    }
    try {
      const response = await this.fetcher(`${this.baseUrl}/v2/refunds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey ?? `refund-${input.providerReference}-${input.amountMinor}`
        },
        body: JSON.stringify({
          payment_reference: input.providerReference,
          ...(input.fullRefund ? {} : { amount: input.amountMinor }),
          reason: input.reason.slice(0, 400),
          meta: { source: "delivery_app" }
        }),
        signal: AbortSignal.timeout(15_000)
      });
      const body = (await response.json().catch(() => ({}))) as ChapaRefundResponse;
      if (!response.ok || body.status === "error" || !body.data) {
        return {
          providerReference: body.data?.chapa_reference ?? input.providerReference,
          status: "failed",
          failureReason: body.message ?? `Chapa refund failed with HTTP ${response.status}.`
        };
      }
      return {
        providerReference: body.data.chapa_reference ?? input.providerReference,
        status: chapaStatus(body.data.status) === "succeeded" ? "succeeded" : chapaStatus(body.data.status) === "failed" ? "failed" : "pending"
      };
    } catch (error) {
      return {
        providerReference: input.providerReference,
        status: "failed",
        failureReason: error instanceof Error ? error.message : "Chapa refund failed."
      };
    }
  }

  async fetchStatus(input: Readonly<{ providerReference: string }>): Promise<ProviderPaymentStatus> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/v2/payments/${encodeURIComponent(input.providerReference)}/verify`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: AbortSignal.timeout(15_000)
      });
      const body = (await response.json().catch(() => ({}))) as ChapaVerifyResponse;
      if (!response.ok || body.status === "error") {
        return { status: "unknown", failureReason: body.message ?? `Chapa verification failed with HTTP ${response.status}.` };
      }
      const amountMinor = positiveMinorAmount(body.data?.amount);
      const providerFeeMinor = positiveMinorAmount(body.data?.service_fee);
      return {
        status: chapaStatus(body.data?.status),
        ...(amountMinor !== undefined ? { amountMinor } : {}),
        ...(body.data?.currency ? { currency: body.data.currency.toUpperCase() } : {}),
        ...(providerFeeMinor !== undefined ? { providerFeeMinor } : {}),
        ...(body.data?.reason ? { failureReason: body.data.reason } : {})
      };
    } catch (error) {
      return { status: "unknown", failureReason: error instanceof Error ? error.message : "Chapa verification failed." };
    }
  }

  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest();
    const provided = Buffer.from(signature, "hex");
    return provided.length === expected.length && timingSafeEqual(expected, provided);
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(secretKey: string, private readonly webhookSecret: string | undefined) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  async createCheckout(input: Readonly<{ paymentId: string; orderId: string; amountMinor: number; currency: string; customerEmail: string | null; customerPhone: string; returnUrl: string; cancelUrl: string }>): Promise<CheckoutSession> {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.amountMinor,
          product_data: { name: `Delivery order ${input.orderId}` }
        }
      }],
      client_reference_id: input.paymentId,
      metadata: { paymentId: input.paymentId, orderId: input.orderId },
      success_url: input.returnUrl,
      cancel_url: input.cancelUrl
    };
    if (input.customerEmail) params.customer_email = input.customerEmail;
    const session = await this.stripe.checkout.sessions.create(params);
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return {
      providerReference: session.id,
      checkoutUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : new Date(Date.now() + 30 * 60 * 1000)
    };
  }

  async refund(input: Readonly<{ providerReference: string; amountMinor: number; currency: string; reason: string }>): Promise<RefundResult> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(input.providerReference, { expand: ["payment_intent"] });
      const intent = session.payment_intent;
      const paymentIntentId = typeof intent === "string" ? intent : intent?.id;
      if (!paymentIntentId) return { providerReference: input.providerReference, status: "failed", failureReason: "Stripe checkout session has no payment intent." };
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: input.amountMinor,
        reason: "requested_by_customer",
        metadata: { reason: input.reason.slice(0, 500) }
      });
      const status = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";
      return { providerReference: refund.id, status };
    } catch (error) {
      return { providerReference: input.providerReference, status: "failed", failureReason: error instanceof Error ? error.message : "Stripe refund failed." };
    }
  }

  async fetchStatus(input: Readonly<{ providerReference: string }>): Promise<ProviderPaymentStatus> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(input.providerReference);
      const status = session.payment_status === "paid" ? "succeeded"
        : session.status === "expired" ? "failed"
          : session.payment_status === "unpaid" || session.payment_status === "no_payment_required" ? "pending" : "unknown";
      return {
        status,
        ...(session.amount_total !== null ? { amountMinor: session.amount_total } : {}),
        ...(session.status === "expired" ? { failureReason: "Stripe checkout session expired." } : {})
      };
    } catch (error) {
      return { status: "unknown", failureReason: error instanceof Error ? error.message : "Stripe session retrieval failed." };
    }
  }

  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature) return false;
    try {
      this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }
}
