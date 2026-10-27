import { Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import { PushService } from "../push/push.service.js";

export type NotificationInput = Readonly<{
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}>;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly push: PushService
  ) {}

  async create(input: NotificationInput, client?: PoolClient): Promise<{ id: string }> {
    const executor = client ?? this.database.getPool();
    const result = await executor.query<{ id: string }>(
      `INSERT INTO notifications (user_id, notification_type, title, body, data)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.userId, input.type, input.title, input.body, JSON.stringify(input.data ?? {})]
    );
    const notification = result.rows[0];
    if (!notification) throw new Error("Notification creation failed.");
    await executor.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status, attempted_at)
       SELECT $1::uuid, channel, CASE WHEN channel = 'push' THEN 'QUEUED' ELSE 'SENT' END,
         CASE WHEN channel = 'push' THEN NULL ELSE now() END
       FROM notification_preferences np, LATERAL (SELECT 'in_app' AS channel UNION ALL SELECT 'push' WHERE np.push_enabled) channels
       WHERE np.user_id = $2
       UNION ALL SELECT $1::uuid, 'in_app', 'SENT', now() WHERE NOT EXISTS (SELECT 1 FROM notification_preferences WHERE user_id = $2)`,
      [notification.id, input.userId]
    );
    if (!client) void this.push.flushPending();
    return notification;
  }

  async list(userId: string, limit: number, offset: number) {
    const [items, unread] = await Promise.all([
      this.database.query<{ id: string; notification_type: string; title: string; body: string; data: Record<string, unknown>; read_at: Date | null; created_at: Date }>(
        `SELECT id, notification_type, title, body, data, read_at, created_at
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
      this.database.query<{ count: string }>("SELECT count(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL", [userId])
    ]);
    return {
      items: items.rows.map((row) => ({
        id: row.id, type: row.notification_type, title: row.title, body: row.body, data: row.data,
        readAt: row.read_at?.toISOString() ?? null, createdAt: row.created_at.toISOString()
      })),
      unreadCount: Number(unread.rows[0]?.count ?? "0")
    };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.database.query(
      "UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2",
      [notificationId, userId]
    );
    if (result.rowCount === 0) throw new NotFoundException("Notification not found.");
  }

  async markAllRead(userId: string): Promise<void> {
    await this.database.query("UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND read_at IS NULL", [userId]);
  }

  async getPreferences(userId: string) {
    const result = await this.database.query<{ push_enabled: boolean; sms_enabled: boolean; email_enabled: boolean; order_updates: boolean; promotions: boolean; security_alerts: boolean; updated_at: Date }>(
      `SELECT push_enabled, sms_enabled, email_enabled, order_updates, promotions, security_alerts, updated_at
       FROM notification_preferences WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      await this.database.query("INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
      return { pushEnabled: true, smsEnabled: true, emailEnabled: false, orderUpdates: true, promotions: false, securityAlerts: true, updatedAt: new Date().toISOString() };
    }
    return {
      pushEnabled: row.push_enabled, smsEnabled: row.sms_enabled, emailEnabled: row.email_enabled,
      orderUpdates: row.order_updates, promotions: row.promotions, securityAlerts: row.security_alerts,
      updatedAt: row.updated_at.toISOString()
    };
  }

  async updatePreferences(userId: string, input: Partial<Readonly<{ pushEnabled: boolean; smsEnabled: boolean; emailEnabled: boolean; orderUpdates: boolean; promotions: boolean; securityAlerts: boolean }>>) {
    await this.database.query(
      `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    await this.database.query(
      `UPDATE notification_preferences SET
         push_enabled = COALESCE($2, push_enabled),
         sms_enabled = COALESCE($3, sms_enabled),
         email_enabled = COALESCE($4, email_enabled),
         order_updates = COALESCE($5, order_updates),
         promotions = COALESCE($6, promotions),
         security_alerts = COALESCE($7, security_alerts),
         updated_at = now()
       WHERE user_id = $1`,
      [userId, input.pushEnabled, input.smsEnabled, input.emailEnabled, input.orderUpdates, input.promotions, input.securityAlerts]
    );
    return this.getPreferences(userId);
  }
}
