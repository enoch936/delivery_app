/** Public API values safe for unauthenticated clients. */
export interface PlatformConfigurationResponse {
  countryCode: string;
  launchCitySlug: string;
  defaultCurrency: string;
  enabledServiceCategories: readonly string[];
}

export interface HealthResponse {
  status: "ok";
  timestamp: string;
}

export interface ServiceCategory {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  sortOrder: number;
}

export interface MerchantSummary {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  logoUrl: string | null;
  serviceCategorySlugs: readonly string[];
  primaryLocationName: string | null;
}

export interface ProductSummary {
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
}
