import type { OrderStatus } from "./order-state.js";

export type CancellationPolicyInput = Readonly<{
  status: OrderStatus;
  paymentStatus: "UNPAID" | "PENDING" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED";
  orderCreatedAt: Date;
  merchantAcceptedAt: Date | null;
  courierPickedUpAt: Date | null;
  now: Date;
  freeCancellationWindowSeconds: number;
}>;

export type CancellationDecision = Readonly<{
  allowed: boolean;
  requiresReview: boolean;
  refundEligible: boolean;
  reason: string;
}>;

export function decideCancellation(input: CancellationPolicyInput): CancellationDecision {
  if (["DELIVERED", "CANCELLED", "REFUNDED", "FAILED"].includes(input.status)) {
    return Object.freeze({ allowed: false, requiresReview: false, refundEligible: false, reason: "This order can no longer be cancelled." });
  }
  if (input.courierPickedUpAt) {
    return Object.freeze({ allowed: false, requiresReview: true, refundEligible: false, reason: "The courier has already collected this order. Contact support for help." });
  }
  const elapsedSeconds = Math.floor((input.now.getTime() - input.orderCreatedAt.getTime()) / 1000);
  if (input.merchantAcceptedAt || input.status !== "PENDING_CONFIRMATION") {
    return Object.freeze({
      allowed: true,
      requiresReview: input.paymentStatus === "PAID",
      refundEligible: input.paymentStatus === "PAID",
      reason: "The merchant is already preparing this order. Cancellation may require a refund review."
    });
  }
  if (elapsedSeconds <= input.freeCancellationWindowSeconds) {
    return Object.freeze({ allowed: true, requiresReview: false, refundEligible: false, reason: "This order is still within the free cancellation window." });
  }
  return Object.freeze({
    allowed: true,
    requiresReview: input.paymentStatus === "PAID",
    refundEligible: input.paymentStatus === "PAID",
    reason: "This order is awaiting merchant acceptance. Cancellation is subject to review."
  });
}
