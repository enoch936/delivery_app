import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { RedisService } from "../../redis/redis.service.js";

export type GeocodeResult = Readonly<{
  latitude: number;
  longitude: number;
  formattedAddress: string;
  confidence: number;
  source: string;
  category: string | null;
  type: string | null;
  boundingBox: readonly [number, number, number, number] | null;
}>;

type NominatimRow = {
  lat: string;
  lon: string;
  display_name?: string;
  importance?: number;
  category?: string;
  class?: string;
  type?: string;
  boundingbox?: [string, string, string, string];
};

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(private readonly redis: RedisService) {}

  async forward(query: Readonly<{ q: string; countryCode?: string; limit?: number }>): Promise<{ results: GeocodeResult[]; provider: string; cached: boolean }> {
    const q = query.q.trim();
    if (!q) return { results: [], provider: "none", cached: false };
    const config = readRuntimeConfig();
    if (config.geocodingProvider !== "nominatim") return { results: [], provider: "disabled", cached: false };

    const cacheKey = `geocode:forward:${hash(JSON.stringify({ q: q.toLowerCase(), c: query.countryCode ?? config.launchCountryCode, l: query.limit ?? 5 }))}`;
    const cached = await this.redis.getJson<GeocodeResult[]>(cacheKey);
    if (cached) return { results: cached, provider: "nominatim", cached: true };

    const url = new URL("/search", `${config.nominatimUrl.replace(/\/$/, "")}/`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", q);
    url.searchParams.set("countrycodes", (query.countryCode ?? config.launchCountryCode).toLowerCase());
    url.searchParams.set("limit", String(query.limit ?? 5));
    url.searchParams.set("addressdetails", "1");
    const rows = (await this.request<NominatimRow[]>(url)) ?? [];
    const results = rows
      .map((row) => toResult(row, "nominatim"))
      .filter((row): row is GeocodeResult => row !== null);
    await this.redis.setJson(cacheKey, results, config.geocodeCacheTtlSeconds);
    return { results, provider: "nominatim", cached: false };
  }

  async reverse(input: Readonly<{ latitude: number; longitude: number }>): Promise<{ result: GeocodeResult | null; provider: string; cached: boolean }> {
    const config = readRuntimeConfig();
    if (config.geocodingProvider !== "nominatim") return { result: null, provider: "disabled", cached: false };

    const cacheKey = `geocode:reverse:${input.latitude.toFixed(5)}:${input.longitude.toFixed(5)}`;
    const cached = await this.redis.getJson<GeocodeResult>(cacheKey);
    if (cached) return { result: cached, provider: "nominatim", cached: true };

    const url = new URL("/reverse", `${config.nominatimUrl.replace(/\/$/, "")}/`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(input.latitude));
    url.searchParams.set("lon", String(input.longitude));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const row = await this.request<NominatimRow & { error?: string }>(url);
    if (!row || row.error) return { result: null, provider: "nominatim", cached: false };
    const result = toResult(row, "nominatim");
    if (result) await this.redis.setJson(cacheKey, result, config.geocodeCacheTtlSeconds);
    return { result, provider: "nominatim", cached: false };
  }

  private async request<T>(url: URL): Promise<T | null> {
    const config = readRuntimeConfig();
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": config.nominatimUserAgent,
          Accept: "application/json",
          "Accept-Language": "en,am"
        },
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) {
        this.logger.warn(`Nominatim returned ${response.status} for ${url.pathname}.`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(`Nominatim request failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

function toResult(row: NominatimRow, source: string): GeocodeResult | null {
  const latitude = Number(row.lat);
  const longitude = Number(row.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const boundingBox = row.boundingbox?.map(Number);
  const validBox = boundingBox && boundingBox.length === 4 && boundingBox.every(Number.isFinite)
    ? (boundingBox as [number, number, number, number])
    : null;
  return {
    latitude,
    longitude,
    formattedAddress: row.display_name ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    confidence: typeof row.importance === "number" ? Math.min(1, Math.max(0, row.importance)) : 0,
    source,
    category: row.category ?? row.class ?? null,
    type: row.type ?? null,
    boundingBox: validBox
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
