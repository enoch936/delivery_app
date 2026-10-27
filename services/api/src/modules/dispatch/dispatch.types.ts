export type DispatchOfferRecord = Readonly<{
  offerId: string;
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  merchantName: string;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  distanceToPickupMeters: number;
  deliveryDistanceMeters: number | null;
  estimatedMinutes: number | null;
  compensationMinor: number;
  tipMinor: number;
  currency: string;
  expiresAt: string;
  createdAt: string;
}>;
