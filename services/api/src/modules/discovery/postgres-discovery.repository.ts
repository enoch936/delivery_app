import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Pool } from "pg";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import type {
  DiscoveryBannerRecord,
  DiscoveryHomeRecord,
  DiscoveryOfferRecord,
  DiscoveryRepository,
  MerchantDayHours,
  MerchantDetailRecord,
  MerchantListInput,
  MerchantSort,
  MerchantSummaryRecord,
  MerchantWeeklyHours,
  ProductOptionGroupRecord,
  ProductOptionRecord,
  ProductRecord,
  ProductStockState,
  RecentlyOrderedRecord,
  RecentSearchRecord,
  SearchInput,
  SearchProductRecord,
  SearchResultRecord,
  SearchSuggestionRecord,
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
    let rankExpression: string | null = null;
    let affinityExpression: string | null = null;
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
      filters.push(`discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, $${params.length}, $${params.length - 1})`);
    }

    const from = `FROM merchants m
      JOIN LATERAL (
        SELECT ml.* FROM merchant_locations ml
        JOIN cities c ON c.id = ml.city_id
        WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $1 AND c.is_active = true
        ORDER BY ${this.branchOrder(input.latitude, input.longitude)} LIMIT 1
      ) ml ON true
      WHERE ${filters.join(" AND ")}`;
    const count = await this.getPool().query<{ count: string }>(`SELECT count(*)::text AS count ${from}`, params);

    // Ranking and personalisation parameters are only referenced by the page
    // query, so they are bound after the count query has run.
    if (input.sort === "recommended" && input.query) {
      params.push(input.query);
      rankExpression = `GREATEST(similarity(m.display_name, $${params.length}), similarity(COALESCE(m.description, ''), $${params.length}) * 0.6)`;
    }
    if (input.sort === "recommended" && input.recommendationUserId) {
      params.push(input.recommendationUserId);
      affinityExpression = `(SELECT count(*) FROM orders o
        WHERE o.user_id = $${params.length} AND o.merchant_id = m.id
          AND o.status NOT IN ('CANCELLED', 'REFUNDED') AND o.created_at > now() - interval '180 days')`;
    }

    const distance = this.distanceExpression(params, input.latitude, input.longitude, "ml");
    const eta = `discovery_eta(${distance}, m.eta_min_minutes, m.eta_max_minutes)`;
    const boost = input.sort === "recommended"
      ? `${affinityExpression ? `(${affinityExpression}) DESC, ` : ""}${rankExpression ? `${rankExpression} DESC, ` : ""}`
      : "";
    const limitIndex = params.push(input.limit);
    const offsetIndex = params.push(input.offset);
    const result = await this.getPool().query<MerchantRow>(
      `SELECT m.id, m.slug, m.display_name, m.description, m.logo_url, m.cover_image_url,
              m.rating, m.rating_count, m.price_level, m.delivery_fee_minor, m.min_order_minor,
              m.delivery_radius_km, (${eta})[1] AS eta_min_minutes, (${eta})[2] AS eta_max_minutes,
              m.is_featured, m.tags, m.supports_pickup, m.allows_scheduling,
              ml.name AS location_name, ml.address_line, ml.opening_hours,
              ST_Y(ml.location) AS latitude, ST_X(ml.location) AS longitude,
              discovery_is_open(ml.opening_hours) AS is_open,
              discovery_today_hours(ml.opening_hours) AS today_hours,
              CASE WHEN discovery_is_open(ml.opening_hours) THEN NULL ELSE discovery_next_open(ml.opening_hours) END AS next_open_at,
              true AS is_deliverable,
              ${distance} AS distance_km
       ${from}
       ORDER BY ${boost}${orderBy(input.sort)}
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    const items = await this.attachCategorySlugs(result.rows);
    return { items, total: Number(count.rows[0]?.count ?? "0") };
  }

  async getMerchantById(merchantId: string, citySlug: string, latitude: number | null, longitude: number | null): Promise<MerchantDetailRecord | null> {
    const params: unknown[] = [merchantId, citySlug];
    const distance = this.distanceExpression(params, latitude, longitude, "ml");
    const deliverable = latitude !== null && longitude !== null
      ? "discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, $3, $4)"
      : "true";
    const eta = `discovery_eta(${distance}, m.eta_min_minutes, m.eta_max_minutes)`;
    const result = await this.getPool().query<MerchantRow>(
      `SELECT m.id, m.slug, m.display_name, m.description, m.logo_url, m.cover_image_url,
              m.rating, m.rating_count, m.price_level, m.delivery_fee_minor, m.min_order_minor,
              m.delivery_radius_km, (${eta})[1] AS eta_min_minutes, (${eta})[2] AS eta_max_minutes,
              m.is_featured, m.tags, m.supports_pickup, m.allows_scheduling,
              m.cancellation_policy, m.refund_policy, m.pickup_instructions,
              m.min_schedule_lead_minutes, m.max_schedule_days,
              ml.name AS location_name, ml.address_line, ml.opening_hours,
              ST_Y(ml.location) AS latitude, ST_X(ml.location) AS longitude,
              discovery_is_open(ml.opening_hours) AS is_open,
              discovery_today_hours(ml.opening_hours) AS today_hours,
              CASE WHEN discovery_is_open(ml.opening_hours) THEN NULL ELSE discovery_next_open(ml.opening_hours) END AS next_open_at,
              ${deliverable} AS is_deliverable,
              ${distance} AS distance_km
       FROM merchants m
       JOIN LATERAL (
         SELECT ml.* FROM merchant_locations ml
         JOIN cities c ON c.id = ml.city_id
         WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $2 AND c.is_active = true
          ORDER BY ${this.branchOrder(latitude, longitude)} LIMIT 1
       ) ml ON true
        WHERE m.id = $1 AND m.status = 'active'
       LIMIT 1`,
      params
    );
    const row = result.rows[0];
    if (!row) return null;
    const [summary] = await this.attachCategorySlugs([row]);
    if (!summary) return null;
    const pickupLocations = await this.getPool().query<{ id: string; name: string; address_line: string | null; latitude: number | string | null; longitude: number | string | null }>(
      `SELECT ml.id, ml.name, ml.address_line, ST_Y(ml.location) AS latitude, ST_X(ml.location) AS longitude
       FROM merchant_locations ml
       WHERE ml.merchant_id = $1 AND ml.is_active = true AND ml.location IS NOT NULL
       ORDER BY ml.created_at ASC`,
      [merchantId]
    );
    return {
      ...summary,
      openingHours: row.opening_hours ?? {},
      weeklyHours: weeklyHours(row.opening_hours ?? {}),
      addressLine: row.address_line ?? null,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      deliveryUnavailableReason: summary.isDeliverable ? null : "Your delivery address is outside this merchant's delivery area.",
      policy: {
        cancellationPolicy: row.cancellation_policy ?? null,
        refundPolicy: row.refund_policy ?? null
      },
      fulfillment: {
        supportsPickup: row.supports_pickup ?? false,
        pickupInstructions: row.pickup_instructions ?? null,
        allowsScheduling: row.allows_scheduling ?? false,
        minScheduleLeadMinutes: row.min_schedule_lead_minutes ?? 60,
        maxScheduleDays: row.max_schedule_days ?? 3
      },
      pickupLocations: pickupLocations.rows.map((location) => ({
        id: location.id,
        name: location.name,
        addressLine: location.address_line,
        latitude: location.latitude === null ? null : Number(location.latitude),
        longitude: location.longitude === null ? null : Number(location.longitude)
      }))
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
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              catalog_stock_state(p.is_available, i.quantity_available) AS stock_state
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.merchant_id = $1 ${queryFilter}
       ORDER BY p.is_available DESC, p.display_name ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    const groups = await this.loadProductOptionGroups(result.rows.map((row) => row.id));
    return {
      items: result.rows.map((row) => mapProduct(row, groups.get(row.id) ?? [])),
      total: Number(count.rows[0]?.count ?? "0")
    };
  }

  async search(input: SearchInput): Promise<SearchResultRecord> {
    const includeMerchants = input.type === "all" || input.type === "merchant";
    const includeProducts = input.type === "all" || input.type === "product";
    const includeServices = input.type === "all" || input.type === "service";
    // Mixed search returns the top hits of every section; paging therefore only
    // applies to a single typed section, which keeps totals honest.
    const paged = input.type !== "all";

    const merchantResult = includeMerchants
      ? await this.listMerchants({
          citySlug: input.citySlug,
          categorySlug: input.categorySlug,
          query: input.query,
          limit: input.limit,
          offset: paged ? input.offset : 0,
          sort: input.sort,
          openNow: input.openNow,
          featuredOnly: false,
          favoritesUserId: null,
          recommendationUserId: null,
          latitude: input.latitude,
          longitude: input.longitude
        })
      : { items: [], total: 0 };
    const productResult = includeProducts
      ? await this.searchProducts({ ...input, offset: paged ? input.offset : 0 })
      : { items: [], total: 0 };
    const merchants = merchantResult.items;
    const products = productResult.items;
    const allCategories = includeServices ? await this.availableCategories(input.citySlug, input.latitude, input.longitude) : [];
    const matchedServices = allCategories.filter((category) => {
      if (category.merchantCount === 0) return false;
      if (input.categorySlug && category.slug !== input.categorySlug) return false;
      const haystack = `${category.displayName} ${category.description ?? ""} ${category.slug}`.toLowerCase();
      return haystack.includes(input.query.toLowerCase());
    });
    const services = paged ? matchedServices.slice(input.offset, input.offset + input.limit) : matchedServices.slice(0, input.limit);

    const items = [
      ...merchants.map((merchant) => ({ type: "merchant" as const, merchant })),
      ...products.map((product) => ({ type: "product" as const, product, merchant: product.merchant })),
      ...services.map((service) => ({ type: "service" as const, service }))
    ].slice(0, input.limit);
    const suggestions = [...new Set((await this.searchSuggestions({
      citySlug: input.citySlug,
      query: input.query,
      limit: 6
    })).map((suggestion) => suggestion.label))].slice(0, 6);

    return {
      query: input.query,
      items,
      total: merchantResult.total + productResult.total + matchedServices.length,
      merchants: items.flatMap((item) => item.type === "merchant" ? [item.merchant] : []),
      products: items.flatMap((item) => item.type === "product" ? [item.product] : []),
      services: items.flatMap((item) => item.type === "service" ? [item.service] : []),
      suggestions
    };
  }

  async searchSuggestions(input: Readonly<{ citySlug: string; query: string; limit: number }>): Promise<readonly SearchSuggestionRecord[]> {
    const result = await this.getPool().query<SuggestionRow>(
      `WITH matches AS (
         SELECT 'merchant'::text AS kind, m.display_name AS label,
                COALESCE((SELECT sc.display_name FROM merchant_service_categories msc
                          JOIN service_categories sc ON sc.id = msc.service_category_id
                          WHERE msc.merchant_id = m.id ORDER BY sc.sort_order LIMIT 1), 'Store') AS subtitle,
                (SELECT sc.slug FROM merchant_service_categories msc
                 JOIN service_categories sc ON sc.id = msc.service_category_id
                 WHERE msc.merchant_id = m.id ORDER BY sc.sort_order LIMIT 1) AS category_slug,
                m.id::text AS target_id, similarity(m.display_name, $2) AS score
         FROM merchants m
         WHERE m.status = 'active' AND (m.display_name ILIKE $3 OR m.tags::text ILIKE $3)
           AND EXISTS (SELECT 1 FROM merchant_locations ml JOIN cities c ON c.id = ml.city_id
                       WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $1 AND c.is_active = true)
         UNION ALL
         SELECT 'product', p.display_name, m.display_name,
                (SELECT sc.slug FROM merchant_service_categories msc
                 JOIN service_categories sc ON sc.id = msc.service_category_id
                 WHERE msc.merchant_id = m.id ORDER BY sc.sort_order LIMIT 1),
                p.id::text, similarity(p.display_name, $2)
         FROM products p
         JOIN merchants m ON m.id = p.merchant_id AND m.status = 'active'
         WHERE p.is_available = true AND (p.display_name ILIKE $3 OR p.sku ILIKE $3)
         UNION ALL
         SELECT 'service', sc.display_name, COALESCE(sc.description, 'Service'), sc.slug, sc.id::text,
                similarity(sc.display_name, $2)
         FROM service_categories sc
         WHERE sc.is_active = true AND (sc.display_name ILIKE $3 OR sc.slug ILIKE $3)
       )
       SELECT kind, label, subtitle, category_slug, target_id
       FROM matches
       WHERE label IS NOT NULL
       ORDER BY (label ILIKE $4) DESC, score DESC, label ASC
       LIMIT $5`,
      [input.citySlug, input.query, `%${escapeLike(input.query)}%`, `${escapeLike(input.query)}%`, input.limit]
    );
    return result.rows.map((row) => ({
      type: row.kind,
      label: row.label,
      subtitle: row.subtitle ?? "",
      categorySlug: row.category_slug,
      targetId: row.target_id
    }));
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
      filters.push(`discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, $${params.length}, $${params.length - 1})`);
    }
    const from = `FROM products p
      JOIN merchants m ON m.id = p.merchant_id
      JOIN LATERAL (
        SELECT ml.* FROM merchant_locations ml
        JOIN cities c ON c.id = ml.city_id
        WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $1 AND c.is_active = true
        ORDER BY ${this.branchOrder(input.latitude, input.longitude)} LIMIT 1
      ) ml ON true
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE ${filters.join(" AND ")} AND (i.quantity_available IS NULL OR i.quantity_available > 0)`;
    const count = await this.getPool().query<{ count: string }>(`SELECT count(*)::text AS count ${from}`, params);
    params.push(input.query);
    const rawIndex = params.length;
    params.push(`${escapeLike(input.query)}%`);
    const prefixIndex = params.length;
    const limitIndex = params.push(input.limit);
    const offsetIndex = params.push(input.offset);
    const result = await this.getPool().query<SearchProductRow>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              catalog_stock_state(p.is_available, i.quantity_available) AS stock_state,
              m.slug AS merchant_slug, m.display_name AS merchant_name, m.logo_url AS merchant_logo_url,
              m.cover_image_url AS merchant_cover_image_url, m.rating AS merchant_rating
       ${from}
       ORDER BY ${
         input.sort === "eta" ? "m.eta_max_minutes ASC, "
           : input.sort === "name" ? "p.display_name ASC, "
             : input.sort === "distance" && input.latitude !== null && input.longitude !== null
               ? `ST_Distance(ml.location::geography, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography) ASC, `
               : ""
       }GREATEST(similarity(p.display_name, $${rawIndex}), similarity(COALESCE(p.description, ''), $${rawIndex}) * 0.7, similarity(m.display_name, $${rawIndex}) * 0.5) DESC,
       (p.display_name ILIKE $${prefixIndex}) DESC, m.rating DESC, p.id ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    return { items: result.rows.map(mapSearchProduct), total: Number(count.rows[0]?.count ?? "0") };
  }

  async getHome(input: Readonly<{ citySlug: string; userId: string | null; latitude: number | null; longitude: number | null }>): Promise<DiscoveryHomeRecord> {
    const categories = await this.availableCategories(input.citySlug, input.latitude, input.longitude);
    const banners = await this.listBanners();
    const offers = await this.listOffers(input);
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
      recommendationUserId: null,
      latitude: input.latitude,
      longitude: input.longitude
    });
    const recommendationResult = await this.listMerchants({
      citySlug: input.citySlug,
      categorySlug: null,
      query: null,
      limit: 12,
      offset: 0,
      sort: "recommended",
      openNow: false,
      featuredOnly: false,
      favoritesUserId: null,
      recommendationUserId: input.userId,
      latitude: input.latitude,
      longitude: input.longitude
    });
    const featuredIds = new Set(featuredResult.items.map((merchant) => merchant.id));
    const recommendations = recommendationResult.items.filter((merchant) => !featuredIds.has(merchant.id)).slice(0, 8);
    const [popularProducts, recentlyOrdered, recentlyOrderedProducts, stats] = await Promise.all([
      this.listPopularProducts(input.citySlug, input.latitude, input.longitude),
      input.userId ? this.listRecentlyOrdered(input.userId) : Promise.resolve([]),
      input.userId ? this.listRecentlyOrderedProducts(input.userId) : Promise.resolve([]),
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
      recentlyOrderedProducts,
      stats
    };
  }

  private async listBanners(): Promise<readonly DiscoveryBannerRecord[]> {
    const result = await this.getPool().query<BannerRow>(
      `SELECT id, title, subtitle, code, cta_label, image_url, accent_color, target_category_slug, target_merchant_id
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
      accentColor: row.accent_color,
      targetCategorySlug: row.target_category_slug,
      targetMerchantId: row.target_merchant_id
    }));
  }

  private async listRecentlyOrderedProducts(userId: string): Promise<readonly SearchProductRecord[]> {
    const result = await this.getPool().query<SearchProductRow>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              catalog_stock_state(p.is_available, i.quantity_available) AS stock_state,
              m.slug AS merchant_slug, m.display_name AS merchant_name, m.logo_url AS merchant_logo_url,
              m.cover_image_url AS merchant_cover_image_url, m.rating AS merchant_rating
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.user_id = $1 AND o.status NOT IN ('CANCELLED', 'REFUNDED')
       JOIN products p ON p.id = oi.product_id AND p.is_available = true
       JOIN merchants m ON m.id = p.merchant_id AND m.status = 'active'
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE i.quantity_available IS NULL OR i.quantity_available > 0
       GROUP BY p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available,
                i.quantity_available, m.slug, m.display_name, m.logo_url, m.cover_image_url, m.rating
       ORDER BY max(o.created_at) DESC
       LIMIT 8`,
      [userId]
    );
    return result.rows.map(mapSearchProduct);
  }

  private async listOffers(input: Readonly<{ citySlug: string; userId: string | null; latitude: number | null; longitude: number | null }>): Promise<readonly DiscoveryOfferRecord[]> {
    const result = await this.getPool().query<OfferRow>(
      `SELECT id, code, display_name, kind, value, currency, minimum_order_minor, maximum_discount_minor, merchant_id
       FROM promotions promotion
       WHERE is_active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
         AND (usage_limit IS NULL OR (SELECT count(*) FROM promotion_redemptions r WHERE r.promotion_id = promotion.id) < usage_limit)
         AND ($2::uuid IS NULL OR (SELECT count(*) FROM promotion_redemptions r WHERE r.promotion_id = promotion.id AND r.user_id = $2) < per_user_limit)
         AND (merchant_id IS NULL OR EXISTS (
           SELECT 1 FROM merchants m JOIN merchant_locations ml ON ml.merchant_id = m.id
           JOIN cities c ON c.id = ml.city_id
           WHERE m.id = promotion.merchant_id AND m.status = 'active' AND ml.is_active = true
             AND c.slug = $1 AND c.is_active = true
             AND discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, $3, $4)
         ))
       ORDER BY created_at DESC
       LIMIT 6`,
      [input.citySlug, input.userId, input.latitude, input.longitude]
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
      availability = `AND discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, $${params.length}, $${params.length - 1})`;
    }
    const result = await this.getPool().query<SearchProductRow>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              catalog_stock_state(p.is_available, i.quantity_available) AS stock_state,
              m.slug AS merchant_slug, m.display_name AS merchant_name, m.logo_url AS merchant_logo_url,
              m.cover_image_url AS merchant_cover_image_url, m.rating AS merchant_rating
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id AND m.status = 'active'
       JOIN LATERAL (
         SELECT ml.* FROM merchant_locations ml JOIN cities c ON c.id = ml.city_id
         WHERE ml.merchant_id = m.id AND ml.is_active = true AND c.slug = $1 AND c.is_active = true
         ORDER BY ${this.branchOrder(latitude, longitude)} LIMIT 1
       ) ml ON true
       LEFT JOIN inventory i ON i.product_id = p.id
       LEFT JOIN (
         SELECT oi.product_id, sum(oi.quantity)::int AS ordered
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at > now() - interval '30 days' AND o.status NOT IN ('CANCELLED', 'REFUNDED')
         GROUP BY oi.product_id
       ) sales ON sales.product_id = p.id
       WHERE p.is_available = true AND (i.quantity_available IS NULL OR i.quantity_available > 0) ${availability}
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
      availability = `AND discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, $${params.length}, $${params.length - 1})`;
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
      recommendationUserId: null,
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

  private branchOrder(latitude: number | null, longitude: number | null): string {
    if (latitude === null || longitude === null) return "ml.name ASC, ml.id ASC";
    // Coordinates are validated by the service; only finite numbers enter SQL.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Invalid coordinates");
    return `discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, ${latitude}, ${longitude}) DESC NULLS LAST,
      ST_Distance(ml.location::geography, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography) ASC NULLS LAST, ml.id ASC`;
  }

  private async availableCategories(citySlug: string, latitude: number | null, longitude: number | null): Promise<readonly ServiceCategoryRecord[]> {
    const result = await this.getPool().query<CategoryRow>(
      `SELECT sc.id, sc.slug, sc.display_name, sc.description, sc.sort_order,
        (SELECT count(DISTINCT m.id)::int FROM merchant_service_categories msc
         JOIN merchants m ON m.id = msc.merchant_id AND m.status = 'active'
         JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
         JOIN cities c ON c.id = ml.city_id AND c.slug = $1 AND c.is_active = true
         WHERE msc.service_category_id = sc.id
           AND discovery_location_available(ml.location, ml.service_zone_id, m.delivery_radius_km, $2, $3)) AS merchant_count
       FROM service_categories sc WHERE sc.is_active = true ORDER BY sc.sort_order, sc.id`,
      [citySlug, latitude, longitude]
    );
    return result.rows.map(mapCategory);
  }

  private async loadProductOptionGroups(productIds: readonly string[]): Promise<Map<string, ProductOptionGroupRecord[]>> {
    const byProduct = new Map<string, ProductOptionGroupRecord[]>();
    if (productIds.length === 0) return byProduct;
    const result = await this.getPool().query<{
      product_id: string;
      group_id: string;
      group_slug: string;
      group_name: string;
      selection_type: "single" | "multi";
      is_required: boolean;
      min_selections: number;
      max_selections: number;
      option_id: string | null;
      option_sku: string | null;
      option_name: string | null;
      price_delta_minor: string | null;
      is_default: boolean | null;
      is_option_available: boolean | null;
    }>(
      `SELECT g.product_id, g.id AS group_id, g.slug AS group_slug, g.display_name AS group_name,
              g.selection_type, g.is_required, g.min_selections, g.max_selections,
              o.id AS option_id, o.sku AS option_sku, o.display_name AS option_name,
              o.price_delta_minor, o.is_default, o.is_available AS is_option_available
       FROM product_option_groups g
       LEFT JOIN product_options o ON o.group_id = g.id
       WHERE g.product_id = ANY($1::uuid[])
       ORDER BY g.sort_order ASC, g.display_name ASC, o.sort_order ASC, o.display_name ASC`,
      [productIds]
    );
    const groups = new Map<string, Map<string, { record: Omit<ProductOptionGroupRecord, "options">; options: ProductOptionRecord[] }>>();
    for (const row of result.rows) {
      const productGroups = groups.get(row.product_id) ?? new Map();
      groups.set(row.product_id, productGroups);
      let group = productGroups.get(row.group_id);
      if (!group) {
        group = {
          record: {
            id: row.group_id,
            slug: row.group_slug,
            displayName: row.group_name,
            selectionType: row.selection_type,
            isRequired: row.is_required,
            minSelections: row.min_selections,
            maxSelections: row.max_selections
          },
          options: []
        };
        productGroups.set(row.group_id, group);
      }
      if (row.option_id) {
        group.options.push({
          id: row.option_id,
          sku: row.option_sku,
          displayName: row.option_name ?? "",
          priceDeltaMinor: Number(row.price_delta_minor ?? 0),
          isDefault: row.is_default ?? false,
          isAvailable: row.is_option_available ?? true
        });
      }
    }
    for (const [productId, productGroups] of groups) {
      byProduct.set(productId, [...productGroups.values()].map((entry) => ({ ...entry.record, options: entry.options })));
    }
    return byProduct;
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
  delivery_radius_km: string;
  eta_min_minutes: number;
  eta_max_minutes: number;
  is_featured: boolean;
  tags: string[] | null;
  supports_pickup: boolean;
  allows_scheduling: boolean;
  cancellation_policy?: string | null;
  refund_policy?: string | null;
  pickup_instructions?: string | null;
  min_schedule_lead_minutes?: number;
  max_schedule_days?: number;
  location_name: string | null;
  address_line: string | null;
  opening_hours: Record<string, unknown> | null;
  latitude: number | string | null;
  longitude: number | string | null;
  is_open: boolean;
  is_deliverable: boolean;
  today_hours: Record<string, unknown> | null;
  next_open_at: Date | string | null;
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
  stock_state: ProductStockState;
};

type SearchProductRow = ProductRow & {
  merchant_slug: string;
  merchant_name: string;
  merchant_logo_url: string | null;
  merchant_cover_image_url: string | null;
  merchant_rating: string;
};

type OfferRow = {
  id: string;
  code: string;
  display_name: string;
  kind: string;
  value: string;
  currency: string;
  minimum_order_minor: string;
  maximum_discount_minor: string | null;
  merchant_id: string | null;
};

type BannerRow = {
  id: string;
  title: string;
  subtitle: string;
  code: string | null;
  cta_label: string;
  image_url: string | null;
  accent_color: string;
  target_category_slug: string | null;
  target_merchant_id: string | null;
};

type SuggestionRow = {
  kind: "merchant" | "product" | "service";
  label: string;
  subtitle: string | null;
  category_slug: string | null;
  target_id: string;
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
    deliveryRadiusKm: Number(row.delivery_radius_km),
    etaMinMinutes: row.eta_min_minutes,
    etaMaxMinutes: row.eta_max_minutes,
    isFeatured: row.is_featured,
    tags: row.tags ?? [],
    isOpen: row.is_open,
    isDeliverable: row.is_deliverable !== false,
    distanceKm: row.distance_km === null ? null : Math.round(Number(row.distance_km) * 10) / 10,
    todayHours: mapTodayHours(row.today_hours),
    nextOpenAt: row.next_open_at === null || row.next_open_at === undefined
      ? null
      : new Date(row.next_open_at).toISOString()
  };
}

function mapTodayHours(value: Record<string, unknown> | null): MerchantDayHours | null {
  if (!value || typeof value !== "object") return null;
  if (value.closed === true) return { closed: true, open: null, close: null };
  if (typeof value.open !== "string" || typeof value.close !== "string") return null;
  return { closed: false, open: value.open, close: value.close };
}

const WEEK_DAYS: readonly (readonly [string, string])[] = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"]
];

function weeklyHours(hours: Record<string, unknown>): readonly MerchantWeeklyHours[] {
  return WEEK_DAYS.map(([day, label]) => {
    const raw = (hours[day] ?? hours.default) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") return { day, label, open: null, close: null, closed: false };
    if (raw.closed === true) return { day, label, open: null, close: null, closed: true };
    if (typeof raw.open !== "string" || typeof raw.close !== "string") {
      return { day, label, open: null, close: null, closed: false };
    }
    return { day, label, open: raw.open.slice(0, 5), close: raw.close.slice(0, 5), closed: false };
  });
}

function mapProduct(row: ProductRow, optionGroups: readonly ProductOptionGroupRecord[] = []): ProductRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    sku: row.sku,
    displayName: row.display_name,
    description: row.description,
    imageUrl: row.image_url,
    basePriceMinor: Number(row.base_price_minor),
    currency: row.currency,
    isAvailable: row.is_available && (row.quantity_available === null || row.quantity_available > 0),
    quantityAvailable: row.quantity_available,
    stockState: row.stock_state ?? (row.is_available ? "in_stock" : "out_of_stock"),
    optionGroups
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


