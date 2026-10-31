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

export type MerchantDayHours = Readonly<{ closed: boolean; open: string | null; close: string | null }>;

export type MerchantWeeklyHours = Readonly<{
  day: string;
  label: string;
  open: string | null;
  close: string | null;
  closed: boolean;
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
  deliveryRadiusKm: number;
  etaMinMinutes: number;
  etaMaxMinutes: number;
  isFeatured: boolean;
  tags: readonly string[];
  isOpen: boolean;
  isDeliverable: boolean;
  distanceKm: number | null;
  todayHours: MerchantDayHours | null;
  nextOpenAt: string | null;
}>;

export type MerchantPolicyRecord = Readonly<{
  cancellationPolicy: string | null;
  refundPolicy: string | null;
}>;

export type MerchantFulfillmentRecord = Readonly<{
  supportsPickup: boolean;
  pickupInstructions: string | null;
  allowsScheduling: boolean;
  minScheduleLeadMinutes: number;
  maxScheduleDays: number;
}>;

export type PickupLocationRecord = Readonly<{
  id: string;
  name: string;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
}>;

export type MerchantDetailRecord = MerchantSummaryRecord &
  Readonly<{
    openingHours: Record<string, unknown>;
    weeklyHours: readonly MerchantWeeklyHours[];
    addressLine: string | null;
    latitude: number | null;
    longitude: number | null;
    deliveryUnavailableReason: string | null;
    policy: MerchantPolicyRecord;
    fulfillment: MerchantFulfillmentRecord;
    pickupLocations: readonly PickupLocationRecord[];
  }>;

export type ProductOptionRecord = Readonly<{
  id: string;
  sku: string | null;
  displayName: string;
  priceDeltaMinor: number;
  isDefault: boolean;
  isAvailable: boolean;
}>;

export type ProductOptionGroupRecord = Readonly<{
  id: string;
  slug: string;
  displayName: string;
  selectionType: "single" | "multi";
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  options: readonly ProductOptionRecord[];
}>;

export type ProductStockState = "in_stock" | "low_stock" | "out_of_stock";

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
  stockState: ProductStockState;
  optionGroups: readonly ProductOptionGroupRecord[];
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
  targetCategorySlug: string | null;
  targetMerchantId: string | null;
}>;

export type RecentlyOrderedRecord = Readonly<{
  orderId: string;
  orderNumber: string;
  orderedAt: string;
  status: string;
  merchant: Pick<MerchantSummaryRecord, "id" | "slug" | "displayName" | "logoUrl" | "coverImageUrl">;
  items: readonly Readonly<{ displayName: string; quantity: number }>[];
}>;

export type DiscoveryOfferRecord = Readonly<{
  id: string;
  code: string;
  displayName: string;
  kind: string;
  value: number;
  currency: string;
  minimumOrderMinor: number;
  maximumDiscountMinor: number | null;
  merchantId: string | null;
}>;

export type DiscoveryHomeRecord = Readonly<{
  banners: readonly DiscoveryBannerRecord[];
  offers: readonly DiscoveryOfferRecord[];
  categories: readonly ServiceCategoryRecord[];
  featured: readonly MerchantSummaryRecord[];
  recommendations: readonly MerchantSummaryRecord[];
  popularProducts: readonly SearchProductRecord[];
  recentlyOrdered: readonly RecentlyOrderedRecord[];
  recentlyOrderedProducts: readonly SearchProductRecord[];
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
  recommendationUserId: string | null;
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
  favoritesUserId: string | null;
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

export type SearchSuggestionRecord = Readonly<{
  type: "merchant" | "product" | "service";
  label: string;
  subtitle: string;
  categorySlug: string | null;
  targetId: string;
}>;

export type SearchSuggestionResultRecord = Readonly<{
  query: string;
  items: readonly SearchSuggestionRecord[];
  recent: readonly string[];
}>;

export interface DiscoveryRepository {
  listActiveServiceCategories(): Promise<readonly ServiceCategoryRecord[]>;
  listMerchants(input: MerchantListInput): Promise<{ items: readonly MerchantSummaryRecord[]; total: number }>;
  getMerchantById(merchantId: string, citySlug: string, latitude: number | null, longitude: number | null): Promise<MerchantDetailRecord | null>;
  listProducts(input: Readonly<{ merchantId: string; query: string | null; limit: number; offset: number }>): Promise<{ items: readonly ProductRecord[]; total: number }>;
  search(input: SearchInput): Promise<SearchResultRecord>;
  searchSuggestions(input: Readonly<{ citySlug: string; query: string; limit: number; latitude: number | null; longitude: number | null }>): Promise<readonly SearchSuggestionRecord[]>;
  getHome(input: Readonly<{ citySlug: string; userId: string | null; latitude: number | null; longitude: number | null }>): Promise<DiscoveryHomeRecord>;
  listFavorites(userId: string, citySlug: string, latitude: number | null, longitude: number | null): Promise<readonly MerchantSummaryRecord[]>;
  addFavorite(userId: string, merchantId: string): Promise<boolean>;
  removeFavorite(userId: string, merchantId: string): Promise<boolean>;
  listRecentSearches(userId: string, limit: number): Promise<readonly RecentSearchRecord[]>;
  recordRecentSearch(userId: string, term: string): Promise<void>;
  clearRecentSearches(userId: string): Promise<void>;
}
