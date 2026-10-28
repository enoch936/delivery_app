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

type ChapaInitResponse = { status?: string; message?: string; data?: { checkout_url?: string; tx_ref?: string } };
type ChapaVerifyResponse = { status?: string; message?: string; data?: { status?: string; amount?: string | number; currency?: string } };

export class ChapaPaymentProvider implements PaymentProvider {
  readonly name = "chapa" as const;

  constructor(private readonly secretKey: string, private readonly webhookSecret: string | undefined) {}

  async createCheckout(input: Readonly<{ paymentId: string; orderId: string; amountMinor: number; currency: string; customerEmail: string | null; customerPhone: string; returnUrl: string }>): Promise<CheckoutSession> {
    const txRef = `PAY-${input.paymentId}`;
    const response = await fetch("https://api.chapa.co/v1/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: (input.amountMinor / 100).toFixed(2),
        currency: input.currency,
        email: input.customerEmail ?? "customer@example.com",
        phone_number: input.customerPhone,
        tx_ref: txRef,
        callback_url: `${input.returnUrl.replace(/\/$/, "")}/api/v1/payments/webhooks/chapa`,
        return_url: input.returnUrl,
        customization: { title: "Delivery", description: `Order ${input.orderId}` }
      }),
      signal: AbortSignal.timeout(15_000)
    });
    const body = (await response.json().catch(() => ({}))) as ChapaInitResponse;
    const checkoutUrl = body.data?.checkout_url;
    if (!response.ok || !checkoutUrl) throw new Error(body.message ?? "Chapa checkout initialization failed.");
    return { providerReference: txRef, checkoutUrl, expiresAt: new Date(Date.now() + 30 * 60 * 1000) };
  }

  async refund(input: Readonly<{ providerReference: string; amountMinor: number; currency: string; reason: string }>): Promise<RefundResult> {
    const response = await fetch(`https://api.chapa.co/v1/refund/${encodeURIComponent(input.providerReference)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: (input.amountMinor / 100).toFixed(2), reason: input.reason }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      return { providerReference: input.providerReference, status: "failed", failureReason: body.message ?? `Chapa refund failed with HTTP ${response.status}.` };
    }
    return { providerReference: input.providerReference, status: "succeeded" };
  }

  async fetchStatus(input: Readonly<{ providerReference: string }>): Promise<ProviderPaymentStatus> {
    try {
      const response = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(input.providerReference)}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: AbortSignal.timeout(15_000)
      });
      const body = (await response.json().catch(() => ({}))) as ChapaVerifyResponse;
      if (!response.ok) {
        return { status: "unknown", failureReason: body.message ?? `Chapa verification failed with HTTP ${response.status}.` };
      }
      const status = String(body.data?.status ?? body.status ?? "").toLowerCase();
      const amount = Number(body.data?.amount);
      const result: ProviderPaymentStatus = {
        status: ["success", "succeeded", "paid"].includes(status) ? "succeeded"
          : ["failed", "cancelled", "canceled"].includes(status) ? "failed"
            : ["pending", "processing"].includes(status) ? "pending" : "unknown",
        ...(Number.isFinite(amount) ? { amountMinor: Math.round(amount * 100) } : {}),
        ...(body.message ? { failureReason: body.message } : {})
      };
      return result;
    } catch (error) {
      return { status: "unknown", failureReason: error instanceof Error ? error.message : "Chapa verification failed." };
    }
  }

  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (!this.webhookSecret) return false;
    if (!signature) return false;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const provided = signature.replace(/^sha256=/, "");
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
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
