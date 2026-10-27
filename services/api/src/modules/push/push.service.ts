import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { readRuntimeConfig } from "../../config/runtime-config.js";
import { DatabaseService } from "../../database/database.service.js";

export type PushNotification = Readonly<{
  notificationId: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}>;

@Injectable()
export class PushService implements OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private readonly messaging: Messaging | null;
  private readonly timer: NodeJS.Timeout | null;
  private flushing = false;

  constructor(private readonly database: DatabaseService) {
    const config = readRuntimeConfig();
    if (config.pushProvider !== "fcm") {
      this.messaging = null;
      this.timer = null;
      return;
    }
    try {
      const credential = config.firebaseServiceAccountJson
        ? cert(JSON.parse(config.firebaseServiceAccountJson) as ServiceAccount)
        : applicationDefault();
      const app = getApps()[0] ?? initializeApp({ credential });
      this.messaging = getMessaging(app);
      this.timer = setInterval(() => void this.flushPending(), 30_000);
      this.timer.unref();
      void this.flushPending();
    } catch (error) {
      this.messaging = null;
      this.timer = null;
      this.logger.error(`Firebase push initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get enabled(): boolean {
    return this.messaging !== null;
  }

  async flushPending(limit = 50): Promise<void> {
    if (!this.messaging || this.flushing) return;
    this.flushing = true;
    try {
      const pending = await this.database.query<{
        id: string;
        user_id: string;
        title: string;
        body: string;
        data: Record<string, unknown>;
      }>(
        `SELECT n.id, n.user_id, n.title, n.body, n.data
         FROM notification_deliveries nd
         JOIN notifications n ON n.id = nd.notification_id
         WHERE nd.channel = 'push' AND nd.status = 'QUEUED'
         ORDER BY nd.created_at
         LIMIT $1`,
        [limit]
      );
      for (const row of pending.rows) {
        await this.sendNotification({
          notificationId: row.id,
          userId: row.user_id,
          title: row.title,
          body: row.body,
          data: row.data
        });
      }
    } catch (error) {
      this.logger.warn(`Pending push flush failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.flushing = false;
    }
  }

  async sendNotification(notification: PushNotification): Promise<void> {
    if (!this.messaging) return;

    const result = await this.database.query<{ token: string }>(
      `SELECT dt.token
       FROM device_tokens dt
       LEFT JOIN notification_preferences np ON np.user_id = dt.user_id
       WHERE dt.user_id = $1
         AND dt.revoked_at IS NULL
         AND COALESCE(np.push_enabled, true) = true`,
      [notification.userId]
    );
    if (result.rowCount === 0) {
      await this.database.query(
        `UPDATE notification_deliveries
         SET status = 'FAILED', attempted_at = now(), error_message = 'No active push devices.'
         WHERE notification_id = $1 AND channel = 'push' AND status = 'QUEUED'`,
        [notification.notificationId]
      );
      return;
    }

    const tokens = result.rows.map((row) => row.token);
    const data = Object.fromEntries(
      Object.entries(notification.data ?? {}).map(([key, value]) => [key, value == null ? "" : String(value)])
    );
    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];

    for (let index = 0; index < tokens.length; index += 500) {
      const batch = tokens.slice(index, index + 500);
      try {
        const response = await this.messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title: notification.title, body: notification.body },
          data: { ...data, notificationId: notification.notificationId }
        });
        sent += response.successCount;
        failed += response.failureCount;
        response.responses.forEach((entry, responseIndex) => {
          const code = entry.error?.code;
          if (!entry.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-argument")) {
            const token = batch[responseIndex];
            if (token) invalidTokens.push(token);
          }
        });
      } catch (error) {
        failed += batch.length;
        this.logger.warn(`FCM batch delivery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (invalidTokens.length > 0) {
      await this.database.query(
        `UPDATE device_tokens SET revoked_at = now(), updated_at = now() WHERE token = ANY($1::text[]) AND revoked_at IS NULL`,
        [invalidTokens]
      );
    }

    await this.database.query(
      `UPDATE notification_deliveries
       SET status = $2, attempted_at = now(), error_message = $3
       WHERE notification_id = $1 AND channel = 'push'`,
      [notification.notificationId, failed > 0 && sent === 0 ? "FAILED" : "SENT", failed > 0 ? `${failed} push deliveries failed.` : null]
    );
  }
}
