export const LOYALTY_REPOSITORY = Symbol("LOYALTY_REPOSITORY");
export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");

export type LoyaltyPointTransactionType = "earn" | "redeem" | "referral_credit" | "bonus";

export type LoyaltyTransactionRecord = Readonly<{
  id: string;
  userId: string;
  points: number;
  type: LoyaltyPointTransactionType;
  source: string | null;
  reference: string | null;
  createdAt: string;
}>;

export type LoyaltyTier = "standard" | "bronze" | "silver" | "gold";

export type LoyaltyAccountRecord = Readonly<{
  userId: string;
  points: number;
  tier: LoyaltyTier;
  transactions: readonly LoyaltyTransactionRecord[];
}>;

export type ReferralStatus = "PENDING" | "CREDITED" | "EXPIRED";

export type ReferralRecord = Readonly<{
  id: string;
  referrerUserId: string;
  refereeUserId: string;
  code: string;
  status: ReferralStatus;
  createdAt: string;
  creditedAt: string | null;
}>;

export type ReferralQuoteRecord = Readonly<{
  code: string;
  referrerUserId: string;
  rewardPoints: number;
}>;

export type LoyaltyRewardRecord = Readonly<{
  id: string;
  code: string;
  title: string;
  description: string;
  pointsCost: number;
  rewardValueMinor: number;
  currency: string;
  stock: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type LoyaltyRedemptionStatus = "PENDING" | "REDEEMED" | "CANCELLED" | "EXPIRED";

export type LoyaltyRedemptionRecord = Readonly<{
  id: string;
  userId: string;
  rewardId: string;
  rewardCode: string;
  points: number;
  status: LoyaltyRedemptionStatus;
  createdAt: string;
  decidedAt: string | null;
}>;
