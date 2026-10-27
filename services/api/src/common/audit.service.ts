import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service.js";

export type AuditInput = Readonly<{
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}>;

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(input: AuditInput, client?: PoolClient): Promise<void> {
    const executor = client ?? this.database.getPool();
    await executor.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, request_id, ip_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.actorUserId, input.action, input.entityType, input.entityId, input.requestId, input.ipHash ?? null, JSON.stringify(input.metadata ?? {})]
    );
  }
}
