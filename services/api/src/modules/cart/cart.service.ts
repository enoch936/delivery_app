import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import type { CartRecord } from "./cart.types.js";

type CartRow = { id: string; merchant_id: string; merchant_name: string; updated_at: Date };
type CartItemRow = {
  id: string;
  product_id: string;
  display_name: string;
  image_url: string | null;
  quantity: number;
  unit_price_minor: string;
  currency: string;
  base_price_minor: string;
  is_available: boolean;
  quantity_available: number | null;
};

@Injectable()
export class CartService {
  constructor(private readonly database: DatabaseService) {}

  async get(userId: string): Promise<CartRecord | { items: []; itemCount: 0 }> {
    const cartResult = await this.database.query<CartRow>(
      `SELECT c.id, c.merchant_id, m.display_name AS merchant_name, c.updated_at
       FROM carts c JOIN merchants m ON m.id = c.merchant_id
       WHERE c.user_id = $1 ORDER BY c.updated_at DESC LIMIT 1`,
      [userId]
    );
    const cart = cartResult.rows[0];
    if (!cart) return { items: [], itemCount: 0 };
    const items = await this.database.query<CartItemRow>(
      `SELECT ci.id, ci.product_id, p.display_name, p.image_url, ci.quantity, ci.unit_price_minor, ci.currency,
              p.base_price_minor, p.is_available, i.quantity_available
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE ci.cart_id = $1 ORDER BY ci.created_at ASC`,
      [cart.id]
    );
    return mapCart(cart, items.rows);
  }

  async addItem(userId: string, input: Readonly<{ productId: string; quantity: number }>): Promise<CartRecord> {
    return this.database.withTransaction(async (client) => {
      const product = await client.query<{ id: string; merchant_id: string; base_price_minor: string; currency: string; is_available: boolean; quantity_available: number | null; merchant_status: string }>(
        `SELECT p.id, p.merchant_id, p.base_price_minor, p.currency, p.is_available, i.quantity_available, m.status AS merchant_status
         FROM products p JOIN merchants m ON m.id = p.merchant_id
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE p.id = $1`,
        [input.productId]
      );
      const row = product.rows[0];
      if (!row) throw new NotFoundException("Product not found.");
      if (row.merchant_status !== "active" || !row.is_available) throw new ConflictException("This product is not currently available.");
      if (row.quantity_available !== null && input.quantity > row.quantity_available) throw new ConflictException("The requested quantity is not available.");
      const existingCart = await client.query<{ id: string; merchant_id: string }>("SELECT id, merchant_id FROM carts WHERE user_id = $1 FOR UPDATE", [userId]);
      let cart = existingCart.rows[0];
      if (cart && cart.merchant_id !== row.merchant_id) {
        throw new ConflictException("Your cart contains items from another merchant. Clear it before adding this product.");
      }
      if (!cart) {
        const created = await client.query<{ id: string; merchant_id: string }>(
          "INSERT INTO carts (user_id, merchant_id) VALUES ($1, $2) RETURNING id, merchant_id",
          [userId, row.merchant_id]
        );
        cart = created.rows[0];
        if (!cart) throw new Error("Cart creation failed.");
      }
      const item = await client.query<{ quantity: number }>(
        `INSERT INTO cart_items (cart_id, product_id, quantity, unit_price_minor, currency)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, unit_price_minor = EXCLUDED.unit_price_minor
         RETURNING quantity`,
        [cart.id, row.id, input.quantity, row.base_price_minor, row.currency]
      );
      const quantity = item.rows[0]?.quantity;
      if (quantity === undefined) throw new Error("Cart item update failed.");
      if (quantity > 99) throw new BadRequestException("A cart line cannot exceed 99 units.");
      if (row.quantity_available !== null && quantity > row.quantity_available) throw new ConflictException("The requested quantity is not available.");
      await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [cart.id]);
      return this.loadCart(client, cart.id);
    });
  }

  async updateItem(userId: string, itemId: string, quantity: number): Promise<CartRecord> {
    return this.database.withTransaction(async (client) => {
      const item = await client.query<{ cart_id: string; product_id: string; quantity_available: number | null; is_available: boolean }>(
        `SELECT ci.cart_id, ci.product_id, i.quantity_available, p.is_available
         FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
         JOIN products p ON p.id = ci.product_id LEFT JOIN inventory i ON i.product_id = p.id
         WHERE ci.id = $1 AND c.user_id = $2 FOR UPDATE`,
        [itemId, userId]
      );
      const row = item.rows[0];
      if (!row) throw new NotFoundException("Cart item not found.");
      if (quantity === 0) {
        await client.query("DELETE FROM cart_items WHERE id = $1", [itemId]);
      } else {
        if (!row.is_available) throw new ConflictException("This product is not currently available.");
        if (row.quantity_available !== null && quantity > row.quantity_available) throw new ConflictException("The requested quantity is not available.");
        await client.query("UPDATE cart_items SET quantity = $2 WHERE id = $1", [itemId, quantity]);
      }
      await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [row.cart_id]);
      return this.loadCart(client, row.cart_id);
    });
  }

  async clear(userId: string): Promise<void> {
    await this.database.query("DELETE FROM carts WHERE user_id = $1", [userId]);
  }

  private async loadCart(client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }> }, cartId: string): Promise<CartRecord> {
    const cartResult = await client.query(
      `SELECT c.id, c.merchant_id, m.display_name AS merchant_name, c.updated_at
       FROM carts c JOIN merchants m ON m.id = c.merchant_id WHERE c.id = $1`,
      [cartId]
    ) as { rows: CartRow[] };
    const cart = cartResult.rows[0];
    if (!cart) throw new NotFoundException("Cart not found.");
    const items = await client.query(
      `SELECT ci.id, ci.product_id, p.display_name, p.image_url, ci.quantity, ci.unit_price_minor, ci.currency,
              p.base_price_minor, p.is_available, i.quantity_available
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       LEFT JOIN inventory i ON i.product_id = p.id WHERE ci.cart_id = $1 ORDER BY ci.created_at ASC`,
      [cartId]
    ) as { rows: CartItemRow[] };
    return mapCart(cart, items.rows);
  }
}

function mapCart(cart: CartRow, items: readonly CartItemRow[]): CartRecord {
  const mapped = items.map((item) => {
    const unitPriceMinor = Number(item.base_price_minor);
    const stockIssue = !item.is_available ? "Unavailable" : item.quantity_available !== null && item.quantity > item.quantity_available ? "Insufficient stock" : null;
    return {
      id: item.id,
      productId: item.product_id,
      displayName: item.display_name,
      imageUrl: item.image_url,
      quantity: item.quantity,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * item.quantity,
      currency: item.currency,
      isAvailable: item.is_available,
      quantityAvailable: item.quantity_available,
      stockIssue
    };
  });
  return {
    id: cart.id,
    merchantId: cart.merchant_id,
    merchantName: cart.merchant_name,
    currency: mapped[0]?.currency ?? "ETB",
    items: mapped,
    itemsSubtotalMinor: mapped.reduce((sum, item) => sum + item.lineTotalMinor, 0),
    itemCount: mapped.reduce((sum, item) => sum + item.quantity, 0),
    updatedAt: cart.updated_at.toISOString()
  };
}
