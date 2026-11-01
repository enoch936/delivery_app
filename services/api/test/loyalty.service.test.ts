import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";
import { LoyaltyService } from "../src/modules/loyalty/loyalty.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { LoyaltyPointTransactionType, LoyaltyRedemptionStatus, LoyaltyRewardRecord, ReferralStatus } from "../src/modules/loyalty/loyalty.types.js";

const CUSTOMER_ID = "3f8a0c2e-1b4d-4c6e-9f2a-7d5e8b1c3a09";
const MERCHANT_STAFF_ID = "4a1b2c3d-4e5f-46a7-8b8c-9d0e1f2a3b4c5";
const REWARD_ID = "55555555-5555-5555-5555-555555555555";

type FakeAccountRow = { user_id: string; points: number; created_at: Date; updated_at: Date };
type FakeRewardRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  points_cost: number;
  reward_value_minor: number;
  currency: string;
  stock: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};
type FakeReferralCodeRow = { code: string; owner_user_id: string; is_active: boolean; expires_at: Date | null };
type FakeReferralRow = {
  id: string;
  referrer_user_id: string;
  referee_user_id: string;
  code: string;
  status: ReferralStatus;
  created_at: Date;
  credited_at: Date | null;
};
type FakeTransactionRow = {
  id: string;
  user_id: string;
  points: number;
  type: LoyaltyPointTransactionType;
  source: string | null;
  reference: string | null;
  created_at: Date;
};

class MemoryLoyaltyDatabase {
  accounts = new Map<string, FakeAccountRow>();
  transactions: FakeTransactionRow[] = [];
  rewards: FakeRewardRow[] = [];
  redemptions: Array<Record<string, unknown>> = [];
  referralCodes = new Map<string, FakeReferralCodeRow>();
  referrals: FakeReferralRow[] = [];

  private sequence = 0;

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SELECT user_id, points, created_at, updated_at FROM loyalty_accounts")) {
      const row = this.accounts.get(values[0] as string);
      const rows = row ? [{ user_id: row.user_id, points: row.points, created_at: row.created_at, updated_at: row.updated_at }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("SELECT id, user_id, points, type, source, reference, created_at FROM loyalty_transactions")) {
      const limit = Number(values[1]);
      const rows = this.transactions
        .filter((transaction) => transaction.user_id === values[0])
        .slice(-limit)
        .reverse()
        .map((transaction) => ({ ...transaction }));
      return this.result<T>(rows);
    }
    if (sql.startsWith("SELECT user_id, points FROM loyalty_accounts WHERE user_id = $1 FOR UPDATE")) {
      const row = this.accounts.get(values[0] as string);
      const rows = row ? [{ user_id: row.user_id, points: row.points }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("UPDATE loyalty_accounts SET points = points - $2")) {
      const row = this.accounts.get(values[0] as string);
      if (row) row.points = Number(row.points) - Number(values[1]);
      const updated = this.accounts.get(values[0] as string);
      const rows = updated ? [{ user_id: updated.user_id, points: updated.points }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("INSERT INTO loyalty_transactions") && (sql.includes("'earn'") || sql.includes("'redeem'"))) {
      this.transactions.push({
        id: `txn-${++this.sequence}`,
        user_id: values[0] as string,
        points: Number(values[1]),
        type: sql.includes("'earn'") ? "earn" : "redeem",
        source: sql.includes("'order_delivery'") ? "order_delivery" : sql.includes("'reward_redemption'") ? "reward_redemption" : "reward",
        reference: (values[2] as string) ?? null,
        created_at: new Date()
      });
      return this.result<T>([], 1);
    }
    if (sql.includes("FROM loyalty_rewards WHERE is_active = true AND stock > 0")) {
      const rows = this.rewards
        .filter((reward) => reward.is_active && Number(reward.stock) > 0)
        .sort((left, right) => Number(left.points_cost) - Number(right.points_cost))
        .map((reward) => ({ ...reward }));
      return this.result<T>(rows);
    }
    if (sql.startsWith("SELECT id, code, title, description, points_cost, reward_value_minor, currency, stock, is_active, created_at, updated_at FROM loyalty_rewards WHERE id = $1 FOR UPDATE")) {
      const row = this.rewards.find((candidate) => candidate.id === values[0]);
      const rows = row ? [{ ...row }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("UPDATE loyalty_rewards SET stock = stock - 1")) {
      const reward = this.rewards.find((candidate) => candidate.id === values[0]);
      if (reward) reward.stock = Number(reward.stock) - 1;
      const rows = reward ? [{ ...reward }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("INSERT INTO loyalty_redemptions")) {
      const redemption = {
        id: `redeem-${++this.sequence}`,
        user_id: values[0] as string,
        reward_id: values[1] as string,
        points: Number(values[2]),
        status: "REDEEMED",
        created_at: new Date(),
        decided_at: new Date()
      };
      this.redemptions.push(redemption);
      const rows = [{ ...redemption }];
      return this.result<T>(rows);
    }
    if (sql.startsWith("SELECT code FROM referral_codes WHERE owner_user_id")) {
      const found = [...this.referralCodes.values()].find(
        (candidate) => candidate.owner_user_id === values[0] && candidate.is_active && (candidate.expires_at === null || candidate.expires_at.getTime() > Date.now())
      );
      const rows = found ? [{ code: found.code }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("INSERT INTO referral_codes")) {
      const row: FakeReferralCodeRow = {
        code: values[0] as string,
        owner_user_id: values[1] as string,
        is_active: true,
        expires_at: new Date(Date.now() + Number(values[2]) * 86_400_000)
      };
      this.referralCodes.set(row.code, row);
      return this.result<T>([], 1);
    }
    if (sql.startsWith("SELECT code, owner_user_id, is_active, expires_at FROM referral_codes WHERE code = $1")) {
      const row = this.referralCodes.get(values[0] as string);
      const rows = row ? [{ ...row }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("UPDATE referral_codes SET is_active = false")) {
      const existing = this.referralCodes.get(values[0] as string);
      if (existing) this.referralCodes.set(values[0] as string, { ...existing, is_active: false });
      return this.result<T>([]);
    }
    if (sql.startsWith("INSERT INTO referrals")) {
      const referral: FakeReferralRow = {
        id: `referral-${++this.sequence}`,
        referrer_user_id: values[0] as string,
        referee_user_id: values[1] as string,
        code: values[2] as string,
        status: "PENDING",
        created_at: new Date(),
        credited_at: null
      };
      this.referrals.push(referral);
      const rows = [{ ...referral }];
      return this.result<T>(rows);
    }
    if (sql.startsWith("UPDATE referrals SET status = 'CREDITED'")) {
      const referral = this.referrals.find((candidate) => candidate.id === values[0]);
      if (referral) {
        referral.status = "CREDITED";
        referral.credited_at = new Date();
      }
      const rows = referral ? [{ ...referral }] : [];
      return this.result<T>(rows);
    }
    if (sql.startsWith("INSERT INTO loyalty_accounts (user_id, points) VALUES ($1, $2)")) {
      const userId = values[0] as string;
      const existing = this.accounts.get(userId);
      const account: FakeAccountRow = {
        user_id: userId,
        points: Number(existing?.points ?? 0) + Number(values[1]),
        created_at: existing?.created_at ?? new Date(),
        updated_at: new Date()
      };
      this.accounts.set(userId, account);
      const rows = [account];
      return this.result<T>(rows);
    }
    if (sql.includes("'referral_credit'")) {
      this.transactions.push({
        id: `txn-${++this.sequence}`,
        user_id: values[0] as string,
        points: Number(values[1]),
        type: "referral_credit",
        source: (values[2] as string) ?? null,
        reference: (values[3] as string) ?? null,
        created_at: new Date()
      });
      return this.result<T>([]);
    }
    return this.result<T>([]);
  }

  async withTransaction<T>(work: (client: MemoryLoyaltyDatabase) => Promise<T>): Promise<T> {
    return work(this);
  }

  private result<T extends QueryResultRow>(rows: readonly unknown[], rowCount?: number): Promise<QueryResult<T>> {
    const result = {
      command: "SELECT",
      rowCount: rowCount ?? rows.length,
      oid: null,
      fields: [],
      rows
    } as unknown as QueryResult<T>;
    return Promise.resolve(result);
  }
}

function setup(options: Readonly<{ customerPoints?: number; rewardStock?: number; rewardActive?: boolean }> = {}): { service: LoyaltyService; database: MemoryLoyaltyDatabase } {
  const database = new MemoryLoyaltyDatabase();
  database.accounts.set(CUSTOMER_ID, { user_id: CUSTOMER_ID, points: options.customerPoints ?? 500, created_at: new Date(), updated_at: new Date() });
  database.accounts.set(MERCHANT_STAFF_ID, { user_id: MERCHANT_STAFF_ID, points: 10, created_at: new Date(), updated_at: new Date() });
  database.rewards.push({
    id: REWARD_ID,
    code: "RBEAUTY-5",
    title: "Free delivery credit",
    description: "Worth 500 ETB off delivery.",
    points_cost: 200,
    reward_value_minor: 500,
    currency: "ETB",
    stock: options.rewardStock ?? 1,
    is_active: options.rewardActive ?? true,
    created_at: new Date(),
    updated_at: new Date()
  });
  const service = new LoyaltyService(database as unknown as DatabaseService);
  return { service, database };
}

test("returns a standard loyalty tier with no transactions for a customer without deliveries", async () => {
  const { service } = setup({ customerPoints: 0 });
  const loyalty = await service.getLoyalty(CUSTOMER_ID);
  assert.equal(loyalty.points, 0);
  assert.equal(loyalty.tier, "standard");
  assert.deepEqual(loyalty.transactions, []);
});

test("lists only redeemable loyalty rewards with point costs and stock", async () => {
  const { service, database } = setup();
  database.rewards.push({
    ...database.rewards[0]!,
    id: "66666666-6666-6666-6666-666666666666",
    code: "RBEAUTY-10",
    points_cost: 100,
    stock: 0
  });
  const { items } = await service.listRewards();
  assert.equal(items.length, 1);
  assert.equal((items[0] as LoyaltyRewardRecord).code, "RBEAUTY-5");
  assert.equal((items[0] as LoyaltyRewardRecord).pointsCost, 200);
  assert.equal((items[0] as LoyaltyRewardRecord).stock, 1);
});

test("redeems a loyalty reward atomically and debits the customer balance", async () => {
  const { service, database } = setup();
  const result = await service.redeemReward(CUSTOMER_ID, { rewardId: REWARD_ID });
  assert.equal(result.balance, 300);
  assert.equal(result.redemption.status, "REDEEMED" satisfies LoyaltyRedemptionStatus);
  assert.equal(result.redemption.points, 200);
  assert.equal(result.redemption.rewardCode, "RBEAUTY-5");
  assert.equal(database.rewards[0]!.stock, 0);
  assert.equal(database.transactions.filter((transaction) => transaction.source === "reward").length, 1);
});

test("rejects loyalty reward redemption when the customer has insufficient points", async () => {
  const { service, database } = setup({ customerPoints: 50 });
  await assert.rejects(() => service.redeemReward(CUSTOMER_ID, { rewardId: REWARD_ID }), ConflictException);
  assert.equal(database.redemptions.length, 0);
});

test("rejects loyalty reward redemption for an unknown reward", async () => {
  const { service } = setup();
  await assert.rejects(() => service.redeemReward("99999999-9999-9999-9999-999999999999", { rewardId: REWARD_ID }), NotFoundException);
});

test("rejects loyalty reward redemption when the reward is out of stock", async () => {
  const { service, database } = setup({ rewardStock: 0 });
  await assert.rejects(() => service.redeemReward(CUSTOMER_ID, { rewardId: REWARD_ID }), ConflictException);
});

test("issues a referral code that expires after the configured window", async () => {
  const { service, database } = setup();
  const { code } = await service.issueReferralCode(MERCHANT_STAFF_ID);
  const stored = [...database.referralCodes.values()].find((entry) => entry.owner_user_id === MERCHANT_STAFF_ID);
  assert.ok(stored, "the referral code should be stored");
  assert.equal(code, stored!.code);
  assert.equal(stored!.is_active, true);
  assert.ok(stored!.expires_at !== null && stored!.expires_at.getTime() > Date.now());
});

test("credits the referrer when a friend redeems their referral code", async () => {
  const { service, database } = setup();
  const { code } = await service.issueReferralCode(MERCHANT_STAFF_ID);
  const result = await service.redeemReferral(CUSTOMER_ID, code);
  assert.equal(result.credited, true);
  assert.equal(result.quote.rewardPoints, 25);
  const referral = database.referrals[0]!;
  assert.equal(referral.status, "CREDITED");
  assert.equal(referral.referrer_user_id, MERCHANT_STAFF_ID);
  assert.equal(referral.referee_user_id, CUSTOMER_ID);
  assert.ok((database.accounts.get(MERCHANT_STAFF_ID)!.points ?? 0) >= 35);
});

test("refuses to redeem an expired referral code and deactivates it", async () => {
  const { service, database } = setup();
  const { code } = await service.issueReferralCode(MERCHANT_STAFF_ID);
  const stored = [...database.referralCodes.values()].find((entry) => entry.owner_user_id === MERCHANT_STAFF_ID)!;
  stored.expires_at = new Date(Date.now() - 60 * 60 * 1000);
  await assert.rejects(() => service.redeemReferral(CUSTOMER_ID, code), NotFoundException);
  const after = [...database.referralCodes.values()].find((entry) => entry.owner_user_id === MERCHANT_STAFF_ID)!;
  assert.equal(after.is_active, false);
});
