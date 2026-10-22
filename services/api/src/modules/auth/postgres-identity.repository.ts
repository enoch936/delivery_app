import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import type { AuthSession, AuthenticatedUser, AuthChallenge, IdentityRepository, UserRole, VerifyChallengeResult } from "./auth.types.js";

type SessionRow = {
  session_id: string;
  expires_at: Date;
  user_id: string;
  phone_e164: string | null;
  display_name: string | null;
  account_status: string;
  roles: UserRole[];
};

@Injectable()
export class PostgresIdentityRepository implements IdentityRepository {
  private pool: Pool | null = null;

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const databaseUrl = readRuntimeConfig().databaseUrl;
    if (!databaseUrl) throw new ServiceUnavailableException("Identity storage is not configured.");
    this.pool = new Pool({ connectionString: databaseUrl, application_name: "delivery_app_api" });
    return this.pool;
  }

  async countOtpRequestsSince(phoneE164: string, since: Date): Promise<number> {
    const result = await this.getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM auth_challenges WHERE phone_e164 = $1 AND requested_at >= $2",
      [phoneE164, since]
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async createChallenge(challenge: AuthChallenge & Readonly<{ provider: string; requestId: string | null; ipHash: string | null }>): Promise<void> {
    await this.getPool().query(
      `INSERT INTO auth_challenges (id, purpose, phone_e164, code_hash, provider, expires_at, request_id, ip_hash)
       VALUES ($1, 'phone_login', $2, $3, $4, $5, $6, $7)`,
      [challenge.id, challenge.phoneE164, challenge.codeHash, challenge.provider, challenge.expiresAt, challenge.requestId, challenge.ipHash]
    );
  }

  async verifyChallengeAndCreateSession(input: Readonly<{
    challengeId: string; phoneE164: string; codeHash: string; tokenHash: string; refreshTokenHash: string; expiresAt: Date; refreshExpiresAt: Date;
    userAgent: string | null; ipHash: string | null; requestId: string | null;
  }>): Promise<VerifyChallengeResult> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      const challenge = await client.query<{ code_hash: string; expires_at: Date; attempts: number; consumed_at: Date | null }>(
        "SELECT code_hash, expires_at, attempts, consumed_at FROM auth_challenges WHERE id = $1 AND phone_e164 = $2 FOR UPDATE",
        [input.challengeId, input.phoneE164]
      );
      const row = challenge.rows[0];
      if (!row) return await this.rollback(client, { status: "invalid" });
      if (row.consumed_at) return await this.rollback(client, { status: "consumed" });
      if (row.expires_at <= new Date()) return await this.rollback(client, { status: "expired" });
      if (row.attempts >= 5) return await this.rollback(client, { status: "locked" });
      if (row.code_hash !== input.codeHash) {
        await client.query("UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = $1", [input.challengeId]);
        return await this.rollback(client, { status: "invalid" });
      }
      const userResult = await client.query<{ id: string; phone_e164: string | null; display_name: string | null; account_status: string }>(
        `INSERT INTO users (phone_e164, account_status) VALUES ($1, 'active')
         ON CONFLICT (phone_e164) DO UPDATE SET updated_at = now()
         RETURNING id, phone_e164, display_name, account_status`,
        [input.phoneE164]
      );
      const user = userResult.rows[0];
      if (!user) throw new Error("User creation did not return a user.");
      if (user.account_status === "suspended" || user.account_status === "deleted") return await this.rollback(client, { status: "suspended" });
      await client.query("INSERT INTO user_role_assignments (user_id, role) VALUES ($1, 'customer') ON CONFLICT DO NOTHING", [user.id]);
      await client.query("UPDATE auth_challenges SET consumed_at = now() WHERE id = $1", [input.challengeId]);
      const sessionResult = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO user_sessions (user_id, token_hash, expires_at, user_agent, ip_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, expires_at`,
        [user.id, input.tokenHash, input.expiresAt, input.userAgent, input.ipHash]
      );
      const session = sessionResult.rows[0];
      if (!session) throw new Error("Session creation did not return a session.");
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, session_id, expires_at) VALUES ($1, $2, $3, $4)`,
        [user.id, input.refreshTokenHash, session.id, input.refreshExpiresAt]
      );
      await this.audit(client, user.id, "identity.phone_verified", "user", user.id, input.requestId, input.ipHash);
      await client.query("COMMIT");
      return { status: "verified", session: { id: session.id, expiresAt: session.expires_at, user: { id: user.id, phoneE164: user.phone_e164, displayName: user.display_name, accountStatus: user.account_status, roles: ["customer"] } } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSession | null> {
    const result = await this.getPool().query<SessionRow>(
      `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.phone_e164, u.display_name, u.account_status,
              COALESCE(array_remove(array_agg(ura.role), NULL), '{}') AS roles
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN user_role_assignments ura ON ura.user_id = u.id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       GROUP BY s.id, s.expires_at, u.id`,
      [tokenHash]
    );
    return result.rows[0] ? this.toSession(result.rows[0]) : null;
  }

  async refreshSession(input: Readonly<{
    refreshTokenHash: string;
    newAccessTokenHash: string;
    newRefreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
    userAgent: string | null;
    ipHash: string | null;
    requestId: string | null;
  }>): Promise<AuthSession | null> {
    const client = await this.getPool().connect();
    try {
      await client.query("BEGIN");
      const refresh = await client.query<{ id: string; user_id: string; session_id: string; expires_at: Date }>(
        `SELECT id, user_id, session_id, expires_at FROM refresh_tokens
         WHERE token_hash = $1 AND revoked_at IS NULL FOR UPDATE`,
        [input.refreshTokenHash]
      );
      const row = refresh.rows[0];
      if (!row || row.expires_at <= new Date()) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [row.id]);
      await client.query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [row.session_id]);
      const sessionResult = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO user_sessions (user_id, token_hash, expires_at, user_agent, ip_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, expires_at`,
        [row.user_id, input.newAccessTokenHash, input.accessExpiresAt, input.userAgent, input.ipHash]
      );
      const session = sessionResult.rows[0];
      if (!session) throw new Error("Session rotation did not return a session.");
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, session_id, expires_at) VALUES ($1, $2, $3, $4)`,
        [row.user_id, input.newRefreshTokenHash, session.id, input.refreshExpiresAt]
      );
      await client.query("COMMIT");
      return this.findSessionByTokenHash(input.newAccessTokenHash);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshTokenHash(refreshTokenHash: string, requestId: string | null): Promise<void> {
    const result = await this.getPool().query<{ user_id: string; session_id: string }>(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id, session_id",
      [refreshTokenHash]
    );
    const row = result.rows[0];
    if (!row) return;
    await this.getPool().query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [row.session_id]);
    await this.getPool().query(
      "INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, request_id) VALUES ($1, 'identity.refresh_revoked', 'session', NULL, $2)",
      [row.user_id, requestId]
    );
  }

  async revokeSessionByTokenHash(tokenHash: string, requestId: string | null): Promise<void> {
    const result = await this.getPool().query<{ user_id: string }>(
      "UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id",
      [tokenHash]
    );
    const userId = result.rows[0]?.user_id;
    if (userId) await this.getPool().query(
      "INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, request_id) VALUES ($1, 'identity.session_revoked', 'session', NULL, $2)",
      [userId, requestId]
    );
  }

  private toSession(row: SessionRow): AuthSession {
    const user: AuthenticatedUser = { id: row.user_id, phoneE164: row.phone_e164, displayName: row.display_name, accountStatus: row.account_status, roles: row.roles };
    return { id: row.session_id, expiresAt: row.expires_at, user };
  }

  private async audit(client: PoolClient, actorUserId: string, action: string, entityType: string, entityId: string, requestId: string | null, ipHash: string | null): Promise<void> {
    await client.query("INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, request_id, ip_hash) VALUES ($1, $2, $3, $4, $5, $6)", [actorUserId, action, entityType, entityId, requestId, ipHash]);
  }

  private async rollback<T>(client: PoolClient, result: T): Promise<T> {
    await client.query("ROLLBACK");
    return result;
  }
}
