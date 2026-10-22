export type UserRole = "customer" | "courier" | "merchant_staff" | "admin" | "support";

export type AuthenticatedUser = Readonly<{
  id: string;
  phoneE164: string | null;
  displayName: string | null;
  accountStatus: string;
  roles: readonly UserRole[];
}>;

export type AuthSession = Readonly<{
  id: string;
  user: AuthenticatedUser;
  expiresAt: Date;
}>;

export type AuthChallenge = Readonly<{
  id: string;
  phoneE164: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}>;

export type VerifyChallengeResult =
  | Readonly<{ status: "verified"; session: AuthSession }>
  | Readonly<{ status: "invalid" | "expired" | "locked" | "consumed" | "suspended" }>;

export interface IdentityRepository {
  countOtpRequestsSince(phoneE164: string, since: Date): Promise<number>;
  createChallenge(challenge: AuthChallenge & Readonly<{ provider: string; requestId: string | null; ipHash: string | null }>): Promise<void>;
  verifyChallengeAndCreateSession(input: Readonly<{
    challengeId: string;
    phoneE164: string;
    codeHash: string;
    tokenHash: string;
    refreshTokenHash: string;
    expiresAt: Date;
    refreshExpiresAt: Date;
    userAgent: string | null;
    ipHash: string | null;
    requestId: string | null;
  }>): Promise<VerifyChallengeResult>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  revokeSessionByTokenHash(tokenHash: string, requestId: string | null): Promise<void>;
  refreshSession(input: Readonly<{
    refreshTokenHash: string;
    newAccessTokenHash: string;
    newRefreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
    userAgent: string | null;
    ipHash: string | null;
    requestId: string | null;
  }>): Promise<AuthSession | null>;
  revokeRefreshTokenHash(refreshTokenHash: string, requestId: string | null): Promise<void>;
}

export interface OtpProvider {
  readonly name: string;
  deliver(input: Readonly<{ phoneE164: string; code: string; expiresAt: Date }>): Promise<void>;
}

export const IDENTITY_REPOSITORY = Symbol("IDENTITY_REPOSITORY");
export const OTP_PROVIDER = Symbol("OTP_PROVIDER");
export const RUNTIME_CONFIG = Symbol("RUNTIME_CONFIG");
