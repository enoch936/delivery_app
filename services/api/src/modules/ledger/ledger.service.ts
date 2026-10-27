import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service.js";

export type LedgerSide = "debit" | "credit";
export type LedgerLine = Readonly<{ accountCode: string; side: LedgerSide; amountMinor: number; currency: string }>;

@Injectable()
export class LedgerService {
  constructor(private readonly database: DatabaseService) {}

  async post(input: Readonly<{ referenceType: string; referenceId: string; description: string; lines: readonly LedgerLine[] }>, client?: PoolClient): Promise<{ transactionId: string; replayed: boolean }> {
    const lines = input.lines.filter((line) => line.amountMinor !== 0);
    if (lines.length === 0) throw new Error("A ledger transaction requires at least one non-zero line.");
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      if (!Number.isInteger(line.amountMinor) || line.amountMinor <= 0) throw new Error("Ledger line amounts must be positive integer minor units.");
      if (!/^[A-Z]{3}$/.test(line.currency)) throw new Error("Ledger line currency is invalid.");
      if (line.side === "debit") debit += line.amountMinor; else credit += line.amountMinor;
    }
    if (debit !== credit) throw new Error(`Ledger transaction is not balanced (debit ${debit}, credit ${credit}).`);
    if (lines.some((line) => line.currency !== lines[0]?.currency)) throw new Error("Ledger lines must share a currency.");

    const execute = async (executor: PoolClient) => {
      const existing = await executor.query<{ id: string }>(
        "SELECT id FROM ledger_transactions WHERE reference_type = $1 AND reference_id = $2 FOR UPDATE",
        [input.referenceType, input.referenceId]
      );
      if (existing.rows[0]) return { transactionId: existing.rows[0].id, replayed: true };
      const transaction = await executor.query<{ id: string }>(
        "INSERT INTO ledger_transactions (reference_type, reference_id, description) VALUES ($1, $2, $3) RETURNING id",
        [input.referenceType, input.referenceId, input.description]
      );
      const transactionId = transaction.rows[0]?.id;
      if (!transactionId) throw new Error("Ledger transaction creation failed.");
      for (const line of lines) {
        const account = await executor.query<{ id: string }>("SELECT id FROM ledger_accounts WHERE code = $1 AND is_active = true", [line.accountCode]);
        const accountId = account.rows[0]?.id;
        if (!accountId) throw new Error(`Ledger account ${line.accountCode} does not exist.`);
        await executor.query(
          "INSERT INTO ledger_entries (transaction_id, account_id, side, amount_minor, currency) VALUES ($1, $2, $3, $4, $5)",
          [transactionId, accountId, line.side, line.amountMinor, line.currency]
        );
      }
      return { transactionId, replayed: false };
    };
    if (client) return execute(client);
    return this.database.withTransaction(execute);
  }

  async balances() {
    const result = await this.database.query<{ code: string; display_name: string; account_type: string; currency: string; debit: string; credit: string }>(
      `SELECT a.code, a.display_name, a.account_type, a.currency,
              COALESCE(sum(e.amount_minor) FILTER (WHERE e.side = 'debit'), 0)::text AS debit,
              COALESCE(sum(e.amount_minor) FILTER (WHERE e.side = 'credit'), 0)::text AS credit
       FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
       GROUP BY a.id ORDER BY a.code`
    );
    return result.rows.map((row) => ({
      code: row.code, displayName: row.display_name, accountType: row.account_type, currency: row.currency,
      debitMinor: Number(row.debit), creditMinor: Number(row.credit), netMinor: Number(row.debit) - Number(row.credit)
    }));
  }
}
