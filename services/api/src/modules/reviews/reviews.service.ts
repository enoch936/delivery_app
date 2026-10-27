import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";

@Injectable()
export class ReviewsService {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, input: Readonly<{ orderId: string; merchantRating: number; courierRating: number | null; comment: string | null }>) {
    return this.database.withTransaction(async (client) => {
      const order = await client.query<{ id: string; merchant_id: string; courier_user_id: string | null; status: string }>(
        "SELECT id, merchant_id, courier_user_id, status FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [input.orderId, userId]
      );
      const row = order.rows[0];
      if (!row) throw new NotFoundException("Order not found.");
      if (row.status !== "DELIVERED") throw new ConflictException("Only delivered orders can be reviewed.");
      const existing = await client.query("SELECT 1 FROM reviews WHERE order_id = $1", [row.id]);
      if ((existing.rowCount ?? 0) > 0) throw new ConflictException("This order has already been reviewed.");
      const assignment = await client.query<{ courier_user_id: string }>(
        "SELECT courier_user_id FROM delivery_assignments WHERE order_id = $1 AND status = 'delivered' ORDER BY delivered_at DESC LIMIT 1", [row.id]
      );
      const courierUserId = assignment.rows[0]?.courier_user_id ?? row.courier_user_id;
      const review = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO reviews (order_id, user_id, merchant_id, courier_user_id, merchant_rating, courier_rating, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
        [row.id, userId, row.merchant_id, courierUserId, input.merchantRating, input.courierRating, input.comment]
      );
      await client.query(
        `UPDATE merchants SET rating_average = COALESCE((SELECT round(avg(merchant_rating)::numeric,2) FROM reviews WHERE merchant_id = $1),0),
                rating_count = (SELECT count(*) FROM reviews WHERE merchant_id = $1) WHERE id = $1`,
        [row.merchant_id]
      );
      if (courierUserId && input.courierRating !== null) {
        await client.query(
          `UPDATE courier_profiles SET rating_average = COALESCE((SELECT round(avg(courier_rating)::numeric,2) FROM reviews WHERE courier_user_id = $1 AND courier_rating IS NOT NULL),0)
           WHERE user_id = $1`,
          [courierUserId]
        );
      }
      return { id: review.rows[0]?.id, createdAt: review.rows[0]?.created_at.toISOString() };
    });
  }

  async mine(userId: string) {
    const result = await this.database.query(
      `SELECT r.id, r.order_id, o.order_number, r.merchant_rating, r.courier_rating, r.comment, r.created_at, m.display_name AS merchant_name
       FROM reviews r JOIN orders o ON o.id = r.order_id JOIN merchants m ON m.id = r.merchant_id
       WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
      [userId]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id as string, orderId: row.order_id as string, orderNumber: row.order_number as string,
        merchantName: row.merchant_name as string, merchantRating: row.merchant_rating as number,
        courierRating: row.courier_rating as number | null, comment: row.comment as string | null,
        createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async forMerchant(merchantId: string, limit: number, offset: number) {
    const [reviews, summary] = await Promise.all([
      this.database.query(
        `SELECT r.id, r.merchant_rating, r.courier_rating, r.comment, r.created_at, u.display_name AS customer_name
         FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.merchant_id = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
        [merchantId, limit, offset]
      ),
      this.database.query<{ average: string; count: number; distribution: Record<string, number> }>(
        `SELECT COALESCE(round(avg(merchant_rating)::numeric,2),0)::text AS average, count(*)::int AS count,
                jsonb_object_agg(merchant_rating, cnt) AS distribution
         FROM (SELECT merchant_rating, count(*)::int AS cnt FROM reviews WHERE merchant_id = $1 GROUP BY merchant_rating) x`,
        [merchantId]
      )
    ]);
    return {
      average: Number(summary.rows[0]?.average ?? 0), count: summary.rows[0]?.count ?? 0,
      distribution: summary.rows[0]?.distribution ?? {},
      items: reviews.rows.map((row) => ({
        id: row.id as string, merchantRating: row.merchant_rating as number, courierRating: row.courier_rating as number | null,
        comment: row.comment as string | null, customerName: row.customer_name as string | null,
        createdAt: (row.created_at as Date).toISOString()
      }))
    };
  }

  async remove(userId: string, reviewId: string) {
    return this.database.withTransaction(async (client) => {
      const result = await client.query<{ merchant_id: string; courier_user_id: string | null }>(
        "DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING merchant_id, courier_user_id",
        [reviewId, userId]
      );
      const row = result.rows[0];
      if (!row) throw new ForbiddenException("Review not found.");
      await client.query(
        `UPDATE merchants SET rating_average = COALESCE((SELECT round(avg(merchant_rating)::numeric,2) FROM reviews WHERE merchant_id = $1),0),
                rating_count = (SELECT count(*) FROM reviews WHERE merchant_id = $1) WHERE id = $1`,
        [row.merchant_id]
      );
      if (row.courier_user_id) {
        await client.query(
          `UPDATE courier_profiles SET rating_average = COALESCE((SELECT round(avg(courier_rating)::numeric,2) FROM reviews WHERE courier_user_id = $1 AND courier_rating IS NOT NULL),0)
           WHERE user_id = $1`,
          [row.courier_user_id]
        );
      }
      return { deleted: true };
    });
  }
}
