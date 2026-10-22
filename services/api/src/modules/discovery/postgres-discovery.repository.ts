import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Pool } from "pg";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import type { DiscoveryRepository, MerchantDetailRecord, MerchantSummaryRecord, ProductRecord, SearchHitRecord, ServiceCategoryRecord } from "./discovery.types.js";

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
    const result = await this.getPool().query<{ id: string; slug: string; display_name: string; description: string | null; sort_order: number }>(
      `SELECT id, slug, display_name, description, sort_order
       FROM service_categories WHERE is_active = true ORDER BY sort_order ASC, display_name ASC`
    );
    return result.rows.map(mapCategory);
  }

  async listMerchants(input: Readonly<{ citySlug: string; categorySlug: string | null; query: string | null; limit: number; offset: number }>): Promise<{ items: readonly MerchantSummaryRecord[]; total: number }> {
    const params: unknown[] = [input.citySlug];
    let categoryFilter = "";
    if (input.categorySlug) {
      params.push(input.categorySlug);
      categoryFilter = `AND EXISTS (
        SELECT 1 FROM merchant_service_categories msc
        JOIN service_categories sc ON sc.id = msc.service_category_id
        WHERE msc.merchant_id = m.id AND sc.slug = $${params.length} AND sc.is_active = true
      )`;
    }
    let queryFilter = "";
    if (input.query) {
      params.push(`%${escapeLike(input.query)}%`);
      queryFilter = `AND (m.display_name ILIKE $${params.length} OR m.description ILIKE $${params.length})`;
    }
    params.push(input.limit, input.offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const baseFrom = `
      FROM merchants m
      JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
      JOIN cities c ON c.id = ml.city_id AND c.slug = $1 AND c.is_active = true
      WHERE m.status = 'active' ${categoryFilter} ${queryFilter}`;
    const countResult = await this.getPool().query<{ count: string }>(`SELECT count(DISTINCT m.id)::text AS count ${baseFrom}`, params.slice(0, -2));
    const result = await this.getPool().query<MerchantRow>(
      `SELECT m.id, m.slug, m.display_name, m.description, m.logo_url,
              min(ml.name) AS location_name
       ${baseFrom}
       GROUP BY m.id, m.slug, m.display_name, m.description, m.logo_url
       ORDER BY m.display_name ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    const items = await this.attachCategorySlugs(result.rows);
    return { items, total: Number(countResult.rows[0]?.count ?? "0") };
  }

  async getMerchantById(merchantId: string, citySlug: string): Promise<MerchantDetailRecord | null> {
    const result = await this.getPool().query<MerchantRow & { opening_hours: Record<string, unknown>; address_line: string }>(
      `SELECT m.id, m.slug, m.display_name, m.description, m.logo_url, ml.name AS location_name, ml.opening_hours, ml.address_line
       FROM merchants m
       JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
       JOIN cities c ON c.id = ml.city_id AND c.slug = $2 AND c.is_active = true
       WHERE m.id = $1 AND m.status = 'active'
       ORDER BY ml.name ASC LIMIT 1`,
      [merchantId, citySlug]
    );
    const row = result.rows[0];
    if (!row) return null;
    const [summary] = await this.attachCategorySlugs([row]);
    if (!summary) return null;
    return {
      ...summary,
      openingHours: row.opening_hours ?? {},
      addressLine: row.address_line ?? null
    };
  }

  async listProducts(input: Readonly<{ merchantId: string; query: string | null; limit: number; offset: number }>): Promise<{ items: readonly ProductRecord[]; total: number }> {
    const params: unknown[] = [input.merchantId];
    let queryFilter = "";
    if (input.query) {
      params.push(`%${escapeLike(input.query)}%`);
      queryFilter = `AND (p.display_name ILIKE $2 OR p.description ILIKE $2 OR p.sku ILIKE $2)`;
    }
    params.push(input.limit, input.offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const where = `FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.merchant_id = $1 ${queryFilter}`;
    const countResult = await this.getPool().query<{ count: string }>(`SELECT count(*)::text AS count ${where}`, params.slice(0, queryFilter ? 2 : 1));
    const result = await this.getPool().query<ProductRow>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available
       ${where}
       ORDER BY p.display_name ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    );
    return { items: result.rows.map(mapProduct), total: Number(countResult.rows[0]?.count ?? "0") };
  }

  async search(input: Readonly<{ citySlug: string; query: string; limit: number; offset: number }>): Promise<{ items: readonly SearchHitRecord[]; total: number }> {
    const pattern = `%${escapeLike(input.query)}%`;
    const merchantMatches = await this.listMerchants({ citySlug: input.citySlug, categorySlug: null, query: input.query, limit: input.limit, offset: 0 });
    const productResult = await this.getPool().query<ProductRow & { merchant_slug: string; merchant_name: string }>(
      `SELECT p.id, p.merchant_id, p.sku, p.display_name, p.description, p.image_url, p.base_price_minor, p.currency, p.is_available, i.quantity_available,
              m.slug AS merchant_slug, m.display_name AS merchant_name
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id AND m.status = 'active'
       JOIN merchant_locations ml ON ml.merchant_id = m.id AND ml.is_active = true
       JOIN cities c ON c.id = ml.city_id AND c.slug = $1 AND c.is_active = true
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.is_available = true AND (p.display_name ILIKE $2 OR p.description ILIKE $2 OR p.sku ILIKE $2 OR m.display_name ILIKE $2)
       ORDER BY p.display_name ASC
       LIMIT $3`,
      [input.citySlug, pattern, input.limit]
    );
    const hits: SearchHitRecord[] = [
      ...merchantMatches.items.map((merchant) => ({ type: "merchant" as const, merchant })),
      ...productResult.rows.map((row) => ({
        type: "product" as const,
        product: mapProduct(row),
        merchant: { id: row.merchant_id, slug: row.merchant_slug, displayName: row.merchant_name }
      }))
    ];
    return { items: hits.slice(0, input.limit), total: merchantMatches.total + (productResult.rowCount ?? 0) };
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
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      description: row.description,
      logoUrl: row.logo_url,
      serviceCategorySlugs: byMerchant.get(row.id) ?? [],
      primaryLocationName: row.location_name ?? null
    }));
  }
}

type MerchantRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  logo_url: string | null;
  location_name: string | null;
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

function mapCategory(row: { id: string; slug: string; display_name: string; description: string | null; sort_order: number }): ServiceCategoryRecord {
  return { id: row.id, slug: row.slug, displayName: row.display_name, description: row.description, sortOrder: row.sort_order };
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

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
