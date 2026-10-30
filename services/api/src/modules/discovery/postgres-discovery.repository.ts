import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Pool } from "pg";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import type {
  DiscoveryBannerRecord,
  DiscoveryHomeRecord,
  DiscoveryOfferRecord,
  DiscoveryRepository,
  MerchantDetailRecord,
  MerchantListInput,
  MerchantSort,
  MerchantSummaryRecord,
  ProductRecord,
  RecentlyOrderedRecord,
  RecentSearchRecord,
  SearchInput,
  SearchProductRecord,
  SearchResultRecord,
  ServiceCategoryRecord
} from "./discovery.types.js";

@Injectable()
export class PostgresDiscoveryRepository implements DiscoveryRepository {
  private pool: Pool | null = null;

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const databaseUrl = readRuntimeConfig().databaseUrl;
    if (!databaseUrl) throw new ServiceUnavailableException("Catalog storage is not configured.");
    this.pool = new Pool({ connectionString: databaseUrl, application_name: "delivery_app_api" });
    return this.pool;
  }

  async listActiveServiceCategories(): Promise<readonly ServiceCategoryRecord[]> {
    const result = await this.getPool().query<CategoryRow>(
      `SELECT sc.id, sc.slug, sc.display_name, sc.description, sc.sort_order,
              (SELECT count(DISTINCT msc.merchant_id)
                 FROM merchant_service_categories msc
                 JOIN merchants m ON m.id = msc.merchant_id AND m.status = 'active'
                WHERE msc.service_category_id = sc.id)::int AS merchant_count
         FROM service_categories sc
        WHERE sc.is_active = true
        ORDER BY sc.sort_order ASC, sc.display_name ASC`
    );
    return result.rows.map(mapCategory);
  }

  async listMerchants(input: MerchantListInput): Promise<{ items: readonly MerchantSummaryRecord[]; total: number }> {
    const params: unknown[] = [input.citySlug];
    const filters = ["m.status = 'active'"];

    if (input.categorySlug) {
      params.push(input.categorySlug);
      filters.push(`EXISTS (
        SELECT 1 FROM merchant_service_categories msc
        JOIN service_categories sc ON sc.id = msc.service_category_id
        WHERE msc.merchant_id = m.id AND sc.slug = $${params.length} AND sc.is_active = true
      )`);
    }
    if (input.query) {
      params.push(`%${escapeLike(input.query)}%`);
      const index = params.length;
      filters.push(`(m.display_name ILIKE $${index} OR m.description ILIKE $${index}
        OR m.tags::text ILIKE $${index}
        OR EXISTS (SELECT 1 FROM products p WHERE p.merchant_id = m.id AND p.display_name ILIKE $${index}))`);
    }
    if (input.openNow) filters.push("discovery_is_open(ml.opening_hours) = true");
    if (input.featuredOnly) filters.push("m.is_featured = true");
    if (input.favoritesUserId) {
      params.push(input.favoritesUserId);
      filters.push(`EXISTS (
        SELECT 1 FROM favorites f
        WHERE f.user_id = $${params.length} AND f.merchant_id = m.id AND f.product_id IS NULL
      )`);
    }
    if (input.latitude !== null && input.longitude !== null) {
      params.push(input.longitude, input.latitude);
      filters.push(`ST_DWithin(
        ml.location::geography,
        ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography,
        m.delivery_radius_km * 1000
      )`);
    }

    const from = `FROM merchants m
      JOIN LATERAL (
        SELECT ml.* FROM merchant_locations ml
        JOIN cities c ON c.id = ml.city_id
        WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $1 AND c.is_active = true
        ORDER BY ml.name ASC LIMIT 1
      ) ml ON true
      WHERE ${filters.join(" AND ")}`;
    const count = await this.getPool().query<{ count: string }>(`SELECT count(*)::text AS count ${from}`, params);

    const distance = this.distanceExpression(params, input.latitude, input.longitude, "ml");
    const limitIndex = params.push(input.limit);
    const offsetIndex = params.push(input.offset);
    const result = await this.getPool().query<MerchantRow>(
      `SELECT m.id, m.slug, m.display_name, m.description, m.logo_url, m.cover_image_url,
              m.rating, m.rating_count, m.price_level, m.delivery_fee_minor, m.min_order_minor,
              m.delivery_radius_km, m.eta_min_minutes, m.eta_max_minutes, m.is_featured, m.tags,
              ml.name AS location_name, ml.address_line, ml.opening_hours,
              ST_Y(ml.location) AS latitude, ST_X(ml.location) AS longitude,
              discovery_is_open(ml.opening_hours) AS is_open,
              ${distance} AS distance_km
       ${from}
       ORDER BY ${orderBy(input.sort)}
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    const items = await this.attachCategorySlugs(result.rows);
    return { items, total: Number(count.rows[0]?.count ?? "0") };
  }

  async getMerchantById(merchantId: string, citySlug: string, latitude: number | null, longitude: number | null): Promise<MerchantDetailRecord | null> {
    const params: unknown[] = [merchantId, citySlug];
    const distance = this.distanceExpression(params, latitude, longitude, "ml");
    const result = await this.getPool().query<MerchantRow>(
      `SELECT m.id, m.slug, m.display_name, m.description, m.logo_url, m.cover_image_url,
              m.rating, m.rating_count, m.price_level, m.delivery_fee_minor, m.min_order_minor,
              m.delivery_radius_km, m.eta_min_minutes, m.eta_max_minutes, m.is_featured, m.tags,
              ml.name AS location_name, ml.address_line, ml.opening_hours,
              ST_Y(ml.location) AS latitude, ST_X(ml.location) AS longitude,
              discovery_is_open(ml.opening_hours) AS is_open,
              ${distance} AS distance_km
       FROM merchants m
       JOIN LATERAL (
         SELECT ml.* FROM merchant_locations ml
         JOIN cities c ON c.id = ml.city_id
         WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $2 AND c.is_active = true
         ORDER BY ml.name ASC LIMIT 1
       ) ml ON true
       WHERE m.id = $1 AND m.status = 'active'
       LIMIT 1`,
      params
    );
    const row = result.rows[0];
    if (!row) return null;
    const [summary] = await this.attachCategorySlugs([row]);
    if (!summary) return null;
    return {
      ...summary,
      openingHours: row.opening_hours ?? {},
      addressLine: row.address_line ?? null,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude)
    };
  }

  async listProducts(input: Readonly<{ merchantId: string; query: string | null; limit: number; offset: number }>): Promise<{ items: readonly ProductRecord[]; total: number }> {
    const params: unknown[] = [input.merchantId];
    let queryFilter = "";
    if (input.query) {
      params.push(`%${escapeLike(input.query)}%`);
      queryFilter = `AND (p.display_name ILIKE $2 OR p.description ILIKE $2 OR p.sku ILIKE $2)`;
    }
    const count = await this.getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM products p WHERE p.merchant_id = $1 ${queryFilter}`,
      params.slice(0, queryFilter ? 2 : 1)
    );
    const limitIndex = params.push(input.limit);
    const offsetIndex = params.push(input.offset);
    const result = await this.getPool().query<ProductRow>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.merchant_id = $1 ${queryFilter}
       ORDER BY p.is_available DESC, p.display_name ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    return { items: result.rows.map(mapProduct), total: Number(count.rows[0]?.count ?? "0") };
  }

  async search(input: SearchInput): Promise<SearchResultRecord> {
    const includeMerchants = input.type === "all" || input.type === "merchant";
    const includeProducts = input.type === "all" || input.type === "product";
    const includeServices = input.type === "all" || input.type === "service";

    const merchants = includeMerchants
      ? (await this.listMerchants({
          citySlug: input.citySlug,
          categorySlug: input.categorySlug,
          query: input.query,
          limit: input.limit,
          offset: input.offset,
          sort: input.sort,
          openNow: input.openNow,
          featuredOnly: false,
          favoritesUserId: null,
          latitude: input.latitude,
          longitude: input.longitude
        })).items
      : [];
    const products = includeProducts ? (await this.searchProducts(input)).items : [];
    const allCategories = includeServices ? await this.listActiveServiceCategories() : [];
    const services = allCategories.filter((category) => {
      if (input.type === "service") return true;
      const haystack = `${category.displayName} ${category.description ?? ""} ${category.slug}`.toLowerCase();
      return haystack.includes(input.query.toLowerCase());
    }).slice(0, 6);

    const suggestions = await this.buildSuggestions(input.query);
    const items = [
      ...merchants.map((merchant) => ({ type: "merchant" as const, merchant })),
      ...products.map((product) => ({ type: "product" as const, product, merchant: product.merchant })),
      ...services.map((service) => ({ type: "service" as const, service }))
    ].slice(0, input.limit);

    return {
      query: input.query,
      items,
      total: merchants.length + products.length + services.length,
      merchants,
      products,
      services,
      suggestions
    };
  }

  private async searchProducts(input: SearchInput): Promise<{ items: readonly SearchProductRecord[]; total: number }> {
    const params: unknown[] = [input.citySlug, `%${escapeLike(input.query)}%`];
    const filters = ["m.status = 'active'", "p.is_available = true", "(p.display_name ILIKE $2 OR p.description ILIKE $2 OR p.sku ILIKE $2 OR m.display_name ILIKE $2 OR m.tags::text ILIKE $2)"];
    if (input.categorySlug) {
      params.push(input.categorySlug);
      filters.push(`EXISTS (
        SELECT 1 FROM merchant_service_categories msc
        JOIN service_categories sc ON sc.id = msc.service_category_id
        WHERE msc.merchant_id = m.id AND sc.slug = $${params.length}
      )`);
    }
    if (input.openNow) filters.push("discovery_is_open(ml.opening_hours) = true");
    if (input.latitude !== null && input.longitude !== null) {
      params.push(input.longitude, input.latitude);
      filters.push(`ST_DWithin(
        ml.location::geography,
        ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography,
        m.delivery_radius_km * 1000
      )`);
    }
    const from = `FROM products p
      JOIN merchants m ON m.id = p.merchant_id
      JOIN LATERAL (
        SELECT ml.* FROM merchant_locations ml
        JOIN cities c ON c.id = ml.city_id
        WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $1 AND c.is_active = true
        ORDER BY ml.name ASC LIMIT 1
      ) ml ON true
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE ${filters.join(" AND ")}`;
    const count = await this.getPool().query<{ count: string }>(`SELECT count(*)::text AS count ${from}`, params);
    const limitIndex = params.push(input.limit);
    const offsetIndex = params.push(input.offset);
    const result = await this.getPool().query<SearchProductRow>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              m.slug AS merchant_slug, m.display_name AS merchant_name, m.logo_url AS merchant_logo_url,
              m.cover_image_url AS merchant_cover_image_url, m.rating AS merchant_rating
       ${from}
       ORDER BY (p.display_name ILIKE $2) DESC, m.rating DESC, p.display_name ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    return { items: result.rows.map(mapSearchProduct), total: Number(count.rows[0]?.count ?? "0") };
  }

  async getHome(input: Readonly<{ citySlug: string; userId: string | null; latitude: number | null; longitude: number | null }>): Promise<DiscoveryHomeRecord> {
    const categories = await this.listActiveServiceCategories();
    const banners = await this.listBanners();
    const offers = await this.listOffers();
    const featuredResult = await this.listMerchants({
      citySlug: input.citySlug,
      categorySlug: null,
      query: null,
      limit: 6,
      offset: 0,
      sort: "recommended",
      openNow: false,
      featuredOnly: true,
      favoritesUserId: null,
      latitude: input.latitude,
      longitude: input.longitude
    });
    const recommendationResult = await this.listMerchants({
      citySlug: input.citySlug,
      categorySlug: null,
      query: null,
      limit: 12,
      offset: 0,
      sort: "rating",
      openNow: false,
      featuredOnly: false,
      favoritesUserId: null,
      latitude: input.latitude,
      longitude: input.longitude
    });
    const featuredIds = new Set(featuredResult.items.map((merchant) => merchant.id));
    const recommendations = recommendationResult.items.filter((merchant) => !featuredIds.has(merchant.id)).slice(0, 8);
    const [popularProducts, recentlyOrdered, stats] = await Promise.all([
      this.listPopularProducts(input.citySlug, input.latitude, input.longitude),
      input.userId ? this.listRecentlyOrdered(input.userId) : Promise.resolve([]),
      this.homeStats(input.citySlug, input.latitude, input.longitude)
    ]);
    return {
      banners,
      offers,
      categories,
      featured: featuredResult.items,
      recommendations,
      popularProducts,
      recentlyOrdered,
      stats
    };
  }

  private async listBanners(): Promise<readonly DiscoveryBannerRecord[]> {
    const result = await this.getPool().query<BannerRow>(
      `SELECT id, title, subtitle, code, cta_label, image_url, accent_color
       FROM discovery_banners
       WHERE is_active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
       ORDER BY sort_order ASC, created_at ASC`
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      code: row.code,
      ctaLabel: row.cta_label,
      imageUrl: row.image_url,
      accentColor: row.accent_color
    }));
  }

  private async listOffers(): Promise<readonly DiscoveryOfferRecord[]> {
    const result = await this.getPool().query<OfferRow>(
      `SELECT id, code, display_name, kind, value, currency, minimum_order_minor, maximum_discount_minor, merchant_id
       FROM promotions
       WHERE is_active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
       ORDER BY created_at DESC
       LIMIT 6`
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      displayName: row.display_name,
      kind: row.kind,
      value: Number(row.value),
      currency: row.currency,
      minimumOrderMinor: Number(row.minimum_order_minor),
      maximumDiscountMinor: row.maximum_discount_minor === null ? null : Number(row.maximum_discount_minor),
      merchantId: row.merchant_id
    }));
  }

  private async listPopularProducts(citySlug: string, latitude: number | null, longitude: number | null): Promise<readonly SearchProductRecord[]> {
    const params: unknown[] = [citySlug];
    let availability = "";
    if (latitude !== null && longitude !== null) {
      params.push(longitude, latitude);
      availability = `AND ST_DWithin(
        ml.location::geography,
        ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography,
        m.delivery_radius_km * 1000
      )`;
    }
    const result = await this.getPool().query<SearchProductRow>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              m.slug AS merchant_slug, m.display_name AS merchant_name, m.logo_url AS merchant_logo_url,
              m.cover_image_url AS merchant_cover_image_url, m.rating AS merchant_rating
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id AND m.status = 'active'
       JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
       JOIN cities c ON c.id = ml.city_id AND c.slug = $1 AND c.is_active = true
       LEFT JOIN inventory i ON i.product_id = p.id
       LEFT JOIN (
         SELECT oi.product_id, sum(oi.quantity)::int AS ordered
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at > now() - interval '30 days' AND o.status NOT IN ('CANCELLED', 'REFUNDED')
         GROUP BY oi.product_id
       ) sales ON sales.product_id = p.id
       WHERE p.is_available = true ${availability}
       ORDER BY COALESCE(sales.ordered, 0) DESC, m.rating DESC, p.display_name ASC
       LIMIT 8`,
      params
    );
    const unique = new Map<string, SearchProductRow>();
    for (const row of result.rows) if (!unique.has(row.id)) unique.set(row.id, row);
    return [...unique.values()].map(mapSearchProduct);
  }

  private async listRecentlyOrdered(userId: string): Promise<readonly RecentlyOrderedRecord[]> {
    const result = await this.getPool().query<RecentOrderRow>(
      `SELECT o.id, o.order_number, o.status, o.created_at,
              m.id AS merchant_id, m.slug AS merchant_slug, m.display_name AS merchant_name,
              m.logo_url AS merchant_logo_url, m.cover_image_url AS merchant_cover_image_url,
              json_agg(json_build_object('displayName', oi.display_name, 'quantity', oi.quantity) ORDER BY oi.display_name) AS items
       FROM orders o
       JOIN merchants m ON m.id = o.merchant_id
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = $1 AND o.status NOT IN ('CANCELLED', 'REFUNDED')
       GROUP BY o.id, o.order_number, o.status, o.created_at, m.id, m.slug, m.display_name, m.logo_url, m.cover_image_url
       ORDER BY o.created_at DESC
       LIMIT 5`,
      [userId]
    );
    return result.rows.map((row) => ({
      orderId: row.id,
      orderNumber: row.order_number,
      status: row.status,
      orderedAt: row.created_at.toISOString(),
      merchant: {
        id: row.merchant_id,
        slug: row.merchant_slug,
        displayName: row.merchant_name,
        logoUrl: row.merchant_logo_url,
        coverImageUrl: row.merchant_cover_image_url
      },
      items: Array.isArray(row.items) ? row.items : []
    }));
  }

  private async homeStats(citySlug: string, latitude: number | null, longitude: number | null): Promise<{ merchantCount: number; openNowCount: number }> {
    const params: unknown[] = [citySlug];
    let availability = "";
    if (latitude !== null && longitude !== null) {
      params.push(longitude, latitude);
      availability = `AND ST_DWithin(
        ml.location::geography,
        ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography,
        m.delivery_radius_km * 1000
      )`;
    }
    const result = await this.getPool().query<{ merchant_count: string; open_now_count: string }>(
      `SELECT count(DISTINCT m.id)::text AS merchant_count,
              count(DISTINCT m.id) FILTER (WHERE discovery_is_open(ml.opening_hours))::text AS open_now_count
       FROM merchants m
       JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
       JOIN cities c ON c.id = ml.city_id AND c.slug = $1 AND c.is_active = true
       WHERE m.status = 'active' ${availability}`,
      params
    );
    return {
      merchantCount: Number(result.rows[0]?.merchant_count ?? "0"),
      openNowCount: Number(result.rows[0]?.open_now_count ?? "0")
    };
  }

  async listFavorites(userId: string, citySlug: string, latitude: number | null, longitude: number | null): Promise<readonly MerchantSummaryRecord[]> {
    const result = await this.listMerchants({
      citySlug,
      categorySlug: null,
      query: null,
      limit: 50,
      offset: 0,
      sort: "name",
      openNow: false,
      featuredOnly: false,
      favoritesUserId: userId,
      latitude,
      longitude
    });
    return result.items;
  }

  async addFavorite(userId: string, merchantId: string): Promise<boolean> {
    const result = await this.getPool().query(
      `INSERT INTO favorites (user_id, merchant_id, product_id)
       SELECT $1, m.id, NULL FROM merchants m WHERE m.id = $2 AND m.status = 'active'
       ON CONFLICT DO NOTHING`,
      [userId, merchantId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async removeFavorite(userId: string, merchantId: string): Promise<boolean> {
    const result = await this.getPool().query(
      `DELETE FROM favorites WHERE user_id = $1 AND merchant_id = $2 AND product_id IS NULL`,
      [userId, merchantId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listRecentSearches(userId: string, limit: number): Promise<readonly RecentSearchRecord[]> {
    const result = await this.getPool().query<{ term: string; last_searched_at: Date }>(
      `SELECT term, last_searched_at FROM user_recent_searches
       WHERE user_id = $1 ORDER BY last_searched_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map((row) => ({ term: row.term, lastSearchedAt: row.last_searched_at.toISOString() }));
  }

  async recordRecentSearch(userId: string, term: string): Promise<void> {
    await this.getPool().query(
      `INSERT INTO user_recent_searches (user_id, term)
       VALUES ($1, $2)
       ON CONFLICT (user_id, term) DO UPDATE
       SET hit_count = user_recent_searches.hit_count + 1, last_searched_at = now()`,
      [userId, term]
    );
    await this.getPool().query(
      `DELETE FROM user_recent_searches
       WHERE user_id = $1 AND term NOT IN (
         SELECT term FROM user_recent_searches WHERE user_id = $1 ORDER BY last_searched_at DESC LIMIT 10
       )`,
      [userId]
    );
  }

  async clearRecentSearches(userId: string): Promise<void> {
    await this.getPool().query("DELETE FROM user_recent_searches WHERE user_id = $1", [userId]);
  }

  private async buildSuggestions(query: string): Promise<readonly string[]> {
    const result = await this.getPool().query<{ term: string }>(
      `SELECT term FROM (
         SELECT display_name AS term FROM merchants WHERE status = 'active' AND display_name ILIKE $1
         UNION
         SELECT display_name AS term FROM products WHERE is_available = true AND display_name ILIKE $1
       ) matches
       GROUP BY term
       ORDER BY term ASC
       LIMIT 6`,
      [`%${escapeLike(query)}%`]
    );
    return result.rows.map((row) => row.term);
  }

  private distanceExpression(params: unknown[], latitude: number | null, longitude: number | null, alias: string): string {
    if (latitude === null || longitude === null) return "NULL::double precision";
    const latIndex = params.push(latitude);
    const lngIndex = params.push(longitude);
    return `(6371.0 * 2 * asin(sqrt(
      power(sin(radians(ST_Y(${alias}.location) - $${latIndex}) / 2), 2) +
      cos(radians($${latIndex})) * cos(radians(ST_Y(${alias}.location))) *
      power(sin(radians(ST_X(${alias}.location) - $${lngIndex}) / 2), 2)
    )))`;
  }

  private async attachCategorySlugs(rows: readonly MerchantRow[]): Promise<MerchantSummaryRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const categories = await this.getPool().query<{ merchant_id: string; slug: string }>(
      `SELECT msc.merchant_id, sc.slug
       FROM merchant_service_categories msc
       JOIN service_categories sc ON sc.id = msc.service_category_id
       WHERE msc.merchant_id = ANY($1::uuid[]) AND sc.is_active = true
       ORDER BY sc.sort_order ASC`,
      [ids]
    );
    const byMerchant = new Map<string, string[]>();
    for (const row of categories.rows) {
      const list = byMerchant.get(row.merchant_id) ?? [];
      list.push(row.slug);
      byMerchant.set(row.merchant_id, list);
    }
    return rows.map((row) => mapMerchant(row, byMerchant.get(row.id) ?? []));
  }
}

type CategoryRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  merchant_count: number;
};

type MerchantRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  rating: string;
  rating_count: number;
  price_level: number;
  delivery_fee_minor: string;
  min_order_minor: string;
  eta_min_minutes: number;
  eta_max_minutes: number;
  is_featured: boolean;
  tags: string[] | null;
  location_name: string | null;
  address_line: string | null;
  opening_hours: Record<string, unknown> | null;
  latitude: number | string | null;
  longitude: number | string | null;
  is_open: boolean;
  distance_km: number | string | null;
};

type ProductRow = {
  id: string;
  merchant_id: string;
  sku: string | null;
  display_name: string;
  description: string | null;
  image_url: string | null;
  base_price_minor: string;
  currency: string;
  is_available: boolean;
  quantity_available: number | null;
};

type SearchProductRow = ProductRow & {
  merchant_slug: string;
  merchant_name: string;
  merchant_logo_url: string | null;
  merchant_cover_image_url: string | null;
  merchant_rating: string;
};

type OfferRow = {`n  id: string;`n  code: string;`n  display_name: string;`n  kind: string;`n  value: string;`n  currency: string;`n  minimum_order_minor: string;`n  maximum_discount_minor: string | null;`n  merchant_id: string | null;`n};`n`ntype BannerRow = {
  id: string;
  title: string;
  subtitle: string;
  code: string | null;
  cta_label: string;
  image_url: string | null;
  accent_color: string;
};

type RecentOrderRow = {
  id: string;
  order_number: string;
  status: string;
  created_at: Date;
  merchant_id: string;
  merchant_slug: string;
  merchant_name: string;
  merchant_logo_url: string | null;
  merchant_cover_image_url: string | null;
  items: Readonly<{ displayName: string; quantity: number }>[] | null;
};

function mapCategory(row: CategoryRow): ServiceCategoryRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    sortOrder: row.sort_order,
    merchantCount: row.merchant_count
  };
}

function mapMerchant(row: MerchantRow, serviceCategorySlugs: readonly string[]): MerchantSummaryRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    serviceCategorySlugs,
    primaryLocationName: row.location_name,
    rating: Number(row.rating),
    ratingCount: row.rating_count,
    priceLevel: row.price_level,
    deliveryFeeMinor: Number(row.delivery_fee_minor),
    minOrderMinor: Number(row.min_order_minor),
    deliveryRadiusKm: Number(row.delivery_radius_km),`n    etaMinMinutes: row.eta_min_minutes,
    etaMaxMinutes: row.eta_max_minutes,
    isFeatured: row.is_featured,
    tags: row.tags ?? [],
    isOpen: row.is_open,
    distanceKm: row.distance_km === null ? null : Math.round(Number(row.distance_km) * 10) / 10
  };
}

function mapProduct(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    sku: row.sku,
    displayName: row.display_name,
    description: row.description,
    imageUrl: row.image_url,
    basePriceMinor: Number(row.base_price_minor),
    currency: row.currency,
    isAvailable: row.is_available,
    quantityAvailable: row.quantity_available
  };
}

function mapSearchProduct(row: SearchProductRow): SearchProductRecord {
  return {
    ...mapProduct(row),
    merchant: {
      id: row.merchant_id,
      slug: row.merchant_slug,
      displayName: row.merchant_name,
      logoUrl: row.merchant_logo_url,
      coverImageUrl: row.merchant_cover_image_url,
      rating: Number(row.merchant_rating)
    }
  };
}

function orderBy(sort: MerchantSort): string {
  switch (sort) {
    case "distance":
      return "distance_km ASC NULLS LAST, m.rating DESC";
    case "rating":
      return "m.rating DESC, m.rating_count DESC, distance_km ASC NULLS LAST";
    case "eta":
      return "m.eta_max_minutes ASC, distance_km ASC NULLS LAST";
    case "name":
      return "m.display_name ASC";
    default:
      return "m.is_featured DESC, m.rating DESC, m.rating_count DESC, distance_km ASC NULLS LAST";
  }
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}


