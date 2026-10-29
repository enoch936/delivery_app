import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, UnauthorizedException } from "@nestjs/common";
import type { RuntimeConfig } from "../src/config/runtime-config.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import type { AuthChallenge, AuthSession, IdentityRepository, OtpProvider, VerifyChallengeResult } from "../src/modules/auth/auth.types.js";

const config: RuntimeConfig = {
  nodeEnv: "test", port: 3000, corsOrigins: [], launchCountryCode: "ET", launchCitySlug: "launch-city", defaultCurrency: "ETB",
  databaseUrl: undefined, authTokenSecret: "a-test-secret-that-is-longer-than-thirty-two-characters", otpProvider: "development", otpDevelopmentCode: "123456", emailProvider: "disabled", otpRequestLimit: 3,
  deliveryFeeMinor: 0n, serviceFeeMinor: 0n, quoteValiditySeconds: 300, accessTokenLifetimeSeconds: 900, refreshTokenLifetimeSeconds: 2592000,   paymentsProvider: "disabled", paymentWebhookSecret: undefined, chapaSecretKey: undefined, chapaWebhookSecret: undefined, chapaBaseUrl: "https://api.chapa.global", stripeSecretKey: undefined, stripeWebhookSecret: undefined, telebirrEnvironment: "test", telebirrBaseUrl: "https://example.test/api", telebirrWebBaseUrl: "https://example.test/pay?", telebirrFabricAppId: undefined, telebirrAppSecret: undefined, telebirrMerchantAppId: undefined, telebirrMerchantCode: undefined, telebirrPrivateKey: undefined, telebirrPublicKey: undefined, telebirrNotifyUrl: "http://localhost:3000/api/v1/payments/webhooks/telebirr", telebirrRedirectUrl: undefined, paymentReturnUrl: undefined, paymentCancelUrl: undefined, courierOfferTimeoutSeconds: 45, dispatchRadiusMeters: 8000, maxPendingOffersPerCourier: 3, deliveryProofOtpRequired: true, taxRateBps: 0, mapsProvider: "disabled", pushProvider: "disabled", firebaseServiceAccountJson: undefined, publicApiBaseUrl: "http://localhost:3000", geocodingProvider: "disabled"
};

class MemoryIdentityRepository implements IdentityRepository {
  readonly challenges: AuthChallenge[] = [];
  readonly sessions = new Map<string, AuthSession>();
  requestCount = 0;
  async countOtpRequestsSince(): Promise<number> { return this.requestCount; }
  async createChallenge(challenge: AuthChallenge): Promise<void> { this.challenges.push(challenge); }
  async verifyChallengeAndCreateSession(input: { challengeId: string; phoneE164: string; codeHash: string; tokenHash: string; expiresAt: Date }): Promise<VerifyChallengeResult> {
    const challenge = this.challenges.find((item) => item.id === input.challengeId && item.phoneE164 === input.phoneE164);
    if (!challenge || challenge.codeHash !== input.codeHash) return { status: "invalid" };
    const session: AuthSession = { id: "session-1", expiresAt: input.expiresAt, user: { id: "user-1", phoneE164: input.phoneE164, displayName: null, accountStatus: "active", roles: ["customer"] } };
    this.sessions.set(input.tokenHash, session);
    return { status: "verified", session };
  }
  async findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null> { return this.sessions.get(tokenHash) ?? null; }
  async refreshSession(): Promise<AuthSession | null> { return null; }
  async revokeRefreshTokenHash(): Promise<void> { }
  async revokeSessionByTokenHash(): Promise<void> { this.sessions.clear(); }
}

class CapturingOtpProvider implements OtpProvider {
  readonly name = "development";
  lastCode: string | null = null;
  async deliver(input: { code: string }): Promise<void> { this.lastCode = input.code; }
}

test("issues a development-only challenge without returning the OTP", async () => {
  const repository = new MemoryIdentityRepository();
  const provider = new CapturingOtpProvider();
  const service = new AuthService(repository, provider, config);
  const result = await service.requestPhoneOtp({ phoneE164: "+251911000000", requestId: "request-1", ipAddress: "127.0.0.1" });
  assert.match(result.challengeId, /^[0-9a-f-]{36}$/);
  assert.equal(provider.lastCode, "123456");
  assert.equal(Object.hasOwn(result, "code"), false);
});

test("creates an opaque session only after a matching OTP verification", async () => {
  const repository = new MemoryIdentityRepository();
  const provider = new CapturingOtpProvider();
  const service = new AuthService(repository, provider, config);
  const challenge = await service.requestPhoneOtp({ phoneE164: "+251911000000", requestId: null, ipAddress: null });
  const verified = await service.verifyPhoneOtp({ challengeId: challenge.challengeId, phoneE164: "+251911000000", code: "123456", requestId: null, ipAddress: null, userAgent: null });
  assert.equal(verified.user.roles[0], "customer");
  assert.ok(verified.accessToken.length > 32);
  assert.equal((await service.authenticate(verified.accessToken)).user.id, "user-1");
  await assert.rejects(() => service.verifyPhoneOtp({ challengeId: challenge.challengeId, phoneE164: "+251911000000", code: "000000", requestId: null, ipAddress: null, userAgent: null }), UnauthorizedException);
});

test("throttles OTP requests", async () => {
  const repository = new MemoryIdentityRepository();
  repository.requestCount = 3;
  const service = new AuthService(repository, new CapturingOtpProvider(), config);
  await assert.rejects(
    () => service.requestPhoneOtp({ phoneE164: "+251911000000", requestId: null, ipAddress: null }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429
  );
});


