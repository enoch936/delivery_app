import { Injectable, Logger } from "@nestjs/common";
import { readRuntimeConfig } from "../../config/runtime-config.js";

export type GeocodeResult = Readonly<{
  latitude: number;
  longitude: number;
  formattedAddress: string;
  confidence: number;
  source: string;
}>;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  async forward(query: Readonly<{ q: string; countryCode?: string; limit?: number }>): Promise<{ results: GeocodeResult[] }> {
    const q = query.q.trim();
    if (!q) return { results: [] };
    const config = readRuntimeConfig();
    if (config.geocodingProvider === "nominatim") {
      try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("q", q);
        if (query.countryCode) url.searchParams.set("countrycodes", query.countryCode.toLowerCase());
        url.searchParams.set("limit", String(query.limit ?? 5));
        const res = await fetch(url, { headers: { "User-Agent": "delivery-app/1.0" } });
        if (res.ok) {
          const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; importance?: number }>;
          return {
            results: data.map((d) => ({
              latitude: Number(d.lat),
              longitude: Number(d.lon),
              formattedAddress: d.display_name,
              confidence: typeof d.importance === "number" ? Math.min(1, Math.max(0, d.importance)) : 0.5,
              source: "nominatim"
            }))
          };
        }
      } catch (err) {
        this.logger.warn(`Nominatim geocoding failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const stub: GeocodeResult[] = [
      {
        latitude: 9.0192,
        longitude: 38.7525,
        formattedAddress: `${q}, Addis Ababa, Ethiopia`,
        confidence: 0.4,
        source: "stub"
      }
    ];
    return { results: stub.slice(0, query.limit ?? 5) };
  }

  async reverse(input: Readonly<{ latitude: number; longitude: number }>): Promise<{ result: GeocodeResult | null }> {
    const config = readRuntimeConfig();
    if (config.geocodingProvider === "nominatim") {
      try {
        const url = new URL("https://nominatim.openstreetmap.org/reverse");
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("lat", String(input.latitude));
        url.searchParams.set("lon", String(input.longitude));
        const res = await fetch(url, { headers: { "User-Agent": "delivery-app/1.0" } });
        if (res.ok) {
          const data = (await res.json()) as { lat?: string; lon?: string; display_name?: string };
          return {
            result: {
              latitude: Number(data.lat ?? input.latitude),
              longitude: Number(data.lon ?? input.longitude),
              formattedAddress: data.display_name ?? `${input.latitude}, ${input.longitude}`,
              confidence: 0.5,
              source: "nominatim"
            }
          };
        }
      } catch (err) {
        this.logger.warn(`Nominatim reverse geocoding failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return {
      result: {
        latitude: input.latitude,
        longitude: input.longitude,
        formattedAddress: `Near ${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}, Addis Ababa, Ethiopia`,
        confidence: 0.3,
        source: "stub"
      }
    };
  }
}
