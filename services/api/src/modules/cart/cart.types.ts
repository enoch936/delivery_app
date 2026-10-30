export type CartOwner = Readonly<{ userId: string | null; deviceId: string | null }>;

export type CartItemOptionRecord = Readonly<{
  optionId: string;
  displayName: string;
  priceDeltaMinor: number;
}>;

export type CartItemRecord = Readonly<{
  id: string;
  productId: string;
  displayName: string;
  imageUrl: string | null;
  quantity: number;
  basePriceMinor: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
  options: readonly CartItemOptionRecord[];
  optionsLabel: string;
  isAvailable: boolean;
  quantityAvailable: number | null;
  maxQuantity: number;
  stockState: "in_stock" | "low_stock" | "out_of_stock";
  stockIssue: string | null;
}>;

export type CartIssueRecord = Readonly<{
  code: "removed_out_of_stock" | "quantity_reduced" | "option_unavailable" | "price_changed";
  productId: string;
  displayName: string;
  message: string;
  previousQuantity: number;
  quantity: number;
}>;

export type CartRecord = Readonly<{
  id: string | null;
  merchantId: string | null;
  merchantName: string | null;
  merchantSlug: string | null;
  merchantCoverImageUrl: string | null;
  currency: string;
  items: readonly CartItemRecord[];
  itemsSubtotalMinor: number;
  itemCount: number;
  updatedAt: string;
  fulfillment: Readonly<{
    supportsPickup: boolean;
    pickupInstructions: string | null;
    allowsScheduling: boolean;
    minScheduleLeadMinutes: number;
    maxScheduleDays: number;
  }>;
  policy: Readonly<{ cancellationPolicy: string | null; refundPolicy: string | null }>;
  owner: Readonly<{ type: "account" | "device"; deviceId: string | null }>;
}>;

export type ReconcileResult = Readonly<{ cart: CartRecord; issues: readonly CartIssueRecord[] }>;
