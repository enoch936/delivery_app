import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { DatabaseService } from "../../database/database.service.js";
import { readRuntimeConfig } from "../../config/runtime-config.js";

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  async profile(userId: string) {
    const result = await this.database.query<{
      id: string; phone_e164: string | null; email: string | null; display_name: string | null; account_status: string;
      preferred_locale: string | null; marketing_consent: boolean | null; analytics_consent: boolean | null;
      deletion_requested_at: Date | null; created_at: Date;
    }>(
      `SELECT u.id, u.phone_e164, u.email, u.display_name, u.account_status, u.created_at,
              p.preferred_locale, p.marketing_consent, p.analytics_consent, p.deletion_requested_at
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundException("User not found.");
    const favorites = await this.database.query("SELECT count(*)::int AS count FROM favorites WHERE user_id = $1", [userId]);
    return {
      id: user.id, phoneE164: user.phone_e164, email: user.email, displayName: user.display_name,
      accountStatus: user.account_status, preferredLocale: user.preferred_locale ?? "en-ET",
      marketingConsent: user.marketing_consent ?? false, analyticsConsent: user.analytics_consent ?? false,
      deletionRequestedAt: user.deletion_requested_at?.toISOString() ?? null,
      favoriteCount: favorites.rows[0]?.count ?? 0, createdAt: user.created_at.toISOString()
    };
  }

  async update(userId: string, input: Readonly<{ displayName?: string | undefined; email?: string | undefined; preferredLocale?: string | undefined; marketingConsent?: boolean | undefined; analyticsConsent?: boolean | undefined }>) {
    await this.database.withTransaction(async (client) => {
      if (input.email) {
        const conflict = await client.query("SELECT 1 FROM users WHERE email = $1 AND id <> $2", [input.email, userId]);
        if ((conflict.rowCount ?? 0) > 0) throw new ConflictException("That email address is already in use.");
      }
      await client.query(
        `UPDATE users SET display_name = COALESCE($2, display_name), email = COALESCE($3, email), updated_at = now() WHERE id = $1`,
        [userId, input.displayName ?? null, input.email?.toLowerCase() ?? null]
      );
      await client.query(
        `INSERT INTO user_profiles (user_id, preferred_locale, marketing_consent, analytics_consent)
         VALUES ($1, COALESCE($2,'en-ET'), COALESCE($3,false), COALESCE($4,false))
         ON CONFLICT (user_id) DO UPDATE SET
           preferred_locale = COALESCE($2, user_profiles.preferred_locale),
           marketing_consent = COALESCE($3, user_profiles.marketing_consent),
           analytics_consent = COALESCE($4, user_profiles.analytics_consent),
           updated_at = now()`,
        [userId, input.preferredLocale ?? null, input.marketingConsent ?? null, input.analyticsConsent ?? null]
      );
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

  async requestDeletion(userId: string) {
    await this.database.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO user_profiles (user_id, deletion_requested_at) VALUES ($1, now())
         ON CONFLICT (user_id) DO UPDATE SET deletion_requested_at = now(), updated_at = now()`,
        [userId]
      );
      await client.query("UPDATE users SET account_status = 'deletion_requested', updated_at = now() WHERE id = $1", [userId]);
      await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    });
    return { requested: true };
  }

  async exportData(userId: string) {
    const [profile, addresses, orders, favorites, reviews] = await Promise.all([
      this.profile(userId),
      this.database.query("SELECT * FROM customer_addresses WHERE user_id = $1", [userId]),
      this.database.query("SELECT id, order_number, status, total_minor, currency, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC", [userId]),
      this.database.query("SELECT merchant_id, product_id, created_at FROM favorites WHERE user_id = $1", [userId]),
      this.database.query("SELECT * FROM reviews WHERE user_id = $1", [userId])
    ]);
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
    const challengeId = randomUUID();
    const code = config.otpDevelopmentCode;
    if (!code) throw new ServiceUnavailableException("Email verification is not configured yet.");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.database.query(
      `INSERT INTO email_challenges (id, user_id, email, purpose, code_hash, provider, expires_at, request_id)
       VALUES ($1, $2, $3, 'verification', $4, $5, $6, $7)`,
      [challengeId, userId, email.toLowerCase(), this.hashEmailCode(secret, challengeId, email, code), config.emailProvider, expiresAt, requestId]
    );
    return { challengeId, expiresAt: expiresAt.toISOString(), ...(config.emailProvider === "development" ? { developmentCode: code } : {}) };
  }

  async verifyEmail(userId: string, email: string, challengeId: string, code: string) {
    const config = readRuntimeConfig();
    const secret = config.authTokenSecret;
    if (!secret) throw new ServiceUnavailableException("Email verification is not configured yet.");
    const result = await this.database.query<{ id: string; code_hash: string; expires_at: Date; attempts: number; consumed_at: Date | null }>(
      `SELECT id, code_hash, expires_at, attempts, consumed_at FROM email_challenges
       WHERE id = $1 AND user_id = $2 AND email = $3 AND purpose = 'verification' FOR UPDATE`,
      [challengeId, userId, email.toLowerCase()]
    );
    const challenge = result.rows[0];
    if (!challenge || challenge.consumed_at || challenge.expires_at <= new Date() || challenge.attempts >= 5) {
      throw new ConflictException("The email verification code is invalid or expired.");
    }
    if (challenge.code_hash !== this.hashEmailCode(secret, challengeId, email, code)) {
      await this.database.query("UPDATE email_challenges SET attempts = attempts + 1 WHERE id = $1", [challengeId]);
      throw new ConflictException("The email verification code is invalid or expired.");
    }
    await this.database.withTransaction(async (client) => {
      await client.query("UPDATE email_challenges SET consumed_at = now() WHERE id = $1", [challengeId]);
      await client.query("UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1", [userId, email.toLowerCase()]);
    });
    return this.profile(userId);
  }

  async requestEmailRecovery(email: string) {
    const config = readRuntimeConfig();
    if (config.emailProvider === "disabled") throw new ServiceUnavailableException("Email recovery is not configured yet.");
    throw new ServiceUnavailableException("Email recovery requires a password/reset provider configuration.");
  }

  private hashEmailCode(secret: string, challengeId: string, email: string, code: string): string {
    return createHmac("sha256", secret).update(`${challengeId}:${email.toLowerCase()}:${code}`).digest("hex");
  }
}


