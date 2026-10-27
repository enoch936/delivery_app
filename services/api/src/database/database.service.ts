import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { readRuntimeConfig } from "../config/runtime-config.js";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;

  getPool(): Pool {
    if (this.pool) return this.pool;
    const databaseUrl = readRuntimeConfig().databaseUrl;
    if (!databaseUrl) throw new ServiceUnavailableException("Persistent storage is not configured.");
    this.pool = new Pool({
      connectionString: databaseUrl,
      application_name: "delivery_app_api",
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000
    });
    this.pool.on("error", (error) => this.logger.error(`Idle database connection failed: ${error.message}`));
    return this.pool;
  }

  query<T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    return this.getPool().query<T>(text, [...values]);
  }

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async isReady(): Promise<boolean> {
    try {
      await this.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
