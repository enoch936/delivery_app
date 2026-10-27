import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class ChatService {
  constructor(private readonly database: DatabaseService) {}

  async ensureOrderConversation(userId: string, orderId: string) {
    const order = await this.database.query<{ id: string; user_id: string; merchant_id: string; courier_user_id: string | null }>(
      "SELECT id, user_id, merchant_id, courier_user_id FROM orders WHERE id = $1", [orderId]
    );
    const row = order.rows[0];
    if (!row) throw new NotFoundException("Order not found.");
    const merchantMember = await this.database.query("SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND user_id = $2", [row.merchant_id, userId]);
    const admin = await this.database.query("SELECT 1 FROM user_role_assignments WHERE user_id = $1 AND role IN ('admin','support','operations')", [userId]);
    const allowed = row.user_id === userId || row.courier_user_id === userId || (merchantMember.rowCount ?? 0) > 0 || (admin.rowCount ?? 0) > 0;
    if (!allowed) throw new ForbiddenException("You cannot access this order conversation.");
    const conversationId = await this.database.withTransaction(async (client) => {
      const existing = await client.query<{ id: string }>("SELECT id FROM conversations WHERE order_id = $1", [row.id]);
      if (existing.rows[0]) {
        await client.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [existing.rows[0].id, userId]);
        return existing.rows[0].id;
      }
      const created = await client.query<{ id: string }>("INSERT INTO conversations (order_id, kind) VALUES ($1,'order') RETURNING id", [row.id]);
      const id = created.rows[0]?.id;
      if (!id) throw new Error("Conversation creation failed.");
      await client.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2)", [id, userId]);
      if (row.user_id !== userId) await client.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, row.user_id]);
      const members = await client.query<{ user_id: string }>("SELECT user_id FROM merchant_members WHERE merchant_id = $1", [row.merchant_id]);
      for (const member of members.rows) {
        await client.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, member.user_id]);
      }
      if (row.courier_user_id) await client.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, row.courier_user_id]);
      return id;
    });
    return this.conversation(conversationId, userId);
  }

  async list(userId: string) {
    const result = await this.database.query(
      `SELECT c.id, c.order_id, c.kind, o.order_number,
              (SELECT jsonb_build_object('body', m.body, 'senderUserId', m.sender_user_id, 'createdAt', m.created_at)
               FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.created_at > COALESCE(cm.last_read_at, 'epoch')) AS unread_count
       FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1
       LEFT JOIN orders o ON o.id = c.order_id
       ORDER BY COALESCE((SELECT max(created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at) DESC`,
      [userId]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderId: row.order_id as string | null, orderNumber: row.order_number as string | null,
        kind: row.kind as string, lastMessage: row.last_message, unreadCount: row.unread_count as number
      }))
    };
  }

  async conversation(conversationId: string, userId: string) {
    const result = await this.database.query<{ id: string; order_id: string | null; kind: string; joined_at: Date; last_read_at: Date | null }>(
      `SELECT c.id, c.order_id, c.kind, cm.created_at AS joined_at, cm.last_read_at
       FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $2
       WHERE c.id = $1`, [conversationId, userId]
    );
    const row = result.rows[0];
    if (!row) throw new ForbiddenException("Conversation not found.");
    const members = await this.database.query(
      `SELECT cm.user_id, cm.member_role, u.display_name, u.phone_e164 FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = $1`,
      [conversationId]
    );
    return {
      id: row.id, orderId: row.order_id, kind: row.kind, lastReadAt: row.last_read_at?.toISOString() ?? null,
      members: members.rows.map((member) => ({ userId: member.user_id, role: member.member_role, displayName: member.display_name, phoneE164: member.phone_e164 }))
    };
  }

  async messages(conversationId: string, userId: string, limit: number, before: string | undefined) {
    await this.requireMember(conversationId, userId);
    const result = await this.database.query(
      `SELECT m.id, m.sender_user_id, m.body, m.created_at,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'storageKey',a.storage_key,'contentType',a.content_type,'sizeBytes',a.size_bytes))
                        FROM attachments a WHERE a.message_id = m.id),'[]'::jsonb) AS attachments
       FROM messages m WHERE m.conversation_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
       ORDER BY m.created_at DESC LIMIT $3`,
      [conversationId, before ?? null, limit]
    );
    return {
      items: result.rows.reverse().map((row) => ({
        id: row.id as string, senderUserId: row.sender_user_id as string, body: row.body as string,
        attachments: row.attachments, createdAt: (row.created_at as Date).toISOString()
      })),
      nextBefore: result.rows.length === limit ? (result.rows[0]?.created_at as Date | undefined)?.toISOString() ?? null : null
    };
  }

  async send(conversationId: string, userId: string, body: string) {
    await this.requireMember(conversationId, userId);
    const trimmed = body.trim();
    if (trimmed.length === 0) throw new BadRequestException("Message body cannot be empty.");
    const result = await this.database.query<{ id: string; created_at: Date }>(
      "INSERT INTO messages (conversation_id, sender_user_id, body) VALUES ($1,$2,$3) RETURNING id, created_at",
      [conversationId, userId, trimmed]
    );
    await this.database.query("UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2", [conversationId, userId]);
    const members = await this.database.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2", [conversationId, userId]);
    for (const member of members.rows) {
      await this.database.query(
        "INSERT INTO notifications (user_id, notification_type, title, body, data) VALUES ($1,'message.received','New message',$2,$3)",
        [member.user_id, trimmed.slice(0, 160), JSON.stringify({ conversationId })]
      );
    }
    return { id: result.rows[0]?.id, createdAt: result.rows[0]?.created_at.toISOString() };
  }

  async markRead(conversationId: string, userId: string) {
    const result = await this.database.query("UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2", [conversationId, userId]);
    if (result.rowCount === 0) throw new ForbiddenException("Conversation not found.");
    return { read: true };
  }

  async addAttachment(conversationId: string, messageId: string, userId: string, input: Readonly<{ storageKey: string; contentType: string; sizeBytes: number }>) {
    await this.requireMember(conversationId, userId);
    const message = await this.database.query("SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2 AND sender_user_id = $3", [messageId, conversationId, userId]);
    if ((message.rowCount ?? 0) === 0) throw new NotFoundException("Message not found.");
    const result = await this.database.query<{ id: string }>(
      "INSERT INTO attachments (message_id, storage_key, content_type, size_bytes) VALUES ($1,$2,$3,$4) RETURNING id",
      [messageId, input.storageKey, input.contentType, input.sizeBytes]
    );
    return { id: result.rows[0]?.id };
  }

  private async requireMember(conversationId: string, userId: string): Promise<void> {
    const result = await this.database.query("SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2", [conversationId, userId]);
    if ((result.rowCount ?? 0) === 0) throw new ForbiddenException("Conversation not found.");
  }
}
