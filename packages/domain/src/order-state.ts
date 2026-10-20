export const orderStatuses = [
  "PENDING_CONFIRMATION", "AWAITING_PAYMENT", "CONFIRMED", "ACCEPTED_BY_MERCHANT",
  "PREPARING", "READY_FOR_PICKUP", "COURIER_ASSIGNED", "COURIER_ARRIVING_AT_PICKUP",
  "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED", "FAILED", "REFUND_PENDING", "REFUNDED"
] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export type OrderKind = "MERCHANT_DELIVERY" | "PARCEL" | "PICKUP_AND_DROP";

const baseTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_CONFIRMATION: ["AWAITING_PAYMENT", "CONFIRMED", "CANCELLED", "FAILED"],
  AWAITING_PAYMENT: ["CONFIRMED", "CANCELLED", "FAILED"],
  CONFIRMED: ["ACCEPTED_BY_MERCHANT", "COURIER_ASSIGNED", "CANCELLED", "FAILED"],
  ACCEPTED_BY_MERCHANT: ["PREPARING", "READY_FOR_PICKUP", "CANCELLED", "FAILED"],
  PREPARING: ["READY_FOR_PICKUP", "CANCELLED", "FAILED"],
  READY_FOR_PICKUP: ["COURIER_ASSIGNED", "CANCELLED", "FAILED"],
  COURIER_ASSIGNED: ["COURIER_ARRIVING_AT_PICKUP", "CANCELLED", "FAILED"],
  COURIER_ARRIVING_AT_PICKUP: ["PICKED_UP", "CANCELLED", "FAILED"],
  PICKED_UP: ["IN_TRANSIT", "FAILED"],
  IN_TRANSIT: ["DELIVERED", "FAILED"],
  DELIVERED: ["REFUND_PENDING"],
  CANCELLED: ["REFUND_PENDING"],
  FAILED: ["REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: []
};

export function canTransitionOrder(kind: OrderKind, from: OrderStatus, to: OrderStatus): boolean {
  if (!baseTransitions[from].includes(to)) return false;
  if (kind === "MERCHANT_DELIVERY") return true;
  const merchantOnly: readonly OrderStatus[] = ["ACCEPTED_BY_MERCHANT", "PREPARING", "READY_FOR_PICKUP"];
  return !merchantOnly.includes(to);
}

export function assertOrderTransition(kind: OrderKind, from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(kind, from, to)) {
    throw new Error(`Invalid ${kind} transition from ${from} to ${to}.`);
  }
}
