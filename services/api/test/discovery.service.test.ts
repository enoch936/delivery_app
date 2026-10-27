import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeConfig } from "../src/config/runtime-config.js";
import { DiscoveryService } from "../src/modules/discovery/discovery.service.js";
import type { DiscoveryRepository, MerchantDetailRecord, MerchantSummaryRecord, ProductRecord, SearchHitRecord, ServiceCategoryRecord } from "../src/modules/discovery/discovery.types.js";

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
  otpRequestLimit: 3,
  deliveryFeeMinor: 0n, serviceFeeMinor: 0n, quoteValiditySeconds: 300, accessTokenLifetimeSeconds: 900, refreshTokenLifetimeSeconds: 2592000, paymentsProvider: "disabled", paymentWebhookSecret: undefined, chapaSecretKey: undefined, chapaWebhookSecret: undefined, stripeSecretKey: undefined, stripeWebhookSecret: undefined, paymentReturnUrl: undefined, paymentCancelUrl: undefined, courierOfferTimeoutSeconds: 45, dispatchRadiusMeters: 8000, maxPendingOffersPerCourier: 3, deliveryProofOtpRequired: true, taxRateBps: 0, mapsProvider: "disabled", pushProvider: "disabled", firebaseServiceAccountJson: undefined, publicApiBaseUrl: "http://localhost:3000", geocodingProvider: "disabled"
};

const merchant: MerchantDetailRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "harvest-grocery",
  displayName: "Harvest Grocery",
  description: "Fresh produce",
  logoUrl: null,
  serviceCategorySlugs: ["grocery"],
  primaryLocationName: "Main",
  openingHours: {},
  addressLine: "Demo address"
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
  quantityAvailable: 10
};

class MemoryDiscoveryRepository implements DiscoveryRepository {
  async listActiveServiceCategories(): Promise<readonly ServiceCategoryRecord[]> {
    return [{ id: "cat-1", slug: "grocery", displayName: "Groceries", description: null, sortOrder: 1 }];
  }
  async listMerchants(): Promise<{ items: readonly MerchantSummaryRecord[]; total: number }> {
    return { items: [merchant], total: 1 };
  }
  async getMerchantById(merchantId: string): Promise<MerchantDetailRecord | null> {
    return merchantId === merchant.id ? merchant : null;
  }
  async listProducts(input: Readonly<{ merchantId: string }>): Promise<{ items: readonly ProductRecord[]; total: number }> {
    return input.merchantId === merchant.id ? { items: [product], total: 1 } : { items: [], total: 0 };
  }
  async search(input: Readonly<{ query: string }>): Promise<{ items: readonly SearchHitRecord[]; total: number }> {
    return input.query.toLowerCase().includes("teff")
      ? { items: [{ type: "product", product, merchant: { id: merchant.id, slug: merchant.slug, displayName: merchant.displayName } }], total: 1 }
      : { items: [], total: 0 };
  }
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
  assert.deepEqual(result, { items: [], total: 0 });
});


