export type CartItemRecord = Readonly<{
  id: string;
  productId: string;
  displayName: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: string;
  isAvailable: boolean;
  quantityAvailable: number | null;
  stockIssue: string | null;
}>;

export type CartRecord = Readonly<{
  id: string;
  merchantId: string;
  merchantName: string;
  currency: string;
  items: readonly CartItemRecord[];
  itemsSubtotalMinor: number;
  itemCount: number;
  updatedAt: string;
}>;
