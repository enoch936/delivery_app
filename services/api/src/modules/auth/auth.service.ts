import { HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { IDENTITY_REPOSITORY, OTP_PROVIDER, RUNTIME_CONFIG, type AuthSession, type IdentityRepository, type OtpProvider } from "./auth.types.js";

const OTP_LIFETIME_MS = 5 * 60 * 1000;
const OTP_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepository,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  async requestPhoneOtp(input: Readonly<{ phoneE164: string; requestId: string | null; ipAddress: string | null }>): Promise<{ challengeId: string; expiresAt: string }> {
    const secret = this.requiredSecret();
    const recentRequests = await this.repository.countOtpRequestsSince(input.phoneE164, new Date(Date.now() - OTP_WINDOW_MS));
    if (recentRequests >= this.config.otpRequestLimit) {
      throw new HttpException("Too many verification requests. Please try again later.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + OTP_LIFETIME_MS);
    const code = this.config.otpProvider === "development" ? this.config.otpDevelopmentCode : randomCode();
    if (!code) throw new ServiceUnavailableException("Phone sign-in is not configured yet.");
    const codeHash = this.hashOtp(secret, id, input.phoneE164, code);
    await this.repository.createChallenge({ id, phoneE164: input.phoneE164, codeHash, expiresAt, attempts: 0, consumedAt: null, provider: this.otpProvider.name, requestId: input.requestId, ipHash: hashIp(input.ipAddress) });
    await this.otpProvider.deliver({ phoneE164: input.phoneE164, code, expiresAt });
    return { challengeId: id, expiresAt: expiresAt.toISOString() };
  }

  async verifyPhoneOtp(input: Readonly<{ challengeId: string; phoneE164: string; code: string; requestId: string | null; ipAddress: string | null; userAgent: string | null }>): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; refreshExpiresAt: string; user: AuthSession["user"] }> {
    const accessToken = randomBytes(48).toString("base64url");
    const refreshToken = randomBytes(48).toString("base64url");
    const now = Date.now();
    const result = await this.repository.verifyChallengeAndCreateSession({
      challengeId: input.challengeId,
      phoneE164: input.phoneE164,
      codeHash: this.hashOtp(this.requiredSecret(), input.challengeId, input.phoneE164, input.code),
      tokenHash: this.hashToken(accessToken),
      refreshTokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(now + this.config.accessTokenLifetimeSeconds * 1000),
      refreshExpiresAt: new Date(now + this.config.refreshTokenLifetimeSeconds * 1000),
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      ipHash: hashIp(input.ipAddress),
      requestId: input.requestId
    });
    if (result.status !== "verified") throw new UnauthorizedException("The verification code is invalid, expired, or no longer usable.");
    return {
      accessToken,
      refreshToken,
      expiresAt: result.session.expiresAt.toISOString(),
      refreshExpiresAt: new Date(now + this.config.refreshTokenLifetimeSeconds * 1000).toISOString(),
      user: result.session.user
    };
  }

  async refresh(refreshToken: string, input: Readonly<{ requestId: string | null; ipAddress: string | null; userAgent: string | null }>): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; refreshExpiresAt: string; user: AuthSession["user"] }> {
    const newAccessToken = randomBytes(48).toString("base64url");
    const newRefreshToken = randomBytes(48).toString("base64url");
    const now = Date.now();
    const session = await this.repository.refreshSession({
      refreshTokenHash: this.hashToken(refreshToken),
      newAccessTokenHash: this.hashToken(newAccessToken),
      newRefreshTokenHash: this.hashToken(newRefreshToken),
      accessExpiresAt: new Date(now + this.config.accessTokenLifetimeSeconds * 1000),
      refreshExpiresAt: new Date(now + this.config.refreshTokenLifetimeSeconds * 1000),
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      ipHash: hashIp(input.ipAddress),
      requestId: input.requestId
    });
    if (!session) throw new UnauthorizedException("The refresh token is invalid, expired, or has been revoked.");
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: session.expiresAt.toISOString(),
      refreshExpiresAt: new Date(now + this.config.refreshTokenLifetimeSeconds * 1000).toISOString(),
      user: session.user
    };
  }

  async authenticate(accessToken: string): Promise<AuthSession> {
    const session = await this.repository.findSessionByTokenHash(this.hashToken(accessToken));
    const signInAllowed = session?.user.accountStatus === "active" || session?.user.accountStatus === "deletion_requested";
    if (!session || !signInAllowed) throw new UnauthorizedException("Your session is invalid or has expired.");
    return session;
  }

  async revoke(accessToken: string, requestId: string | null): Promise<void> {
    await this.repository.revokeSessionByTokenHash(this.hashToken(accessToken), requestId);
  }

  async logout(accessToken: string, refreshToken: string | null, requestId: string | null): Promise<void> {
    await this.repository.revokeSessionByTokenHash(this.hashToken(accessToken), requestId);
    if (refreshToken) await this.repository.revokeRefreshTokenHash(this.hashToken(refreshToken), requestId);
  }

  private requiredSecret(): string {
    if (!this.config.authTokenSecret || this.config.authTokenSecret.length < 32) throw new ServiceUnavailableException("Phone sign-in is not configured yet.");
    return this.config.authTokenSecret;
  }

  private hashOtp(secret: string, challengeId: string, phoneE164: string, code: string): string {
    return createHmac("sha256", secret).update(`${challengeId}:${phoneE164}:${code}`).digest("hex");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}

function randomCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

function hashIp(ipAddress: string | null): string | null {
  return ipAddress ? createHash("sha256").update(ipAddress).digest("hex") : null;
}
