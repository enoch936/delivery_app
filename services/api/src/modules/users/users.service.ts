import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { AuditService } from "../../common/audit.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { readRuntimeConfig } from "../../config/runtime-config.js";

const DELETION_GRACE_DAYS = 30;

export type UpdateProfileInput = Readonly<{
  displayName?: string;
  email?: string;
  preferredLocale?: string;
  marketingConsent?: boolean;
  analyticsConsent?: boolean;
  acceptTerms?: boolean;
  acceptPrivacy?: boolean;
  textScale?: number;
  reduceMotion?: boolean;
  highContrast?: boolean;
  screenReaderHints?: boolean;
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService
  ) {}

  async profile(userId: string) {
    const result = await this.database.query<{
      id: string; phone_e164: string | null; email: string | null; display_name: string | null; account_status: string;
      preferred_locale: string | null; marketing_consent: boolean | null; analytics_consent: boolean | null;
      deletion_requested_at: Date | null; created_at: Date; email_verified_at: Date | null;
      text_scale: string | null; reduce_motion: boolean | null; high_contrast: boolean | null; screen_reader_hints: boolean | null;
      terms_accepted_at: Date | null; privacy_accepted_at: Date | null;
    }>(
      `SELECT u.id, u.phone_e164, u.email, u.display_name, u.account_status, u.created_at, u.email_verified_at,
              p.preferred_locale, p.marketing_consent, p.analytics_consent, p.deletion_requested_at,
              p.text_scale, p.reduce_motion, p.high_contrast, p.screen_reader_hints,
              p.terms_accepted_at, p.privacy_accepted_at
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundException("User not found.");
    const [favorites, sessions, deletion] = await Promise.all([
      this.database.query<{ count: number }>("SELECT count(*)::int AS count FROM favorites WHERE user_id = $1", [userId]),
      this.database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()",
        [userId]
      ),
      this.database.query<{ scheduled_for: Date; requested_at: Date }>(
        "SELECT scheduled_for, requested_at FROM account_deletion_requests WHERE user_id = $1 AND status = 'pending' ORDER BY requested_at DESC LIMIT 1",
        [userId]
      )
    ]);
    const pendingDeletion = deletion.rows[0] ?? null;
    return {
      id: user.id,
      phoneE164: user.phone_e164,
      email: user.email,
      displayName: user.display_name,
      accountStatus: user.account_status,
      preferredLocale: user.preferred_locale === "am" ? "am" : "en",
      marketingConsent: user.marketing_consent ?? false,
      analyticsConsent: user.analytics_consent ?? false,
      emailVerified: user.email_verified_at !== null,
      emailVerifiedAt: user.email_verified_at?.toISOString() ?? null,
      termsAcceptedAt: user.terms_accepted_at?.toISOString() ?? null,
      privacyAcceptedAt: user.privacy_accepted_at?.toISOString() ?? null,
      accessibility: {
        textScale: user.text_scale === null ? 1 : Number(user.text_scale),
        reduceMotion: user.reduce_motion ?? false,
        highContrast: user.high_contrast ?? false,
        screenReaderHints: user.screen_reader_hints ?? true
      },
      deletionRequestedAt: user.deletion_requested_at?.toISOString() ?? null,
      deletion: pendingDeletion
        ? {
            status: "pending" as const,
            requestedAt: pendingDeletion.requested_at.toISOString(),
            scheduledFor: pendingDeletion.scheduled_for.toISOString()
          }
        : null,
      favoriteCount: favorites.rows[0]?.count ?? 0,
      activeSessionCount: sessions.rows[0]?.count ?? 0,
      createdAt: user.created_at.toISOString()
    };
  }

  async update(userId: string, input: UpdateProfileInput, requestId: string | null = null) {
    await this.database.withTransaction(async (client) => {
      const existing = await client.query<{ email: string | null; email_verified_at: Date | null }>(
        "SELECT email, email_verified_at FROM users WHERE id = $1 FOR UPDATE",
        [userId]
      );
      const current = existing.rows[0];
      if (!current) throw new NotFoundException("User not found.");
      const nextEmail = input.email === undefined ? current.email : input.email.trim().toLowerCase() || null;
      if (nextEmail && nextEmail !== current.email) {
        const conflict = await client.query("SELECT 1 FROM users WHERE email = $1 AND id <> $2", [nextEmail, userId]);
        if ((conflict.rowCount ?? 0) > 0) throw new ConflictException("That email address is already in use.");
      }
      const emailChanged = nextEmail !== current.email;
      await client.query(
        `UPDATE users SET
           display_name = COALESCE($2, display_name),
           email = $3,
           email_verified_at = CASE WHEN $4 THEN NULL ELSE email_verified_at END,
           updated_at = now()
         WHERE id = $1`,
        [userId, input.displayName?.trim() ?? null, nextEmail, emailChanged]
      );
      await client.query(
        `INSERT INTO user_profiles (user_id, preferred_locale, marketing_consent, analytics_consent,
                                    text_scale, reduce_motion, high_contrast, screen_reader_hints,
                                    terms_accepted_at, privacy_accepted_at)
         VALUES ($1, COALESCE($2, 'en'), COALESCE($3, false), COALESCE($4, false),
                 COALESCE($5, 1.00), COALESCE($6, false), COALESCE($7, false), COALESCE($8, true),
                 CASE WHEN $9 THEN now() ELSE NULL END, CASE WHEN $10 THEN now() ELSE NULL END)
         ON CONFLICT (user_id) DO UPDATE SET
           preferred_locale = COALESCE($2, user_profiles.preferred_locale),
           marketing_consent = COALESCE($3, user_profiles.marketing_consent),
           analytics_consent = COALESCE($4, user_profiles.analytics_consent),
           text_scale = COALESCE($5, user_profiles.text_scale),
           reduce_motion = COALESCE($6, user_profiles.reduce_motion),
           high_contrast = COALESCE($7, user_profiles.high_contrast),
           screen_reader_hints = COALESCE($8, user_profiles.screen_reader_hints),
           terms_accepted_at = CASE WHEN $9 THEN COALESCE(user_profiles.terms_accepted_at, now()) ELSE user_profiles.terms_accepted_at END,
           privacy_accepted_at = CASE WHEN $10 THEN COALESCE(user_profiles.privacy_accepted_at, now()) ELSE user_profiles.privacy_accepted_at END,
           updated_at = now()`,
        [
          userId,
          input.preferredLocale ?? null,
          input.marketingConsent ?? null,
          input.analyticsConsent ?? null,
          input.textScale ?? null,
          input.reduceMotion ?? null,
          input.highContrast ?? null,
          input.screenReaderHints ?? null,
          input.acceptTerms === true,
          input.acceptPrivacy === true
        ]
      );
      if (input.acceptTerms === true || input.acceptPrivacy === true) {
        await this.audit.record({
          actorUserId: userId,
          action: "account.consent_recorded",
          entityType: "user",
          entityId: userId,
          requestId,
          metadata: { terms: input.acceptTerms === true, privacy: input.acceptPrivacy === true }
        }, client);
      }
      if (input.textScale !== undefined || input.reduceMotion !== undefined || input.highContrast !== undefined || input.screenReaderHints !== undefined) {
        await this.audit.record({
          actorUserId: userId,
          action: "account.accessibility_updated",
          entityType: "user",
          entityId: userId,
          requestId,
          metadata: {
            textScale: input.textScale ?? null,
            reduceMotion: input.reduceMotion ?? null,
            highContrast: input.highContrast ?? null,
            screenReaderHints: input.screenReaderHints ?? null
          }
        }, client);
      }
    });
    return this.profile(userId);
  }

  async favorites(userId: string) {
    const result = await this.database.query(
      `SELECT f.merchant_id, m.slug, m.display_name, m.logo_url, f.product_id, p.name AS product_name, f.created_at
       FROM favorites f JOIN merchants m ON m.id = f.merchant_id
       LEFT JOIN products p ON p.id = f.product_id
       WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
      [userId]
    );
    return {
      items: result.rows.map((row) => ({
        merchantId: row.merchant_id as string, merchantSlug: row.slug as string, merchantName: row.display_name as string,
        merchantLogoUrl: row.logo_url as string | null, productId: row.product_id as string | null,
        productName: row.product_name as string | null, createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async addFavorite(userId: string, merchantId: string, productId: string | null) {
    const merchant = await this.database.query("SELECT 1 FROM merchants WHERE id = $1 AND status = 'active'", [merchantId]);
    if ((merchant.rowCount ?? 0) === 0) throw new NotFoundException("Merchant not found.");
    if (productId) {
      const product = await this.database.query("SELECT 1 FROM products WHERE id = $1 AND merchant_id = $2", [productId, merchantId]);
      if ((product.rowCount ?? 0) === 0) throw new NotFoundException("Product not found for this merchant.");
    }
    await this.database.query(
      `INSERT INTO favorites (user_id, merchant_id, product_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [userId, merchantId, productId]
    );
    return { favorited: true };
  }

  async removeFavorite(userId: string, merchantId: string, productId: string | null) {
    const result = productId
      ? await this.database.query("DELETE FROM favorites WHERE user_id = $1 AND merchant_id = $2 AND product_id = $3", [userId, merchantId, productId])
      : await this.database.query("DELETE FROM favorites WHERE user_id = $1 AND merchant_id = $2 AND product_id IS NULL", [userId, merchantId]);
    if (result.rowCount === 0) throw new NotFoundException("Favorite not found.");
    return { favorited: false };
  }

  async sessions(userId: string, currentSessionId: string | null) {
    const result = await this.database.query<{
      id: string; user_agent: string | null; created_at: Date; expires_at: Date;
    }>(
      `SELECT id, user_agent, created_at, expires_at FROM user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [userId]
    );
    return {
      currentSessionId,
      items: result.rows.map((row) => ({
        id: row.id,
        userAgent: row.user_agent,
        isCurrent: row.id === currentSessionId,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString()
      }))
    };
  }

  async revokeSession(userId: string, sessionId: string, requestId: string | null) {
    const result = await this.database.query<{ id: string }>(
      "UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id",
      [sessionId, userId]
    );
    if ((result.rowCount ?? 0) === 0) throw new NotFoundException("Session not found.");
    await this.database.query("UPDATE refresh_tokens SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL", [sessionId]);
    await this.audit.record({
      actorUserId: userId, action: "identity.session_revoked_by_user", entityType: "session",
      entityId: sessionId, requestId
    });
    return { revoked: true };
  }

  async revokeOtherSessions(userId: string, currentSessionId: string | null, requestId: string | null) {
    const result = await this.database.query<{ id: string }>(
      `UPDATE user_sessions SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)
       RETURNING id`,
      [userId, currentSessionId]
    );
    const sessionIds = result.rows.map((row) => row.id);
    if (sessionIds.length > 0) {
      await this.database.query(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE session_id = ANY($1::uuid[]) AND revoked_at IS NULL",
        [sessionIds]
      );
    }
    await this.audit.record({
      actorUserId: userId, action: "identity.other_sessions_revoked", entityType: "session",
      entityId: null, requestId, metadata: { revokedCount: sessionIds.length }
    });
    return { revokedCount: sessionIds.length };
  }

  async requestDeletion(userId: string, requestId: string | null = null) {
    const result = await this.database.withTransaction(async (client) => {
      const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
      const inserted = await client.query<{ id: string; scheduled_for: Date }>(
        `INSERT INTO account_deletion_requests (user_id, scheduled_for, request_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id, scheduled_for`,
        [userId, scheduledFor, requestId]
      );
      const request = inserted.rows[0];
      await client.query(
        `INSERT INTO user_profiles (user_id, deletion_requested_at) VALUES ($1, now())
         ON CONFLICT (user_id) DO UPDATE SET deletion_requested_at = now(), updated_at = now()`,
        [userId]
      );
      await client.query("UPDATE users SET account_status = 'deletion_requested', updated_at = now() WHERE id = $1", [userId]);
      await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      await this.audit.record({
        actorUserId: userId, action: "account.deletion_requested", entityType: "user",
        entityId: userId, requestId, metadata: { scheduledFor: (request?.scheduled_for ?? scheduledFor).toISOString() }
      }, client);
      return request ?? null;
    });
    return {
      requested: true,
      status: "pending",
      requestedAt: new Date().toISOString(),
      scheduledFor: (result?.scheduled_for ?? new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000)).toISOString(),
      retentionDays: DELETION_GRACE_DAYS
    };
  }

  async cancelDeletion(userId: string, requestId: string | null = null) {
    await this.database.withTransaction(async (client) => {
      await client.query(
        `UPDATE account_deletion_requests SET status = 'cancelled', cancelled_at = now()
         WHERE user_id = $1 AND status = 'pending'`,
        [userId]
      );
      await client.query(
        `INSERT INTO user_profiles (user_id, deletion_requested_at) VALUES ($1, NULL)
         ON CONFLICT (user_id) DO UPDATE SET deletion_requested_at = NULL, updated_at = now()`,
        [userId]
      );
      await client.query("UPDATE users SET account_status = 'active', updated_at = now() WHERE id = $1", [userId]);
      await this.audit.record({
        actorUserId: userId, action: "account.deletion_cancelled", entityType: "user",
        entityId: userId, requestId
      }, client);
    });
    return { cancelled: true, accountStatus: "active" };
  }

  async exportData(userId: string, requestId: string | null = null) {
    const [profile, addresses, orders, favorites, reviews] = await Promise.all([
      this.profile(userId),
      this.database.query("SELECT * FROM customer_addresses WHERE user_id = $1", [userId]),
      this.database.query("SELECT id, order_number, status, total_minor, currency, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC", [userId]),
      this.database.query("SELECT merchant_id, product_id, created_at FROM favorites WHERE user_id = $1", [userId]),
      this.database.query("SELECT * FROM reviews WHERE user_id = $1", [userId])
    ]);
    await this.audit.record({
      actorUserId: userId, action: "account.data_exported", entityType: "user",
      entityId: userId, requestId
    });
    return {
      exportedAt: new Date().toISOString(), profile, addresses: addresses.rows,
      orders: orders.rows, favorites: favorites.rows, reviews: reviews.rows
    };
  }

  async requestEmailVerification(userId: string, email: string, requestId: string | null) {
    const config = readRuntimeConfig();
    if (config.emailProvider === "disabled") throw new ServiceUnavailableException("Email verification is not configured yet.");
    const secret = config.authTokenSecret;
    if (!secret) throw new ServiceUnavailableException("Email verification is not configured yet.");
    const normalizedEmail = email.trim().toLowerCase();
    const owner = await this.database.query("SELECT 1 FROM users WHERE email = $1 AND id <> $2", [normalizedEmail, userId]);
    if ((owner.rowCount ?? 0) > 0) throw new ConflictException("That email address is already in use.");
    const challengeId = randomUUID();
    const code = config.otpDevelopmentCode;
    if (!code) throw new ServiceUnavailableException("Email verification is not configured yet.");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.database.query(
      `INSERT INTO email_challenges (id, user_id, email, purpose, code_hash, provider, expires_at, request_id)
       VALUES ($1, $2, $3, 'verification', $4, $5, $6, $7)`,
      [challengeId, userId, normalizedEmail, this.hashEmailCode(secret, challengeId, normalizedEmail, code), config.emailProvider, expiresAt, requestId]
    );
    return { challengeId, expiresAt: expiresAt.toISOString(), ...(config.emailProvider === "development" ? { developmentCode: code } : {}) };
  }

  async verifyEmail(userId: string, email: string, challengeId: string, code: string, requestId: string | null = null) {
    const config = readRuntimeConfig();
    const secret = config.authTokenSecret;
    if (!secret) throw new ServiceUnavailableException("Email verification is not configured yet.");
    const normalizedEmail = email.trim().toLowerCase();
    const expectedHash = this.hashEmailCode(secret, challengeId, normalizedEmail, code);
    await this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string; code_hash: string; expires_at: Date; attempts: number; consumed_at: Date | null }>(
        `SELECT id, code_hash, expires_at, attempts, consumed_at FROM email_challenges
         WHERE id = $1 AND user_id = $2 AND email = $3 AND purpose = 'verification' FOR UPDATE`,
        [challengeId, userId, normalizedEmail]
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date() || challenge.attempts >= 5) {
        throw new ConflictException("The email verification code is invalid or expired.");
      }
      if (challenge.code_hash !== expectedHash) {
        await client.query("UPDATE email_challenges SET attempts = attempts + 1 WHERE id = $1", [challengeId]);
        throw new ConflictException("The email verification code is invalid or expired.");
      }
      await client.query("UPDATE email_challenges SET consumed_at = now() WHERE id = $1", [challengeId]);
      await client.query("UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1", [userId, normalizedEmail]);
      await this.audit.record({
        actorUserId: userId, action: "account.email_verified", entityType: "user",
        entityId: userId, requestId, metadata: { email: normalizedEmail }
      }, client);
    });
    return this.profile(userId);
  }

  async requestEmailRecovery(email: string) {
    const config = readRuntimeConfig();
    if (config.emailProvider === "disabled") throw new ServiceUnavailableException("Email recovery is not configured yet.");
    throw new ServiceUnavailableException("Email recovery requires a verified email provider and reset policy configuration.");
  }

  private hashEmailCode(secret: string, challengeId: string, email: string, code: string): string {
    return createHmac("sha256", secret).update(`${challengeId}:${email.toLowerCase()}:${code}`).digest("hex");
  }
}
