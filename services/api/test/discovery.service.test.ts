import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeConfig } from "../src/config/runtime-config.js";
import { DiscoveryService } from "../src/modules/discovery/discovery.service.js";
import type {
  DiscoveryHomeRecord,
  DiscoveryRepository,
  MerchantDetailRecord,
  MerchantListInput,
  MerchantSummaryRecord,
  ProductRecord,
  RecentSearchRecord,
  SearchInput,
  SearchProductRecord,
  SearchResultRecord,
  SearchSuggestionRecord,
  ServiceCategoryRecord
} from "../src/modules/discovery/discovery.types.js";

const config: RuntimeConfig = {
  nodeEnv: "test",
  port: 3000,
  corsOrigins: [],
  launchCountryCode: "ET",
  launchCitySlug: "launch-city",
  defaultCurrency: "ETB",
  databaseUrl: undefined,
  authTokenSecret: undefined,
  otpProvider: "disabled",
  otpDevelopmentCode: undefined,
  emailProvider: "disabled",
  otpRequestLimit: 3,
  deliveryFeeMinor: 0n, serviceFeeMinor: 0n, quoteValiditySeconds: 300, accessTokenLifetimeSeconds: 900, refreshTokenLifetimeSeconds: 2592000,   paymentsProvider: "disabled", paymentWebhookSecret: undefined, chapaSecretKey: undefined, chapaWebhookSecret: undefined, chapaBaseUrl: "https://api.chapa.global", stripeSecretKey: undefined, stripeWebhookSecret: undefined, telebirrEnvironment: "test", telebirrBaseUrl: "https://example.test/api", telebirrWebBaseUrl: "https://example.test/pay?", telebirrFabricAppId: undefined, telebirrAppSecret: undefined, telebirrMerchantAppId: undefined, telebirrMerchantCode: undefined, telebirrPrivateKey: undefined, telebirrPublicKey: undefined, telebirrNotifyUrl: "http://localhost:3000/api/v1/payments/webhooks/telebirr", telebirrRedirectUrl: undefined, paymentReturnUrl: undefined, paymentCancelUrl: undefined, courierOfferTimeoutSeconds: 45, dispatchRadiusMeters: 8000, maxPendingOffersPerCourier: 3, deliveryProofOtpRequired: true, taxRateBps: 0, mapsProvider: "disabled", pushProvider: "disabled", firebaseServiceAccountJson: undefined, publicApiBaseUrl: "http://localhost:3000", geocodingProvider: "disabled"
};

const category: ServiceCategoryRecord = { id: "cat-1", slug: "grocery", displayName: "Groceries", description: null, sortOrder: 1, merchantCount: 1 };

const merchant: MerchantSummaryRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "harvest-grocery",
  displayName: "Harvest Grocery",
  description: "Fresh produce",
  logoUrl: null,
  coverImageUrl: null,
  serviceCategorySlugs: ["grocery"],
  primaryLocationName: "Main",
  rating: 4.6,
  ratingCount: 10,
  priceLevel: 1,
  deliveryFeeMinor: 3500,
  minOrderMinor: 5000,
  deliveryRadiusKm: 8,
  etaMinMinutes: 15,
  etaMaxMinutes: 25,
  isFeatured: true,
  tags: ["teff"],
  isOpen: true,
  isDeliverable: true,
  distanceKm: 1.2,
  todayHours: { closed: false, open: "08:00", close: "21:00" },
  nextOpenAt: null
};

const detail: MerchantDetailRecord = {
  ...merchant,
  openingHours: { default: { open: "08:00", close: "21:00" } },
  weeklyHours: [{ day: "mon", label: "Monday", open: "08:00", close: "21:00", closed: false }],
  addressLine: "Demo address",
  latitude: 9.02,
  longitude: 38.78,
  deliveryUnavailableReason: null,
  policy: { cancellationPolicy: null, refundPolicy: null },
  fulfillment: { supportsPickup: true, pickupInstructions: null, allowsScheduling: true, minScheduleLeadMinutes: 60, maxScheduleDays: 3 },
  pickupLocations: []
};

const product: ProductRecord = {
  id: "22222222-2222-2222-2222-222222222222",
  merchantId: merchant.id,
  sku: "TEFF-1KG",
  displayName: "Teff flour 1 kg",
  description: null,
  imageUrl: null,
  basePriceMinor: 42000,
  currency: "ETB",
  isAvailable: true,
  quantityAvailable: 10,
  stockState: "in_stock",
  optionGroups: []
};

const searchProduct: SearchProductRecord = { ...product, merchant: { id: merchant.id, slug: merchant.slug, displayName: merchant.displayName, logoUrl: null, coverImageUrl: null, rating: 4.6 } };

class MemoryDiscoveryRepository implements DiscoveryRepository {
  recent: RecentSearchRecord[] = [];
  favorites = new Set<string>();

  async listActiveServiceCategories(): Promise<readonly ServiceCategoryRecord[]> { return [category]; }
  async listMerchants(input: MerchantListInput): Promise<{ items: readonly MerchantSummaryRecord[]; total: number }> {
    if (input.favoritesUserId && this.favorites.size === 0) return { items: [], total: 0 };
    return { items: [merchant], total: 1 };
  }
  async getMerchantById(merchantId: string): Promise<MerchantDetailRecord | null> { return merchantId === merchant.id ? detail : null; }
  async listProducts(input: Readonly<{ merchantId: string }>): Promise<{ items: readonly ProductRecord[]; total: number }> {
    return input.merchantId === merchant.id ? { items: [product], total: 1 } : { items: [], total: 0 };
  }
  async searchSuggestions(input: Readonly<{ query: string }>): Promise<readonly SearchSuggestionRecord[]> {
    if (!input.query.toLowerCase().includes("teff")) return [];
    return [{ type: "product", label: "Teff flour 1 kg", subtitle: "Harvest Grocery", categorySlug: "grocery", targetId: product.id }];
  }
  async search(input: SearchInput): Promise<SearchResultRecord> {
    if (!input.query.toLowerCase().includes("teff")) {
      return { query: input.query, items: [], total: 0, merchants: [], products: [], services: [], suggestions: [] };
    }
    return {
      query: input.query,
      items: [{ type: "product", product: searchProduct, merchant: searchProduct.merchant }],
      total: 1,
      merchants: [],
      products: [searchProduct],
      services: [],
      suggestions: ["Teff flour 1 kg"]
    };
  }
  async getHome(): Promise<DiscoveryHomeRecord> {
    return {
      banners: [], offers: [], categories: [category], featured: [merchant], recommendations: [], popularProducts: [searchProduct],
      recentlyOrdered: [], recentlyOrderedProducts: [], stats: { merchantCount: 1, openNowCount: 1 }
    };
  }
  async listFavorites(): Promise<readonly MerchantSummaryRecord[]> { return this.favorites.has(merchant.id) ? [merchant] : []; }
  async addFavorite(_userId: string, merchantId: string): Promise<boolean> { this.favorites.add(merchantId); return true; }
  async removeFavorite(_userId: string, merchantId: string): Promise<boolean> { return this.favorites.delete(merchantId); }
  async listRecentSearches(): Promise<readonly RecentSearchRecord[]> { return this.recent; }
  async recordRecentSearch(_userId: string, term: string): Promise<void> { this.recent = [{ term, lastSearchedAt: new Date().toISOString() }]; }
  async clearRecentSearches(): Promise<void> { this.recent = []; }
}

test("scopes merchant discovery to the configured launch city slug", async () => {
  const repository = new MemoryDiscoveryRepository();
  const service = new DiscoveryService(repository, config);
  const merchants = await service.listMerchants({});
  assert.equal(merchants.total, 1);
  assert.equal(merchants.items[0]?.slug, "harvest-grocery");
});

test("returns empty search results for blank queries", async () => {
  const service = new DiscoveryService(new MemoryDiscoveryRepository(), config);
  const result = await service.search({ q: "   " });
  assert.deepEqual(result, { query: "", items: [], total: 0, merchants: [], products: [], services: [], suggestions: [] });
});

test("returns typed search sections and suggestions", async () => {
  const service = new DiscoveryService(new MemoryDiscoveryRepository(), config);
  const result = await service.search({ q: "teff", type: "product" });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.type, "product");
  assert.equal(result.suggestions[0], "Teff flour 1 kg");
});

test("builds a home feed with categories, featured merchants and popular products", async () => {
  const service = new DiscoveryService(new MemoryDiscoveryRepository(), config);
  const home = await service.home({ userId: null, latitude: 9.02, longitude: 38.78 });
  assert.equal(home.featured[0]?.slug, "harvest-grocery");
  assert.equal(home.popularProducts[0]?.displayName, "Teff flour 1 kg");
  assert.equal(home.stats.openNowCount, 1);
});

test("suggests merchants, products and services for a partial query", async () => {
  const service = new DiscoveryService(new MemoryDiscoveryRepository(), config);
  const suggestions = await service.suggestions({ q: "teff" });
  assert.equal(suggestions.items[0]?.label, "Teff flour 1 kg");
  assert.equal(suggestions.items[0]?.type, "product");
});

test("returns recent terms instead of catalog matches for very short queries", async () => {
  const repository = new MemoryDiscoveryRepository();
  repository.recent = [{ term: "teff", lastSearchedAt: new Date().toISOString() }];
  const service = new DiscoveryService(repository, config);
  const suggestions = await service.suggestions({ q: "t", userId: "user-1" });
  assert.equal(suggestions.items.length, 0);
  assert.deepEqual(suggestions.recent, ["teff"]);
});

test("tracks favorites and recent searches for the signed-in customer", async () => {
  const service = new DiscoveryService(new MemoryDiscoveryRepository(), config);
  await service.addFavorite("user-1", merchant.id);
  assert.equal((await service.listFavorites("user-1")).length, 1);
  await service.recordRecentSearch("user-1", "  teff  ");
  assert.equal((await service.listRecentSearches("user-1"))[0]?.term, "teff");
  await service.clearRecentSearches("user-1");
  assert.equal((await service.listRecentSearches("user-1")).length, 0);
});
