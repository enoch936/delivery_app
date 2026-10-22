export type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "AWAITING_PAYMENT"
  | "CONFIRMED"
  | "ACCEPTED_BY_MERCHANT"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "COURIER_ASSIGNED"
  | "COURIER_ARRIVING_PICKUP"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED"
  | "REFUND_PENDING"
  | "REFUNDED";

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_CONFIRMATION: ["AWAITING_PAYMENT", "CONFIRMED", "CANCELLED", "FAILED"],
  AWAITING_PAYMENT: ["CONFIRMED", "CANCELLED", "FAILED"],
  CONFIRMED: ["ACCEPTED_BY_MERCHANT", "CANCELLED", "FAILED"],
  ACCEPTED_BY_MERCHANT: ["PREPARING", "CANCELLED", "FAILED"],
  PREPARING: ["READY_FOR_PICKUP", "CANCELLED", "FAILED"],
  READY_FOR_PICKUP: ["COURIER_ASSIGNED", "CANCELLED", "FAILED"],
  COURIER_ASSIGNED: ["COURIER_ARRIVING_PICKUP", "CANCELLED", "FAILED"],
  COURIER_ARRIVING_PICKUP: ["PICKED_UP", "CANCELLED", "FAILED"],
  PICKED_UP: ["IN_TRANSIT", "FAILED"],
  IN_TRANSIT: ["DELIVERED", "FAILED"],
  DELIVERED: ["REFUND_PENDING"],
  CANCELLED: [],
  FAILED: ["REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: []
};

const merchantOnly: readonly OrderStatus[] = ["ACCEPTED_BY_MERCHANT", "PREPARING", "READY_FOR_PICKUP"];

export function canTransition(orderType: string, from: OrderStatus, to: OrderStatus): boolean {
  if (orderType === "PARCEL" && (merchantOnly.includes(to) || merchantOnly.includes(from))) return false;
  return transitions[from]?.includes(to) ?? false;
}

export function assertTransition(_orderType: string, from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(_orderType, from, to)) throw new Error(`Invalid order transition: ${from} -> ${to}`);
}

export const canTransitionOrder = canTransition;
export const assertOrderTransition = assertTransition;

export function isTerminal(status: OrderStatus): boolean {
  return status === "DELIVERED" || status === "CANCELLED" || status === "REFUNDED";
}