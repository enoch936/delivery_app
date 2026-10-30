import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import {
  DISCOVERY_REPOSITORY,
  RUNTIME_CONFIG,
  type DiscoveryRepository,
  type MerchantSort,
  type SearchInput
} from "./discovery.types.js";

const MAX_PAGE_SIZE = 50;
const SORTS: readonly MerchantSort[] = ["recommended", "distance", "rating", "eta", "name"];
const SEARCH_TYPES = ["all", "merchant", "product", "service"] as const;

export type MerchantQueryInput = Readonly<{
  categorySlug?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: string | undefined;
  openNow?: boolean | undefined;
  favoritesOnly?: boolean | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  userId?: string | undefined;
}>;

export type SearchQueryInput = Readonly<{
  q: string;
  type?: string | undefined;
  categorySlug?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: string | undefined;
  openNow?: boolean | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}>;

@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DISCOVERY_REPOSITORY) private readonly repository: DiscoveryRepository,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  listServiceCategories() {
    return this.repository.listActiveServiceCategories();
  }

  async listMerchants(input: MerchantQueryInput) {
    validateLocation(input.latitude, input.longitude);
    if (input.favoritesOnly && !input.userId) throw new UnauthorizedException("Sign in to view favorites.");
    return this.repository.listMerchants({
      citySlug: this.config.launchCitySlug,
      categorySlug: normalizeSlug(input.categorySlug),
      query: normalizeQuery(input.q),
      limit: clampLimit(input.limit),
      offset: clampOffset(input.offset),
      sort: parseSort(input.sort),
      openNow: input.openNow === true,
      featuredOnly: false,
      favoritesUserId: input.favoritesOnly === true ? input.userId ?? null : null,
      recommendationUserId: input.userId ?? null,
      latitude: parseCoordinate(input.latitude, 90),
      longitude: parseCoordinate(input.longitude, 180)
    });
  }

  async getMerchant(merchantId: string, latitude?: number | undefined, longitude?: number | undefined) {
    validateLocation(latitude, longitude);
    const merchant = await this.repository.getMerchantById(
      merchantId,
      this.config.launchCitySlug,
      parseCoordinate(latitude, 90),
      parseCoordinate(longitude, 180)
    );
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

  async search(input: SearchQueryInput) {
    validateLocation(input.latitude, input.longitude);
    const query = normalizeQuery(input.q);
    if (!query) {
      return {
        query: "",
        items: [],
        total: 0,
        merchants: [],
        products: [],
        services: [],
        suggestions: []
      };
    }
    const type = SEARCH_TYPES.includes(input.type as (typeof SEARCH_TYPES)[number])
      ? (input.type as SearchInput["type"])
      : "all";
    return this.repository.search({
      citySlug: this.config.launchCitySlug,
      query,
      type,
      categorySlug: normalizeSlug(input.categorySlug),
      limit: clampLimit(input.limit),
      offset: clampOffset(input.offset),
      sort: parseSort(input.sort),
      openNow: input.openNow === true,
      latitude: parseCoordinate(input.latitude, 90),
      longitude: parseCoordinate(input.longitude, 180)
    });
  }

  async suggestions(input: SearchQueryInput & Readonly<{ userId?: string | undefined }>) {
    const query = normalizeQuery(input.q);
    const userId = input.userId ?? null;
    const recent = userId ? await this.repository.listRecentSearches(userId, 8) : [];
    if (!query || query.length < 2) {
      return {
        query: query ?? "",
        items: [],
        recent: recent.map((item) => item.term).slice(0, 5)
      };
    }
    const items = await this.repository.searchSuggestions({
      citySlug: this.config.launchCitySlug,
      query,
      limit: clampLimit(input.limit ?? 8)
    });
    const matchingRecent = recent
      .map((item) => item.term)
      .filter((term) => term.toLowerCase().includes(query.toLowerCase()));
    return { query, items, recent: [...new Set([...matchingRecent, ...recent.map((item) => item.term)])].slice(0, 5) };
  }

  home(input: Readonly<{ userId: string | null; latitude?: number | undefined; longitude?: number | undefined }>) {
    validateLocation(input.latitude, input.longitude);
    return this.repository.getHome({
      citySlug: this.config.launchCitySlug,
      userId: input.userId,
      latitude: parseCoordinate(input.latitude, 90),
      longitude: parseCoordinate(input.longitude, 180)
    });
  }

  listFavorites(userId: string, latitude?: number | undefined, longitude?: number | undefined) {
    validateLocation(latitude, longitude);
    return this.repository.listFavorites(
      userId,
      this.config.launchCitySlug,
      parseCoordinate(latitude, 90),
      parseCoordinate(longitude, 180)
    );
  }

  addFavorite(userId: string, merchantId: string) {
    return this.repository.addFavorite(userId, merchantId);
  }

  removeFavorite(userId: string, merchantId: string) {
    return this.repository.removeFavorite(userId, merchantId);
  }

  listRecentSearches(userId: string) {
    return this.repository.listRecentSearches(userId, 10);
  }

  recordRecentSearch(userId: string, term: string) {
    const normalized = normalizeQuery(term);
    return normalized ? this.repository.recordRecentSearch(userId, normalized) : Promise.resolve();
  }

  clearRecentSearches(userId: string) {
    return this.repository.clearRecentSearches(userId);
  }

  async enabledCategorySlugs(): Promise<readonly string[]> {
    const categories = await this.repository.listActiveServiceCategories();
    return categories.map((category) => category.slug);
  }
}

function clampLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return 20;
  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}

function clampOffset(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function normalizeQuery(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function normalizeSlug(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) ? trimmed : null;
}

function parseSort(value: string | undefined): MerchantSort {
  return SORTS.includes(value as MerchantSort) ? (value as MerchantSort) : "recommended";
}

function parseCoordinate(value: number | undefined, limit: number): number | null {
  if (value === undefined || !Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}

function validateLocation(latitude: number | undefined, longitude: number | undefined): void {
  if ((latitude === undefined) !== (longitude === undefined)
    || (latitude !== undefined && parseCoordinate(latitude, 90) === null)
    || (longitude !== undefined && parseCoordinate(longitude, 180) === null)) {
    throw new BadRequestException("Provide both lat and lng as valid coordinates.");
  }
}
