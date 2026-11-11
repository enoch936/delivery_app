import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { readRuntimeConfig } from "../config/runtime-config.js";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType | null> | null = null;
  private warned = false;

  get configured(): boolean {
    return Boolean(readRuntimeConfig().redisUrl);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      const value = await client.get(key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch (error) {
      this.warnOnce(`Redis read failed: ${messageOf(error)}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.set(key, JSON.stringify(value), { EX: Math.max(1, Math.round(ttlSeconds)) });
    } catch (error) {
      this.warnOnce(`Redis write failed: ${messageOf(error)}`);
    }
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.publish(channel, JSON.stringify(payload));
    } catch (error) {
      this.warnOnce(`Redis publish failed: ${messageOf(error)}`);
    }
  }

  private getClient(): Promise<RedisClientType | null> {
    const url = readRuntimeConfig().redisUrl;
    if (!url) return Promise.resolve(null);
    if (this.client?.isOpen) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.connecting = this.connect(url).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(url: string): Promise<RedisClientType | null> {
    try {
      const client = createClient({
        url,
        socket: {
          connectTimeout: 2_000,
          reconnectStrategy: (retries) => (retries > 10 ? false : Math.min(250 * retries, 2_000))
        }
      });
      client.on("error", (error) => this.warnOnce(`Redis connection error: ${messageOf(error)}`));
      await client.connect();
      this.client = client as RedisClientType;
      return this.client;
    } catch (error) {
      this.warnOnce(`Redis is unavailable; falling back to PostgreSQL: ${messageOf(error)}`);
      return null;
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(message);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit().catch(() => undefined);
    }
    this.client = null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
