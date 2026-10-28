import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditService } from "../../common/audit.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { LedgerService } from "../ledger/ledger.service.js";

@Injectable()
export class CodService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService
  ) {}

  async ensureForOrder(orderId: string) {
    const order = await this.database.query("SELECT id, payment_method, total_minor, currency, courier_user_id FROM orders WHERE id = $1", [orderId]);
    const row = order.rows[0];
    if (!row) throw new NotFoundException("Order not found.");
    if (row.payment_method !== "cash") throw new BadRequestException("COD collection only applies to cash orders.");
    await this.database.query(
      `INSERT INTO cod_collections (order_id, amount_minor, currency, courier_user_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`,
      [orderId, row.total_minor, row.currency, row.courier_user_id]
    );
    return this.get(orderId);
  }

  async markCollected(orderId: string, actorUserId: string, requestId: string | null) {
    const result = await this.database.withTransaction(async (client) => {
      const cod = await client.query("SELECT * FROM cod_collections WHERE order_id = $1 FOR UPDATE", [orderId]);
      const row = cod.rows[0];
      if (!row) throw new NotFoundException("COD collection not found.");
      if (row.status !== "PENDING") throw new ConflictException("Only pending COD collections can be collected.");
      await client.query("UPDATE cod_collections SET status = 'COLLECTED', collected_at = now(), updated_at = now() WHERE id = $1", [row.id]);
      await this.audit.record({ actorUserId, action: "cod.collected", entityType: "cod_collection", entityId: row.id, requestId, metadata: { orderId } }, client);
      return row.id;
    });
    return this.get(orderId);
  }

  async remit(input: Readonly<{ orderId: string; remittanceReference: string; actorUserId: string; requestId: string | null }>) {
    return this.database.withTransaction(async (client) => {
      const cod = await client.query("SELECT * FROM cod_collections WHERE order_id = $1 FOR UPDATE", [input.orderId]);
      const row = cod.rows[0];
      if (!row) throw new NotFoundException("COD collection not found.");
      if (row.status !== "COLLECTED") throw new ConflictException("Only collected COD must be remitted.");
      await client.query("UPDATE cod_collections SET status = 'REMITTED', remitted_at = now(), remitted_by = $2, remittance_reference = $3, updated_at = now() WHERE id = $1", [row.id, input.actorUserId, input.remittanceReference]);
      await this.ledger.post({
        referenceType: "cod_remittance", referenceId: row.id, description: `COD remittance for order ${input.orderId}`,
        lines: [
          { accountCode: "cash_on_hand", side: "debit", amountMinor: Number(row.amount_minor), currency: row.currency },
          { accountCode: "payment_clearing", side: "credit", amountMinor: Number(row.amount_minor), currency: row.currency }
        ]
      }, client);
      await this.audit.record({ actorUserId: input.actorUserId, action: "cod.remitted", entityType: "cod_collection", entityId: row.id, requestId: input.requestId, metadata: { orderId: input.orderId, remittanceReference: input.remittanceReference } }, client);
      return this.get(input.orderId);
    });
  }

  async reconcile(orderId: string, actorUserId: string, requestId: string | null) {
    return this.database.withTransaction(async (client) => {
      const cod = await client.query("SELECT * FROM cod_collections WHERE order_id = $1 FOR UPDATE", [orderId]);
      const row = cod.rows[0];
      if (!row) throw new NotFoundException("COD collection not found.");
      if (row.status !== "REMITTED") throw new ConflictException("Only remitted COD can be reconciled.");
      await client.query("UPDATE cod_collections SET status = 'RECONCILED', updated_at = now() WHERE id = $1", [row.id]);
      await this.audit.record({ actorUserId, action: "cod.reconciled", entityType: "cod_collection", entityId: row.id, requestId, metadata: { orderId } }, client);
      return this.get(orderId);
    });
  }

  async list(status: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT c.*, o.order_number, u.phone_e164 AS courier_phone
       FROM cod_collections c JOIN orders o ON o.id = c.order_id LEFT JOIN users u ON u.id = c.courier_user_id
       WHERE ($1::text IS NULL OR c.status = $1)
       ORDER BY c.created_at ASC LIMIT $2 OFFSET $3`,
      [status ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id, orderId: row.order_id, orderNumber: row.order_number, courierUserId: row.courier_user_id,
        courierPhone: row.courier_phone, amountMinor: Number(row.amount_minor), currency: row.currency, status: row.status,
        collectedAt: row.collected_at?.toISOString() ?? null, remittedAt: row.remitted_at?.toISOString() ?? null,
        remittanceReference: row.remittance_reference, createdAt: row.created_at.toISOString()
      }))
    };
  }

  async get(orderId: string) {
    const result = await this.database.query(
      `SELECT c.*, o.order_number
       FROM cod_collections c JOIN orders o ON o.id = c.order_id WHERE c.order_id = $1`,
      [orderId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("COD collection not found.");
    return {
      id: row.id, orderId: row.order_id, orderNumber: row.order_number, courierUserId: row.courier_user_id,
      amountMinor: Number(row.amount_minor), currency: row.currency, status: row.status,
      collectedAt: row.collected_at?.toISOString() ?? null, remittedAt: row.remitted_at?.toISOString() ?? null,
      remittedBy: row.remitted_by, remittanceReference: row.remittance_reference, notes: row.notes
    };
  }
}
