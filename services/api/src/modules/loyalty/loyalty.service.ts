import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import type { LoyaltyAccountRecord, LoyaltyPointTransactionType, LoyaltyRedemptionRecord, LoyaltyRedemptionStatus, LoyaltyRewardRecord, LoyaltyTier, LoyaltyTransactionRecord, ReferralRecord, ReferralQuoteRecord } from "./loyalty.types.js";

const REFERRAL_REWARD_POINTS = 25;
const REFERRAL_CODE_TTL_DAYS = 30;
const TRANSACTION_LIMIT = 50;

type LoyaltyRewardRow = {
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

type LoyaltyRedemptionRow = {
  id: string;
  user_id: string;
  reward_id: string;
  points: number;
  status: LoyaltyRedemptionStatus;
  created_at: Date;
  decided_at: Date | null;
};

@Injectable()
export class LoyaltyService {
  constructor(private readonly database: DatabaseService) {}

  async getLoyalty(userId: string): Promise<LoyaltyAccountRecord> {
    const account = await this.database.query<{ user_id: string; points: number; created_at: Date; updated_at: Date }>(
      "SELECT user_id, points, created_at, updated_at FROM loyalty_accounts WHERE user_id = $1",
      [userId]
    );
    const accountRow = account.rows[0];
    const transactions = await this.database.query<{
      id: string;
      user_id: string;
      points: number;
      type: LoyaltyPointTransactionType;
      source: string | null;
      reference: string | null;
      created_at: Date;
    }>("SELECT id, user_id, points, type, source, reference, created_at FROM loyalty_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, TRANSACTION_LIMIT]);
    const points = Number(accountRow?.points ?? 0);
    return {
      userId,
      points,
      tier: this.tierFor(points),
      transactions: transactions.rows.map((row) => ({
        id: row.id as string,
        userId: row.user_id as string,
        points: Number(row.points),
        type: row.type as LoyaltyPointTransactionType,
        source: row.source,
        reference: row.reference,
        createdAt: row.created_at.toISOString()
      }))
    };
  }

  async redeem(userId: string, input: Readonly<{ points: number }>): Promise<{ userId: string; redeemed: number; balance: number }> {
    if (!Number.isInteger(input.points) || input.points < 1) throw new BadRequestException("Redeem a positive whole number of loyalty points.");
    const account = await this.database.query<{ user_id: string; points: number }>("SELECT user_id, points FROM loyalty_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
    const row = account.rows[0];
    const balance = Number(row?.points ?? 0);
    if (!row) throw new NotFoundException("Loyalty account not found. Complete a delivery to start earning points.");
    if (input.points > balance) throw new ConflictException("Insufficient loyalty points for this reward.");
    const updated = await this.database.query<{ points: number }>("UPDATE loyalty_accounts SET points = points - $2, updated_at = now() WHERE user_id = $1 RETURNING points", [userId, input.points]);
    const remaining = Number(updated.rows[0]?.points ?? balance - input.points);
    await this.database.query(
      "INSERT INTO loyalty_transactions (user_id, points, type, source, reference) VALUES ($1, $2, 'redeem', 'reward_redemption', $3)",
      [userId, -input.points, `redeem:${userId}:${Date.now()}`]
    );
    return { userId, redeemed: input.points, balance: remaining };
  }

  async listRewards(): Promise<{ items: readonly LoyaltyRewardRecord[] }> {
    const result = await this.database.query<LoyaltyRewardRow>(
      "SELECT id, code, title, description, points_cost, reward_value_minor, currency, stock, is_active, created_at, updated_at FROM loyalty_rewards WHERE is_active = true AND stock > 0 ORDER BY points_cost ASC, created_at DESC"
    );
    const items = result.rows.map((row) => ({
      id: row.id as string,
      code: row.code as string,
      title: row.title as string,
      description: row.description ?? "",
      pointsCost: Number(row.points_cost),
      rewardValueMinor: Number(row.reward_value_minor),
      currency: row.currency as string,
      stock: Number(row.stock),
      isActive: row.is_active as boolean,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
    return { items };
  }

  async redeemReward(userId: string, input: Readonly<{ rewardId: string }>): Promise<{ userId: string; redemption: LoyaltyRedemptionRecord; balance: number }> {
    const rewardResult = await this.database.query<LoyaltyRewardRow>("SELECT id, code, title, description, points_cost, reward_value_minor, currency, stock, is_active, created_at, updated_at FROM loyalty_rewards WHERE id = $1 FOR UPDATE", [input.rewardId]);
    const reward = rewardResult.rows[0];
    if (!reward) throw new NotFoundException("Loyalty reward was not found.");
    if (!reward.is_active) throw new BadRequestException("This loyalty reward is no longer available.");
    if (Number(reward.stock) <= 0) throw new ConflictException("This loyalty reward is out of stock.");
    const cost = Number(reward.points_cost);
    const redemption = await this.database.withTransaction(async (client): Promise<LoyaltyRedemptionRecord & { balance: number }> => {
      const account = await client.query<{ user_id: string; points: number }>("SELECT user_id, points FROM loyalty_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
      const accountRow = account.rows[0];
      const balance = Number(accountRow?.points ?? 0);
      if (!accountRow) throw new NotFoundException("Loyalty account not found. Complete a delivery to start earning points.");
      if (balance < cost) throw new ConflictException("Insufficient loyalty points for this reward.");
      const updated = await client.query<{ points: number }>("UPDATE loyalty_accounts SET points = points - $2, updated_at = now() WHERE user_id = $1 RETURNING points", [userId, cost]);
      const inserted = await client.query<LoyaltyRedemptionRow>(
        "INSERT INTO loyalty_redemptions (user_id, reward_id, points, status, decided_at) VALUES ($1, $2, $3, 'REDEEMED', now()) RETURNING id, user_id, reward_id, points, status, created_at, decided_at",
        [userId, reward.id, cost]
      );
      const redemptionRow = inserted.rows[0];
      if (!redemptionRow) throw new Error("Loyalty reward redemption failed.");
      await client.query("UPDATE loyalty_rewards SET stock = stock - 1, updated_at = now() WHERE id = $1", [reward.id]);
      await client.query(
        "INSERT INTO loyalty_transactions (user_id, points, type, source, reference) VALUES ($1, $2, 'redeem', 'reward', $3)",
        [userId, -cost, `reward:${reward.id}`]
      );
      return {
        id: redemptionRow.id as string,
        userId,
        rewardId: redemptionRow.reward_id as string,
        rewardCode: reward.code,
        points: Number(redemptionRow.points),
        status: redemptionRow.status,
        createdAt: redemptionRow.created_at.toISOString(),
        decidedAt: redemptionRow.decided_at ? redemptionRow.decided_at.toISOString() : null,
        balance: Number(updated.rows[0]?.points ?? balance - cost)
      };
    });
    const { balance, ...redemptionRecord } = redemption;
    return { userId, redemption: redemptionRecord, balance };
  }

  async issueReferralCode(userId: string): Promise<{ code: string }> {
    const existing = await this.database.query<{ code: string }>(
      "SELECT code FROM referral_codes WHERE owner_user_id = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    const current = existing.rows[0]?.code;
    if (current) return { code: current };
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    let inserted = false;
    for (let attempt = 0; attempt < 12 && !inserted; attempt += 1) {
      code = `REF-${Array.from({ length: 6 }, () => characters[Math.floor(Math.random() * characters.length)]).join("")}`;
      const result = await this.database.query("INSERT INTO referral_codes (code, owner_user_id, expires_at) VALUES ($1, $2, now() + ($3 * interval '1 day')) ON CONFLICT (code) DO NOTHING", [code, userId, REFERRAL_CODE_TTL_DAYS]);
      inserted = (result.rowCount ?? 0) > 0;
    }
    if (!inserted) throw new ConflictException("Could not issue a referral code right now.");
    return { code };
  }

  async listReferrals(userId: string): Promise<{ items: readonly ReferralRecord[] }> {
    const result = await this.database.query<{
      id: string;
      referrer_user_id: string;
      referee_user_id: string;
      code: string;
      status: ReferralRecord["status"];
      created_at: Date;
      credited_at: Date | null;
    }>("SELECT id, referrer_user_id, referee_user_id, code, status, created_at, credited_at FROM referrals WHERE referrer_user_id = $1 ORDER BY created_at DESC LIMIT 50", [userId]);
    const items = result.rows.map((row) => ({
      id: row.id as string,
      referrerUserId: row.referrer_user_id as string,
      refereeUserId: row.referee_user_id as string,
      code: row.code,
      status: row.status as ReferralRecord["status"],
      createdAt: row.created_at.toISOString(),
      creditedAt: row.credited_at ? row.credited_at.toISOString() : null
    }));
    return { items };
  }

  async redeemReferral(userId: string, code: string): Promise<{ credited: true; quote: ReferralQuoteRecord }> {
    const referralCode = await this.database.query<{ code: string; owner_user_id: string; is_active: boolean; expires_at: Date | null }>(
      "SELECT code, owner_user_id, is_active, expires_at FROM referral_codes WHERE code = $1",
      [code]
    );
    const row = referralCode.rows[0];
    const isExpired = row !== undefined && (row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now());
    const isInvalid = !row || !row.is_active || isExpired;
    if (row && isInvalid) {
      await this.database.query("UPDATE referral_codes SET is_active = false WHERE code = $1", [code]);
    }
    if (isInvalid) throw new NotFoundException("Referral code was not found, is no longer active or has expired.");
    if (row.owner_user_id === userId) throw new BadRequestException("You cannot redeem your own referral code.");
    const credited = await this.database.withTransaction(async (client) => {
      const result = await client.query<{
        id: string;
        referrer_user_id: string;
        referee_user_id: string;
        code: string;
        status: ReferralRecord["status"];
        created_at: Date;
        credited_at: Date | null;
      }>(
        "INSERT INTO referrals (referrer_user_id, referee_user_id, code, status, credited_at) VALUES ($1, $2, $3, 'PENDING', null) RETURNING id, referrer_user_id, referee_user_id, code, status, created_at, credited_at",
        [row.owner_user_id, userId, code]
      );
      const referral = result.rows[0];
      if (!referral) throw new Error("Referral creation failed.");
      const creditedReferral = await client.query(
        "UPDATE referrals SET status = 'CREDITED', credited_at = now() WHERE id = $1 RETURNING id, referrer_user_id, referee_user_id, code, status, created_at, credited_at",
        [referral.id]
      );
      const creditedRow = creditedReferral.rows[0];
      if (!creditedRow) throw new Error("Referral credit failed.");
      await client.query(
        "INSERT INTO loyalty_accounts (user_id, points) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET points = loyalty_accounts.points + $2, updated_at = now()",
        [row.owner_user_id, REFERRAL_REWARD_POINTS]
      );
      await client.query(
        "INSERT INTO loyalty_transactions (user_id, points, type, source, reference) VALUES ($1, $2, 'referral_credit', 'referral', $3)",
        [row.owner_user_id, REFERRAL_REWARD_POINTS, creditedRow.id]
      );
      return creditedRow;
    });
    const rowOut = credited;
    return {
      credited: true,
      quote: {
        code: rowOut.code,
        referrerUserId: rowOut.referrer_user_id as string,
        rewardPoints: REFERRAL_REWARD_POINTS
      }
    };
  }

  private tierFor(points: number): LoyaltyTier {
    if (points >= 700) return "gold";
    if (points >= 300) return "silver";
    if (points >= 100) return "bronze";
    return "standard";
  }
}
