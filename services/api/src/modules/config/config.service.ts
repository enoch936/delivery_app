import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { readRuntimeConfig, type RuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class ConfigService {
  private readonly config: RuntimeConfig;

  constructor(private readonly database: DatabaseService) {
    this.config = readRuntimeConfig();
  }

  async publicConfig() {
    const [city, flags] = await Promise.all([
      this.database.query(
        `SELECT c.slug, c.display_name, c.timezone, co.code AS country_code, co.default_currency, co.default_locale
         FROM cities c JOIN countries co ON co.code = c.country_code
         WHERE c.slug = $1 AND c.country_code = $2 AND c.is_active = true LIMIT 1`,
        [this.config.launchCitySlug, this.config.launchCountryCode]
      ),
      this.database.query<{ flag_key: string; is_enabled: boolean }>("SELECT flag_key, is_enabled FROM feature_flags ORDER BY flag_key")
    ]);
    const cityRow = city.rows[0];
    const features = Object.fromEntries(flags.rows.map((flag) => [flag.flag_key, flag.is_enabled]));
    return {
      countryCode: cityRow?.country_code ?? this.config.launchCountryCode,
      currency: cityRow?.default_currency ?? this.config.defaultCurrency,
      locale: cityRow?.default_locale ?? "en-ET",
      city: cityRow ? { slug: cityRow.slug as string, displayName: cityRow.display_name as string, timezone: cityRow.timezone as string } : { slug: this.config.launchCitySlug, displayName: this.config.launchCitySlug, timezone: "Africa/Addis_Ababa" },
      features,
      payments: {
        provider: this.config.paymentsProvider,
        methods: this.config.paymentsProvider === "disabled" ? ["cash"]
          : this.config.paymentsProvider === "sandbox" ? ["cash", "sandbox"]
            : this.config.paymentsProvider === "stripe" ? ["cash", "stripe"]
              : this.config.paymentsProvider === "telebirr" ? ["cash", "telebirr"]
                : ["cash", "chapa"]
      },
      tracking: { provider: this.config.mapsProvider, liveTrackingEnabled: features.live_tracking === true },
      support: { email: null, phone: null, inAppChat: true },
      quoteValiditySeconds: this.config.quoteValiditySeconds,
      taxRateBps: this.config.taxRateBps
    };
  }

  async featureFlags() {
    const result = await this.database.query("SELECT flag_key, description, is_enabled, updated_at FROM feature_flags ORDER BY flag_key");
    return {
      items: result.rows.map((row) => ({
        key: row.flag_key as string, description: row.description as string, enabled: row.is_enabled as boolean,
        updatedAt: (row.updated_at as Date).toISOString()
      }))
    };
  }

  async updateFeatureFlag(key: string, enabled: boolean, actorUserId: string) {
    const result = await this.database.query(
      "UPDATE feature_flags SET is_enabled = $2, updated_by = $3, updated_at = now() WHERE flag_key = $1",
      [key, enabled, actorUserId]
    );
    if (result.rowCount === 0) throw new NotFoundException("Feature flag not found.");
    return { key, enabled };
  }

  async updatePricing(input: Readonly<{ serviceCategorySlug: string | null; baseDeliveryFeeMinor: number; perKmFeeMinor: number; minimumDeliveryFeeMinor: number; maximumDeliveryFeeMinor: number; serviceFeeMinor: number; nightSurchargeMinor: number; commissionBps: number; currency: string }>) {
    const city = await this.database.query<{ id: string }>(
      "SELECT c.id FROM cities c WHERE c.slug = $1 AND c.country_code = $2 LIMIT 1",
      [this.config.launchCitySlug, this.config.launchCountryCode]
    );
    const cityId = city.rows[0]?.id;
    if (!cityId) throw new NotFoundException("Launch city not found.");
    await this.database.withTransaction(async (client) => {
      await client.query("UPDATE pricing_rules SET is_active = false, effective_to = now() WHERE city_id = $1 AND service_category_slug IS NOT DISTINCT FROM $2 AND is_active = true", [cityId, input.serviceCategorySlug]);
      await client.query(
        `INSERT INTO pricing_rules (city_id, service_category_slug, base_delivery_fee_minor, per_km_fee_minor, minimum_delivery_fee_minor, maximum_delivery_fee_minor, service_fee_minor, night_surcharge_minor, commission_bps, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [cityId, input.serviceCategorySlug, input.baseDeliveryFeeMinor, input.perKmFeeMinor, input.minimumDeliveryFeeMinor, input.maximumDeliveryFeeMinor, input.serviceFeeMinor, input.nightSurchargeMinor, input.commissionBps, input.currency]
      );
    });
    return { updated: true };
  }
}
