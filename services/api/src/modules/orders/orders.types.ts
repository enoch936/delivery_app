import type { UserRole } from "../auth/auth.types.js";

export type OrderViewer = Readonly<{ userId: string; roles: readonly UserRole[] }>;

export type OrderTotals = Readonly<{
  itemsSubtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  taxMinor: number;
  tipMinor: number;
  totalMinor: number;
  currency: string;
}>;

export type OrderItemRecord = Readonly<{
  id: string;
  productId: string | null;
  displayName: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  options: unknown;
}>;

export type OrderEventRecord = Readonly<{
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}>;

export type OrderDeliveryRecord = Readonly<{
  assignmentId: string | null;
  status: string | null;
  courier: { id: string; displayName: string | null; phoneE164: string | null; vehicleType: string | null; rating: number | null } | null;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  lastLocation: { latitude: number; longitude: number; recordedAt: string; stale: boolean } | null;
}>;

export type OrderDetailRecord = Readonly<{
  id: string;
  orderNumber: string;
  status: string;
  kind: string;
  paymentStatus: string;
  currency: string;
  merchant: { id: string; displayName: string };
  totals: OrderTotals;
  items: readonly OrderItemRecord[];
  deliveryAddress: Record<string, unknown>;
  fulfillmentType: "delivery" | "pickup";
  pickupLocation: Readonly<{ id: string; name: string; addressLine: string | null }> | null;
  deliveryInstructions: string | null;
  scheduledFor: string | null;
  deliveryEstimateMinutes: number | null;
  distanceMeters: number | null;
  timeline: readonly OrderEventRecord[];
  delivery: OrderDeliveryRecord;
  refunds: readonly { id: string; status: string; amountMinor: number; reason: string; createdAt: string }[];
  capabilities: Readonly<{ canCancel: boolean; canReview: boolean; canRate: boolean; isOwner: boolean; isMerchant: boolean; isCourier: boolean; isAdmin: boolean }>;
  deliveryCode: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type OrderSummaryRecord = Readonly<{
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  currency: string;
  totalMinor: number;
  merchantName: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}>;
