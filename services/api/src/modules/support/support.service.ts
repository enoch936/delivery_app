import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class SupportService {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, input: Readonly<{ subject: string; category: string; orderId: string | null; priority: string; message: string }>) {
    if (input.orderId) {
      const order = await this.database.query("SELECT 1 FROM orders WHERE id = $1 AND user_id = $2", [input.orderId, userId]);
      if ((order.rowCount ?? 0) === 0) throw new NotFoundException("Order not found.");
    }
    return this.database.withTransaction(async (client) => {
      const ticket = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO support_tickets (user_id, order_id, subject, category, priority) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
        [userId, input.orderId, input.subject, input.category, input.priority]
      );
      const id = ticket.rows[0]?.id;
      if (!id) throw new Error("Ticket creation failed.");
      await client.query("INSERT INTO support_messages (ticket_id, sender_user_id, body) VALUES ($1,$2,$3)", [id, userId, input.message]);
      return { id, status: "OPEN", createdAt: ticket.rows[0]?.created_at.toISOString() };
    });
  }

  async mine(userId: string, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT t.id, t.subject, t.category, t.status, t.priority, t.created_at, t.updated_at, o.order_number,
              (SELECT count(*)::int FROM support_messages sm WHERE sm.ticket_id = t.id AND sm.is_internal = false) AS message_count
       FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id
       WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, subject: row.subject as string, category: row.category as string, status: row.status as string,
        priority: row.priority as string, orderNumber: row.order_number as string | null,
        messageCount: row.message_count as number, createdAt: (row.created_at as Date).toISOString(), updatedAt: (row.updated_at as Date).toISOString()
      }))
    };
  }

  async detail(userId: string, ticketId: string, staff: boolean) {
    const ticket = await this.database.query(
      `SELECT t.*, o.order_number, u.display_name AS requester_name, u.phone_e164 AS requester_phone
       FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
      [ticketId]
    );
    const row = ticket.rows[0];
    if (!row) throw new NotFoundException("Ticket not found.");
    if (!staff && row.user_id !== userId) throw new ForbiddenException("Ticket not found.");
    const messages = await this.database.query(
      `SELECT id, sender_user_id, body, is_internal, created_at FROM support_messages WHERE ticket_id = $1 AND ($2::boolean OR is_internal = false) ORDER BY created_at ASC`,
      [ticketId, staff]
    );
    return {
      id: row.id, subject: row.subject, category: row.category, status: row.status, priority: row.priority,
      orderId: row.order_id, orderNumber: row.order_number, requesterName: row.requester_name,
      requesterPhone: row.requester_phone, assignedTo: row.assigned_to,
      createdAt: (row.created_at as Date).toISOString(), updatedAt: (row.updated_at as Date).toISOString(),
      messages: messages.rows.map((message) => ({
        id: message.id as string, senderUserId: message.sender_user_id as string, body: message.body as string,
        isInternal: message.is_internal as boolean, createdAt: (message.created_at as Date).toISOString()
      }))
    };
  }

  async reply(userId: string, ticketId: string, body: string, staff: boolean, internal: boolean) {
    const ticket = await this.database.query<{ id: string; user_id: string; status: string }>("SELECT id, user_id, status FROM support_tickets WHERE id = $1", [ticketId]);
    const row = ticket.rows[0];
    if (!row) throw new NotFoundException("Ticket not found.");
    if (!staff && row.user_id !== userId) throw new ForbiddenException("Ticket not found.");
    if (row.status === "CLOSED") throw new ForbiddenException("This ticket is closed.");
    await this.database.withTransaction(async (client) => {
      await client.query("INSERT INTO support_messages (ticket_id, sender_user_id, body, is_internal) VALUES ($1,$2,$3,$4)", [ticketId, userId, body, staff && internal]);
      await client.query("UPDATE support_tickets SET status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END, updated_at = now() WHERE id = $1", [ticketId]);
      if (staff && !internal) {
        await client.query("INSERT INTO notifications (user_id, notification_type, title, body, data) VALUES ($1,'support.reply','Support replied',$2,$3)", [row.user_id, body.slice(0, 160), JSON.stringify({ ticketId })]);
      }
    });
    return { sent: true };
  }

  async adminList(status: string | undefined, priority: string | undefined, limit: number, offset: number) {
    const result = await this.database.query(
      `SELECT t.id, t.subject, t.category, t.status, t.priority, t.created_at, t.updated_at, t.assigned_to,
              u.phone_e164 AS requester_phone, o.order_number
       FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN orders o ON o.id = t.order_id
       WHERE ($1::text IS NULL OR t.status = $1) AND ($2::text IS NULL OR t.priority = $2)
       ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, t.created_at ASC
       LIMIT $3 OFFSET $4`,
      [status ?? null, priority ?? null, limit, offset]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, subject: row.subject as string, category: row.category as string, status: row.status as string,
        priority: row.priority as string, requesterPhone: row.requester_phone as string | null, orderNumber: row.order_number as string | null,
        assignedTo: row.assigned_to as string | null, createdAt: (row.created_at as Date).toISOString(), updatedAt: (row.updated_at as Date).toISOString()
      }))
    };
  }

  async assign(ticketId: string, staffUserId: string, assignedTo: string | null) {
    const result = await this.database.query("UPDATE support_tickets SET assigned_to = $2, status = CASE WHEN $2::uuid IS NULL THEN status ELSE 'IN_PROGRESS' END, updated_at = now() WHERE id = $1", [ticketId, assignedTo]);
    if (result.rowCount === 0) throw new NotFoundException("Ticket not found.");
    return { assignedTo };
  }

  async setStatus(ticketId: string, status: string) {
    const result = await this.database.query("UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1", [ticketId, status]);
    if (result.rowCount === 0) throw new NotFoundException("Ticket not found.");
    return { status };
  }
}
