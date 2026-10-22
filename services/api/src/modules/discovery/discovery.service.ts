import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { DISCOVERY_REPOSITORY, RUNTIME_CONFIG, type DiscoveryRepository } from "./discovery.types.js";

const MAX_PAGE_SIZE = 50;

@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DISCOVERY_REPOSITORY) private readonly repository: DiscoveryRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  listServiceCategories() {
    return this.repository.listActiveServiceCategories();
  }

  async listMerchants(input: Readonly<{ categorySlug?: string | undefined; q?: string | undefined; limit?: number | undefined; offset?: number | undefined }>) {
    return this.repository.listMerchants({
      citySlug: this.config.launchCitySlug,
      categorySlug: input.categorySlug ?? null,
      query: normalizeQuery(input.q),
      limit: clampLimit(input.limit),
      offset: clampOffset(input.offset)
    });
  }

  async getMerchant(merchantId: string) {
    const merchant = await this.repository.getMerchantById(merchantId, this.config.launchCitySlug);
    if (!merchant) throw new NotFoundException("Merchant is not available in the current service area.");
    return merchant;
  }

  listProducts(merchantId: string, input: Readonly<{ q?: string | undefined; limit?: number | undefined; offset?: number | undefined }>) {
    return this.repository.listProducts({
      merchantId,
      query: normalizeQuery(input.q),
      limit: clampLimit(input.limit),
      offset: clampOffset(input.offset)
    });
  }

  search(input: Readonly<{ q: string; limit?: number | undefined; offset?: number | undefined }>) {
    const query = normalizeQuery(input.q);
    if (!query) return { items: [], total: 0 };
    return this.repository.search({
      citySlug: this.config.launchCitySlug,
      query,
      limit: clampLimit(input.limit),
      offset: clampOffset(input.offset)
    });
  }

  async enabledCategorySlugs(): Promise<readonly string[]> {
    const categories = await this.repository.listActiveServiceCategories();
    return categories.map((category) => category.slug);
  }
}

function clampLimit(value: number | undefined): number {
  if (!value || value < 1) return 20;
  return Math.min(value, MAX_PAGE_SIZE);
}

function clampOffset(value: number | undefined): number {
  if (!value || value < 0) return 0;
  return value;
}

function normalizeQuery(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}
