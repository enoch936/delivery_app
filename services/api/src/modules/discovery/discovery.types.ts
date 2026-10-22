export const DISCOVERY_REPOSITORY = Symbol("DISCOVERY_REPOSITORY");
export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");

export type ServiceCategoryRecord = Readonly<{
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  sortOrder: number;
}>;

export type MerchantSummaryRecord = Readonly<{
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  serviceCategorySlugs: readonly string[];
  primaryLocationName: string | null;
}>;

export type MerchantDetailRecord = MerchantSummaryRecord &
  Readonly<{
    openingHours: Record<string, unknown>;
    addressLine: string | null;
  }>;

export type ProductRecord = Readonly<{
  id: string;
  merchantId: string;
  sku: string | null;
  displayName: string;
  description: string | null;
  imageUrl: string | null;
  basePriceMinor: number;
  currency: string;
  isAvailable: boolean;
  quantityAvailable: number | null;
}>;

export type SearchHitRecord = Readonly<
  | { type: "merchant"; merchant: MerchantSummaryRecord }
  | { type: "product"; product: ProductRecord; merchant: Pick<MerchantSummaryRecord, "id" | "slug" | "displayName"> }
>;

export interface DiscoveryRepository {
  listActiveServiceCategories(): Promise<readonly ServiceCategoryRecord[]>;
  listMerchants(input: Readonly<{ citySlug: string; categorySlug: string | null; query: string | null; limit: number; offset: number }>): Promise<{ items: readonly MerchantSummaryRecord[]; total: number }>;
  getMerchantById(merchantId: string, citySlug: string): Promise<MerchantDetailRecord | null>;
  listProducts(input: Readonly<{ merchantId: string; query: string | null; limit: number; offset: number }>): Promise<{ items: readonly ProductRecord[]; total: number }>;
  search(input: Readonly<{ citySlug: string; query: string; limit: number; offset: number }>): Promise<{ items: readonly SearchHitRecord[]; total: number }>;
}
