import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { AuditService } from "../../common/audit.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { LedgerService } from "../ledger/ledger.service.js";

export type PayoutAccountInput = Readonly<{
  ownerType: "merchant" | "courier" | "business";
  ownerId: string;
  provider: string;
  bankSlug?: string | null;
  accountName: string;
  accountNumberLast4?: string | null;
  providerAccountReference?: string | null;
  currency: string;
  isDefault?: boolean;
}>;

@Injectable()
export class PayoutsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService
  ) {}

  async createAccount(input: PayoutAccountInput & { createdBy: string }) {
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException("Currency must be a three-letter ISO code.");
    if (!input.providerAccountReference && !(input.bankSlug && input.accountNumberLast4)) {
      throw new BadRequestException("Provide either a provider account reference or bank details.");
    }
    return this.database.withTransaction(async (client) => {
      if (input.isDefault) {
        await client.query(
          "UPDATE payout_accounts SET is_default = false WHERE owner_type = $1 AND owner_id = $2 AND currency = $3",
          [input.ownerType, input.ownerId, input.currency]
        );
      }
      const result = await client.query(
        `INSERT INTO payout_accounts (owner_type, owner_id, provider, provider_account_reference, bank_slug, account_name, account_number_last4, currency, status, is_default, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10) RETURNING *`,
        [
          input.ownerType, input.ownerId, input.provider, input.providerAccountReference ?? null,
          input.bankSlug ?? null, input.accountName, input.accountNumberLast4 ?? null,
          input.currency, input.isDefault ?? false, input.createdBy
        ]
      );
      return this.mapAccount(result.rows[0]);
    });
  }

  async listAccounts(ownerType: string, ownerId: string) {
    const result = await this.database.query(
      "SELECT * FROM payout_accounts WHERE owner_type = $1 AND owner_id = $2 ORDER BY is_default DESC, created_at DESC",
      [ownerType, ownerId]
    );
    return { items: result.rows.map((row) => this.mapAccount(row)) };
  }

  async verifyAccount(accountId: string, actorUserId: string, requestId: string | null) {
    const result = await this.database.query("UPDATE payout_accounts SET status = 'VERIFIED', verified_by = $2, verified_at = now(), updated_at = now() WHERE id = $1 AND status = 'PENDING' RETURNING *", [accountId, actorUserId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Payout account not found or already verified.");
    await this.audit.record({ actorUserId, action: "payout_account.verified", entityType: "payout_account", entityId: accountId, requestId });
    return this.mapAccount(row);
  }

  async createBatch(input: Readonly<{
    provider: string; currency: string; items: Array<{ settlementKind: "merchant" | "courier"; settlementId: string; payoutAccountId: string }>;
    actorUserId: string; requestId: string | null;
  }>) {
    if (input.items.length === 0) throw new BadRequestException("A payout batch requires at least one item.");
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new BadRequestException("Currency must be a three-letter ISO code.");
    const idempotencyKey = `batch-${randomUUID()}`;
    return this.database.withTransaction(async (client) => {
      let totalMinor = 0;
      const validated: Array<{ settlementKind: string; settlementId: string; payoutAccountId: string; amountMinor: number }> = [];
      for (const item of input.items) {
        const settlement = item.settlementKind === "merchant"
          ? await client.query("SELECT id, status, net_payable_minor, currency FROM merchant_settlements WHERE id = $1 FOR UPDATE", [item.settlementId])
          : await client.query("SELECT id, status, net_payable_minor, currency FROM courier_payouts WHERE id = $1 FOR UPDATE", [item.settlementId]);
        const row = settlement.rows[0];
        if (!row) throw new NotFoundException(`Settlement ${item.settlementId} not found.`);
        if (row.status !== "APPROVED") throw new ConflictException(`Settlement ${item.settlementId} must be approved before batching.`);
        if (row.currency !== input.currency) throw new BadRequestException("All settlements in a batch must share the same currency.");
        const account = await client.query("SELECT id, status FROM payout_accounts WHERE id = $1", [item.payoutAccountId]);
        if (!account.rows[0] || account.rows[0].status !== "VERIFIED") throw new BadRequestException("Payout items must use verified payout accounts.");
        const existing = await client.query("SELECT id FROM payout_batch_items WHERE settlement_kind = $1 AND settlement_id = $2", [item.settlementKind, item.settlementId]);
        if (existing.rows[0]) throw new ConflictException(`Settlement ${item.settlementId} is already in a payout batch.`);
        const amountMinor = Number(row.net_payable_minor);
        totalMinor += amountMinor;
        validated.push({ settlementKind: item.settlementKind, settlementId: item.settlementId, payoutAccountId: item.payoutAccountId, amountMinor });
      }
      const batch = await client.query(
        `INSERT INTO payout_batches (provider, idempotency_key, currency, total_minor, item_count, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'PENDING',$6) RETURNING *`,
        [input.provider, idempotencyKey, input.currency, totalMinor, validated.length, input.actorUserId]
      );
      const batchId = batch.rows[0].id;
      for (const item of validated) {
        await client.query(
          "INSERT INTO payout_batch_items (batch_id, settlement_kind, settlement_id, payout_account_id, amount_minor, currency) VALUES ($1,$2,$3,$4,$5,$6)",
          [batchId, item.settlementKind, item.settlementId, item.payoutAccountId, item.amountMinor, input.currency]
        );
      }
      await this.audit.record({ actorUserId: input.actorUserId, action: "payout_batch.created", entityType: "payout_batch", entityId: batchId, requestId: input.requestId, metadata: { itemCount: validated.length, totalMinor, currency: input.currency } }, client);
      return this.getBatch(batchId);
    });
  }

  async submitBatch(batchId: string, actorUserId: string, requestId: string | null) {
    return this.database.withTransaction(async (client) => {
      const batch = await client.query("SELECT * FROM payout_batches WHERE id = $1 FOR UPDATE", [batchId]);
      const row = batch.rows[0];
      if (!row) throw new NotFoundException("Payout batch not found.");
      if (row.status !== "PENDING") throw new ConflictException("Only pending batches can be submitted.");
      await client.query("UPDATE payout_batches SET status = 'PROCESSING', submitted_at = now(), updated_at = now() WHERE id = $1", [batchId]);
      await client.query("UPDATE payout_batch_items SET status = 'PROCESSING', updated_at = now() WHERE batch_id = $1", [batchId]);
      await this.audit.record({ actorUserId, action: "payout_batch.submitted", entityType: "payout_batch", entityId: batchId, requestId }, client);
      return this.getBatch(batchId);
    });
  }

  async completeBatchItem(input: Readonly<{ batchId: string; itemId: string; status: "succeeded" | "failed"; providerReference?: string; failureReason?: string; actorUserId: string; requestId: string | null }>) {
    return this.database.withTransaction(async (client) => {
      const item = await client.query("SELECT * FROM payout_batch_items WHERE id = $1 AND batch_id = $2 FOR UPDATE", [input.itemId, input.batchId]);
      const itemRow = item.rows[0];
      if (!itemRow) throw new NotFoundException("Payout batch item not found.");
      if (itemRow.status !== "PROCESSING") throw new ConflictException("Only processing items can be completed.");
      await client.query(
        "UPDATE payout_batch_items SET status = $2, provider_reference = $3, failure_reason = $4, updated_at = now() WHERE id = $1",
        [input.itemId, input.status === "succeeded" ? "SUCCEEDED" : "FAILED", input.providerReference ?? null, input.failureReason ?? null]
      );
      if (input.status === "succeeded") {
        if (itemRow.settlement_kind === "merchant") {
          const settlement = await client.query("SELECT * FROM merchant_settlements WHERE id = $1 FOR UPDATE", [itemRow.settlement_id]);
          const s = settlement.rows[0];
          if (s && s.status === "APPROVED") {
            const net = Number(s.net_payable_minor);
            if (net > 0) {
              await this.ledger.post({
                referenceType: "merchant_settlement", referenceId: s.id, description: `Merchant settlement ${s.id}`,
                lines: [
                  { accountCode: "merchant_payable", side: "debit", amountMinor: net, currency: s.currency },
                  { accountCode: "platform_bank", side: "credit", amountMinor: net, currency: s.currency }
                ]
              }, client);
            }
            await client.query(
              "UPDATE merchant_settlements SET status = 'PAID', paid_by = $2, paid_at = now(), payment_reference = $3, updated_at = now() WHERE id = $1",
              [s.id, input.actorUserId, input.providerReference ?? null]
            );
          }
        } else {
          const payout = await client.query("SELECT * FROM courier_payouts WHERE id = $1 FOR UPDATE", [itemRow.settlement_id]);
          const p = payout.rows[0];
          if (p && p.status === "APPROVED") {
            const net = Number(p.net_payable_minor);
            if (net > 0) {
              const earnings = Number(p.gross_earnings_minor) - Number(p.deductions_minor);
              const tips = Number(p.tips_minor);
              await this.ledger.post({
                referenceType: "courier_payout", referenceId: p.id, description: `Courier payout ${p.id}`,
                lines: [
                  { accountCode: "courier_payable", side: "debit", amountMinor: earnings, currency: p.currency },
                  { accountCode: "tips_payable", side: "debit", amountMinor: tips, currency: p.currency },
                  { accountCode: "platform_bank", side: "credit", amountMinor: net, currency: p.currency }
                ]
              }, client);
            }
            await client.query(
              "UPDATE courier_payouts SET status = 'PAID', paid_by = $2, paid_at = now(), payment_reference = $3, updated_at = now() WHERE id = $1",
              [p.id, input.actorUserId, input.providerReference ?? null]
            );
          }
        }
      }
      await this.updateBatchStatus(client, input.batchId);
      await this.audit.record({ actorUserId: input.actorUserId, action: `payout_batch_item.${input.status}`, entityType: "payout_batch_item", entityId: input.itemId, requestId: input.requestId }, client);
      return this.getBatch(input.batchId);
    });
  }

  async listBatches(limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT b.*, count(i.id)::int AS item_count
       FROM payout_batches b LEFT JOIN payout_batch_items i ON i.batch_id = b.id
       GROUP BY b.id ORDER BY b.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return { items: result.rows.map((row) => this.mapBatch(row)) };
  }

  async getBatch(batchId: string) {
    return this.getBatchInternal(batchId);
  }

  private async getBatchInternal(batchId: string) {
    const batch = await this.database.query("SELECT * FROM payout_batches WHERE id = $1", [batchId]);
    const row = batch.rows[0];
    if (!row) throw new NotFoundException("Payout batch not found.");
    const items = await this.database.query("SELECT * FROM payout_batch_items WHERE batch_id = $1 ORDER BY created_at ASC", [batchId]);
    return {
      ...this.mapBatch({ ...row, item_count: items.rowCount ?? 0 }),
      items: items.rows.map((item) => ({
        id: item.id, settlementKind: item.settlement_kind, settlementId: item.settlement_id,
        payoutAccountId: item.payout_account_id, amountMinor: Number(item.amount_minor), currency: item.currency,
        status: item.status, providerReference: item.provider_reference, failureReason: item.failure_reason
      }))
    };
  }

  private async updateBatchStatus(client: PoolClient, batchId: string) {
    const items = await client.query("SELECT status FROM payout_batch_items WHERE batch_id = $1", [batchId]);
    const statuses = items.rows.map((r) => r.status);
    if (statuses.every((s) => s === "SUCCEEDED")) {
      await client.query("UPDATE payout_batches SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1", [batchId]);
    } else if (statuses.some((s) => s === "FAILED") && statuses.every((s) => s !== "PROCESSING" && s !== "PENDING")) {
      await client.query("UPDATE payout_batches SET status = 'PARTIALLY_FAILED', completed_at = now(), updated_at = now() WHERE id = $1", [batchId]);
    } else if (statuses.some((s) => s === "FAILED")) {
      await client.query("UPDATE payout_batches SET status = 'PARTIALLY_FAILED', updated_at = now() WHERE id = $1", [batchId]);
    }
  }

  private mapAccount(row: any) {
    return {
      id: row.id, ownerType: row.owner_type, ownerId: row.owner_id, provider: row.provider,
      providerAccountReference: row.provider_account_reference, bankSlug: row.bank_slug,
      accountName: row.account_name, accountNumberLast4: row.account_number_last4,
      currency: row.currency, status: row.status, isDefault: row.is_default,
      verifiedAt: row.verified_at?.toISOString() ?? null, createdAt: row.created_at.toISOString()
    };
  }

  private mapBatch(row: any) {
    return {
      id: row.id, provider: row.provider, providerReference: row.provider_reference,
      currency: row.currency, totalMinor: Number(row.total_minor), itemCount: row.item_count,
      status: row.status, failureReason: row.failure_reason, submittedAt: row.submitted_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null, createdAt: row.created_at.toISOString()
    };
  }
}
