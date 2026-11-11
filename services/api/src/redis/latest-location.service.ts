import { Injectable } from "@nestjs/common";
import { readRuntimeConfig } from "../config/runtime-config.js";
import { RedisService } from "./redis.service.js";

export type LatestCourierLocation = Readonly<{
  courierUserId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  speedMps: number | null;
  recordedAt: string;
  activeOrderId: string | null;
}>;

@Injectable()
export class LatestLocationService {
  constructor(private readonly redis: RedisService) {}

  async record(location: LatestCourierLocation): Promise<void> {
    const ttl = readRuntimeConfig().trackingLocationTtlSeconds;
    await this.redis.setJson(key(location.courierUserId), location, ttl);
    await this.redis.publish("tracking:courier-location", location);
  }

  async get(courierUserId: string): Promise<LatestCourierLocation | null> {
    return this.redis.getJson<LatestCourierLocation>(key(courierUserId));
  }

  async getMany(courierUserIds: readonly string[]): Promise<Map<string, LatestCourierLocation>> {
    const unique = [...new Set(courierUserIds)];
    const entries = await Promise.all(unique.map(async (id) => [id, await this.get(id)] as const));
    const result = new Map<string, LatestCourierLocation>();
    for (const [id, location] of entries) {
      if (location) result.set(id, location);
    }
    return result;
  }
}

function key(courierUserId: string): string {
  return `tracking:courier:${courierUserId}:latest`;
}
