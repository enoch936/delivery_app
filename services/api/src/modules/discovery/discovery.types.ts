export const DISCOVERY_REPOSITORY = Symbol("DISCOVERY_REPOSITORY");
export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");

export type MerchantSort = "recommended" | "distance" | "rating" | "eta" | "name";

export type ServiceCategoryRecord = Readonly<{
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  sortOrder: number;
  merchantCount: number;
}>;

export type MerchantSummaryRecord = Readonly<{
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  serviceCategorySlugs: readonly string[];
  primaryLocationName: string | null;
  rating: number;
  ratingCount: number;
  priceLevel: number;
  deliveryFeeMinor: number;
  minOrderMinor: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  isFeatured: boolean;
  tags: readonly string[];
  isOpen: boolean;
  distanceKm: number | null;
}>;

export type MerchantDetailRecord = MerchantSummaryRecord &
  Readonly<{
    openingHours: Record<string, unknown>;
    addressLine: string | null;
    deliveryFeeMinor: number;
    minOrderMinor: number;
    latitude: number | null;
    longitude: number | null;
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

export type SearchProductRecord = ProductRecord &
  Readonly<{
    merchant: Pick<MerchantSummaryRecord, "id" | "slug" | "displayName" | "logoUrl" | "coverImageUrl" | "rating">;
  }>;

export type SearchHitRecord = Readonly<
  | { type: "merchant"; merchant: MerchantSummaryRecord }
  | { type: "product"; product: SearchProductRecord; merchant: SearchProductRecord["merchant"] }
  | { type: "service"; service: ServiceCategoryRecord }
>;

export type DiscoveryBannerRecord = Readonly<{
  id: string;
  title: string;
  subtitle: string;
  code: string | null;
  ctaLabel: string;
  imageUrl: string | null;
  accentColor: string;
}>;

export type RecentlyOrderedRecord = Readonly<{
  orderId: string;
  orderNumber: string;
  orderedAt: string;
  status: string;
  merchant: Pick<MerchantSummaryRecord, "id" | "slug" | "displayName" | "logoUrl" | "coverImageUrl">;
  items: readonly Readonly<{ displayName: string; quantity: number }>[];
}>;

export type DiscoveryHomeRecord = Readonly<{
  banners: readonly DiscoveryBannerRecord[];
  categories: readonly ServiceCategoryRecord[];
  featured: readonly MerchantSummaryRecord[];
  recommendations: readonly MerchantSummaryRecord[];
  popularProducts: readonly SearchProductRecord[];
  recentlyOrdered: readonly RecentlyOrderedRecord[];
  stats: Readonly<{ merchantCount: number; openNowCount: number }>;
}>;

export type MerchantListInput = Readonly<{
  citySlug: string;
  categorySlug: string | null;
  query: string | null;
  limit: number;
  offset: number;
  sort: MerchantSort;
  openNow: boolean;
  featuredOnly: boolean;
  favoritesUserId: string | null;
  latitude: number | null;
  longitude: number | null;
}>;

export type SearchInput = Readonly<{
  citySlug: string;
  query: string;
  type: "all" | "merchant" | "product" | "service";
  categorySlug: string | null;
  limit: number;
  offset: number;
  sort: MerchantSort;
  openNow: boolean;
  latitude: number | null;
  longitude: number | null;
}>;

export type SearchResultRecord = Readonly<{
  query: string;
  items: readonly SearchHitRecord[];
  total: number;
  merchants: readonly MerchantSummaryRecord[];
  products: readonly SearchProductRecord[];
  services: readonly ServiceCategoryRecord[];
  suggestions: readonly string[];
}>;

export type RecentSearchRecord = Readonly<{ term: string; lastSearchedAt: string }>;

export interface DiscoveryRepository {
  listActiveServiceCategories(): Promise<readonly ServiceCategoryRecord[]>;
  listMerchants(input: MerchantListInput): Promise<{ items: readonly MerchantSummaryRecord[]; total: number }>;
  getMerchantById(merchantId: string, citySlug: string, latitude: number | null, longitude: number | null): Promise<MerchantDetailRecord | null>;
  listProducts(input: Readonly<{ merchantId: string; query: string | null; limit: number; offset: number }>): Promise<{ items: readonly ProductRecord[]; total: number }>;
  search(input: SearchInput): Promise<SearchResultRecord>;
  getHome(input: Readonly<{ citySlug: string; userId: string | null; latitude: number | null; longitude: number | null }>): Promise<DiscoveryHomeRecord>;
  listFavorites(userId: string, citySlug: string, latitude: number | null, longitude: number | null): Promise<readonly MerchantSummaryRecord[]>;
  addFavorite(userId: string, merchantId: string): Promise<boolean>;
  removeFavorite(userId: string, merchantId: string): Promise<boolean>;
  listRecentSearches(userId: string, limit: number): Promise<readonly RecentSearchRecord[]>;
  recordRecentSearch(userId: string, term: string): Promise<void>;
  clearRecentSearches(userId: string): Promise<void>;
}
