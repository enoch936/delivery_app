/**
 * Pickup and delivery execution rules.
 *
 * The API computes the courier's allowed actions from the assignment and order
 * state, and the mobile client mirrors the same rules so an impossible action
 * can never be attempted. The server remains authoritative.
 */

export type CourierAction =
  | "arrived_pickup"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "returned";

export const COURIER_ACTIONS: readonly CourierAction[] = Object.freeze([
  "arrived_pickup",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "returned"
]);

export type DeliveryAssignmentStatus =
  | "offered"
  | "accepted"
  | "arrived_pickup"
  | "picked_up"
  | "delivered"
  | "cancelled"
  | "failed";

export type ReturnStatus = "not_required" | "pending" | "completed";

export type DeliveryProofMode = "otp" | "qr" | "photo" | "signature" | "handoff";

export const DELIVERY_PROOF_MODES: readonly DeliveryProofMode[] = Object.freeze([
  "otp",
  "qr",
  "photo",
  "signature",
  "handoff"
]);

export type FailureReasonCode =
  | "inaccessible_address"
  | "recipient_unavailable"
  | "recipient_refused"
  | "damaged_goods"
  | "order_not_ready"
  | "safety_concern"
  | "vehicle_issue"
  | "other";

export type FailureReason = Readonly<{
  code: FailureReasonCode;
  label: string;
  requiresReturn: boolean;
  requiresNotes: boolean;
}>;

export const FAILURE_REASONS: readonly FailureReason[] = Object.freeze([
  Object.freeze({ code: "inaccessible_address", label: "Address inaccessible", requiresReturn: true, requiresNotes: false }),
  Object.freeze({ code: "recipient_unavailable", label: "Recipient unavailable", requiresReturn: true, requiresNotes: false }),
  Object.freeze({ code: "recipient_refused", label: "Recipient refused delivery", requiresReturn: true, requiresNotes: false }),
  Object.freeze({ code: "damaged_goods", label: "Goods damaged", requiresReturn: true, requiresNotes: true }),
  Object.freeze({ code: "order_not_ready", label: "Order not ready at pickup", requiresReturn: false, requiresNotes: false }),
  Object.freeze({ code: "safety_concern", label: "Safety concern", requiresReturn: true, requiresNotes: true }),
  Object.freeze({ code: "vehicle_issue", label: "Vehicle breakdown", requiresReturn: false, requiresNotes: false }),
  Object.freeze({ code: "other", label: "Other", requiresReturn: true, requiresNotes: true })
]);

export function isCourierAction(value: string): value is CourierAction {
  return (COURIER_ACTIONS as readonly string[]).includes(value);
}

export function isDeliveryProofMode(value: string): value is DeliveryProofMode {
  return (DELIVERY_PROOF_MODES as readonly string[]).includes(value);
}

export function failureReason(code: string): FailureReason | undefined {
  return FAILURE_REASONS.find((reason) => reason.code === code);
}

/**
 * Legacy orders only stored a boolean. Resolve it to an explicit mode so the
 * courier app and the API always agree on what proof is expected.
 */
export function effectiveProofMode(input: Readonly<{ proofMode: string | null; proofRequired: boolean }>): DeliveryProofMode {
  if (input.proofMode && isDeliveryProofMode(input.proofMode)) return input.proofMode;
  return input.proofRequired ? "otp" : "handoff";
}

export function proofRequiresEvidence(mode: DeliveryProofMode): boolean {
  return mode === "otp" || mode === "qr" || mode === "photo" || mode === "signature";
}

const QR_PREFIX = "DAPP1";

export function buildQrPayload(orderId: string, code: string): string {
  return `${QR_PREFIX}:${orderId}:${code}`;
}

/**
 * Accepts the scan payload produced by the customer app, or a bare delivery
 * code when the courier types it in. Returns null for malformed payloads.
 */
export function parseQrPayload(payload: string): { orderId: string; code: string } | null {
  const value = payload.trim();
  if (!value || value.length > 256) return null;
  if (!value.startsWith(`${QR_PREFIX}:`)) {
    return /^\d{4,12}$/.test(value) ? { orderId: "", code: value } : null;
  }
  const [, orderId, code] = value.split(":");
  if (!orderId || !code || !/^\d{4,12}$/.test(code)) return null;
  return { orderId, code };
}

/**
 * Actions the assigned courier may take right now. `returned` is a return
 * confirmation, not an order status transition.
 */
export function allowedCourierActions(input: Readonly<{
  assignmentStatus: string;
  orderStatus: string;
  returnRequired?: boolean;
  returnStatus?: string;
}>): readonly CourierAction[] {
  const { assignmentStatus, orderStatus } = input;
  switch (assignmentStatus) {
    case "accepted":
      return orderStatus === "COURIER_ASSIGNED" ? ["arrived_pickup", "failed"] : ["failed"];
    case "arrived_pickup":
      return orderStatus === "COURIER_ARRIVING_PICKUP" ? ["picked_up", "failed"] : ["failed"];
    case "picked_up":
      // The order lifecycle requires IN_TRANSIT before DELIVERED, so the
      // courier must explicitly start the delivery leg first.
      return orderStatus === "IN_TRANSIT"
        ? ["delivered", "failed"]
        : ["in_transit", "failed"];
    case "failed":
      return input.returnRequired === true && input.returnStatus === "pending" ? ["returned"] : [];
    default:
      return [];
  }
}

export function isActionAllowed(
  action: CourierAction,
  input: Readonly<{
    assignmentStatus: string;
    orderStatus: string;
    returnRequired?: boolean;
    returnStatus?: string;
  }>
): boolean {
  return allowedCourierActions(input).includes(action);
}
