import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import type { CartIssueRecord, CartItemRecord, CartOwner, CartRecord, CartItemOptionRecord, ReconcileResult } from "./cart.types.js";

type QueryClient = Pick<DatabaseService, "query">;

type CartRow = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_slug: string;
  merchant_cover_image_url: string | null;
  supports_pickup: boolean;
  pickup_instructions: string | null;
  allows_scheduling: boolean;
  min_schedule_lead_minutes: number;
  max_schedule_days: number;
  cancellation_policy: string | null;
  refund_policy: string | null;
  updated_at: Date;
};

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
  stock_state: "in_stock" | "low_stock" | "out_of_stock";
  options_json: readonly CartItemOptionRecord[] | null;
};

type ProductRow = {
  id: string;
  merchant_id: string;
  base_price_minor: string;
  currency: string;
  is_available: boolean;
  quantity_available: number | null;
  merchant_status: string;
};

type OptionRow = {
  id: string;
  display_name: string;
  price_delta_minor: string;
  is_available: boolean;
  is_default: boolean;
  group_id: string;
  group_name: string;
  group_slug: string;
  selection_type: "single" | "multi";
  is_required: boolean;
  min_selections: number;
  max_selections: number;
};

@Injectable()
export class CartService {
  constructor(private readonly database: DatabaseService) {}

  async get(owner: CartOwner): Promise<CartRecord> {
    const cart = await this.findCartRow(this.database, owner);
    if (!cart) return emptyCart(owner);
    return this.loadCart(this.database, cart.id, owner);
  }

  async addItem(owner: CartOwner, input: Readonly<{ productId: string; quantity: number; optionIds?: readonly string[] }>): Promise<CartRecord> {
    const quantity = Math.trunc(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) throw new BadRequestException("A cart line must contain between 1 and 99 units.");
    return this.database.withTransaction(async (client) => {
      const product = await client.query<ProductRow>(
        `SELECT p.id, p.merchant_id, p.base_price_minor, p.currency, p.is_available, i.quantity_available, m.status AS merchant_status
         FROM products p JOIN merchants m ON m.id = p.merchant_id
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE p.id = $1`,
        [input.productId]
      );
      const row = product.rows[0];
      if (!row) throw new NotFoundException("Product not found.");
      if (row.merchant_status !== "active" || !row.is_available) throw new ConflictException("This product is not currently available.");
      if (row.quantity_available !== null && row.quantity_available <= 0) throw new ConflictException("This product is out of stock.");

      const resolved = await this.resolveOptions(client, row.id, input.optionIds);
      const unitPriceMinor = Number(row.base_price_minor) + resolved.priceDeltaTotalMinor;
      const available = row.quantity_available === null ? 99 : Math.min(99, row.quantity_available);

      const cart = await this.ensureCart(client, owner, row.merchant_id);
      const inserted = await client.query<{ id: string; quantity: number }>(
        `INSERT INTO cart_items (cart_id, product_id, quantity, unit_price_minor, currency, option_signature)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cart_id, product_id, option_signature)
           DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, unit_price_minor = EXCLUDED.unit_price_minor
         RETURNING id, quantity`,
        [cart.id, row.id, quantity, unitPriceMinor, row.currency, resolved.signature]
      );
      const line = inserted.rows[0];
      if (!line) throw new Error("Cart item update failed.");
      if (line.quantity > available) {
        throw new ConflictException(`Only ${available} unit${available === 1 ? "" : "s"} of this item are available right now.`);
      }
      for (const option of resolved.options) {
        await client.query(
          `INSERT INTO cart_item_options (cart_item_id, option_id, display_name, price_delta_minor)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (cart_item_id, option_id) DO UPDATE SET price_delta_minor = EXCLUDED.price_delta_minor`,
          [line.id, option.optionId, option.displayName, option.priceDeltaMinor]
        );
      }
      await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [cart.id]);
      return this.loadCart(client, cart.id, owner);
    });
  }

  async updateItem(owner: CartOwner, itemId: string, quantity: number): Promise<CartRecord> {
    const next = Math.trunc(quantity);
    if (!Number.isFinite(next) || next < 0 || next > 99) throw new BadRequestException("Quantity must be between 0 and 99.");
    return this.database.withTransaction(async (client) => {
      const item = await client.query<{
        cart_id: string;
        product_id: string;
        quantity: number;
        quantity_available: number | null;
        is_available: boolean;
        unavailable_options: number;
        required_group_missing: number;
      }>(
        `SELECT ci.cart_id, ci.product_id, ci.quantity, i.quantity_available, p.is_available,
                (SELECT count(*)::int FROM cart_item_options cio
                  JOIN product_options o ON o.id = cio.option_id
                  WHERE cio.cart_item_id = ci.id AND o.is_available = false) AS unavailable_options,
                (SELECT count(*)::int FROM product_option_groups g
                  WHERE g.product_id = ci.product_id AND g.is_required
                    AND (SELECT count(*) FROM cart_item_options cio2
                          JOIN product_options o2 ON o2.id = cio2.option_id
                          WHERE cio2.cart_item_id = ci.id AND o2.group_id = g.id) < GREATEST(g.min_selections, 1)) AS required_group_missing
         FROM cart_items ci
         JOIN carts c ON c.id = ci.cart_id
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE ci.id = $1 AND ${ownerPredicate(owner, "$2")}
         FOR UPDATE OF ci, c`,
        [itemId, ownerValue(owner)]
      );
      const row = item.rows[0];
      if (!row) throw new NotFoundException("Cart item not found.");
      if (next === 0) {
        await client.query("DELETE FROM cart_items WHERE id = $1", [itemId]);
        await this.releaseEmptyCart(client, row.cart_id);
        return this.loadCart(client, row.cart_id, owner);
      }
      if (!row.is_available) throw new ConflictException("This product is not currently available.");
      if (row.unavailable_options > 0) throw new ConflictException("An option on this item is no longer available. Remove the item and choose again.");
      if (row.required_group_missing > 0) throw new ConflictException("This item is missing a required option. Remove the item and choose again.");
      if (row.quantity_available !== null && next > row.quantity_available) throw new ConflictException(`Only ${row.quantity_available} unit${row.quantity_available === 1 ? "" : "s"} of this item are available right now.`);
      await client.query("UPDATE cart_items SET quantity = $2 WHERE id = $1", [itemId, next]);
      await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [row.cart_id]);
      return this.loadCart(client, row.cart_id, owner);
    });
  }

  async clear(owner: CartOwner): Promise<void> {
    await this.database.query(`DELETE FROM carts c WHERE ${ownerPredicate(owner, "$1")}`, [ownerValue(owner)]);
  }

  /**
   * Brings a stored cart back in line with live catalogue data: drops lines whose
   * product or chosen option disappeared, and trims quantities that exceed stock.
   */
  async reconcile(owner: CartOwner): Promise<ReconcileResult> {
    return this.database.withTransaction(async (client) => {
      const cart = await this.findCartRow(client, owner, true);
      if (!cart) return { cart: emptyCart(owner), issues: [] };
      const lines = await client.query<{
        id: string;
        product_id: string;
        display_name: string;
        quantity: number;
        is_available: boolean;
        merchant_active: boolean;
        quantity_available: number | null;
        unavailable_options: number;
        base_price_minor: string;
        unit_price_minor: string;
        option_delta_minor: string;
      }>(
        `SELECT ci.id, ci.product_id, p.display_name, ci.quantity, p.is_available, (m.status = 'active') AS merchant_active,
                i.quantity_available, p.base_price_minor, ci.unit_price_minor,
                (SELECT COALESCE(sum(cio.price_delta_minor), 0)::text FROM cart_item_options cio WHERE cio.cart_item_id = ci.id) AS option_delta_minor,
                (SELECT count(*)::int FROM cart_item_options cio
                  JOIN product_options o ON o.id = cio.option_id
                  WHERE cio.cart_item_id = ci.id AND o.is_available = false) AS unavailable_options
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN merchants m ON m.id = p.merchant_id
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE ci.cart_id = $1
         FOR UPDATE OF ci`,
        [cart.id]
      );
      const issues: CartIssueRecord[] = [];
      for (const line of lines.rows) {
        const removedReason = !line.is_available || !line.merchant_active || line.unavailable_options > 0
          ? line.unavailable_options > 0 ? "option_unavailable" : "removed_out_of_stock"
          : line.quantity_available !== null && line.quantity_available <= 0
            ? "removed_out_of_stock"
            : null;
        if (removedReason) {
          await client.query("DELETE FROM cart_items WHERE id = $1", [line.id]);
          issues.push({
            code: removedReason,
            productId: line.product_id,
            displayName: line.display_name,
            message: removedReason === "option_unavailable"
              ? `${line.display_name} was removed because one of its options is no longer available.`
              : `${line.display_name} was removed because it is no longer available.`,
            previousQuantity: line.quantity,
            quantity: 0
          });
          continue;
        }
        const expectedUnitPrice = Number(line.base_price_minor) + Number(line.option_delta_minor);
        if (expectedUnitPrice !== Number(line.unit_price_minor)) {
          await client.query("UPDATE cart_items SET unit_price_minor = $2 WHERE id = $1", [line.id, expectedUnitPrice]);
          issues.push({
            code: "price_changed",
            productId: line.product_id,
            displayName: line.display_name,
            message: `The price of ${line.display_name} was updated to ${(expectedUnitPrice / 100).toFixed(2)}.`,
            previousQuantity: line.quantity,
            quantity: line.quantity
          });
        }
        if (line.quantity_available !== null && line.quantity > line.quantity_available) {
          await client.query("UPDATE cart_items SET quantity = $2 WHERE id = $1", [line.id, line.quantity_available]);
          issues.push({
            code: "quantity_reduced",
            productId: line.product_id,
            displayName: line.display_name,
            message: `${line.display_name} was reduced to ${line.quantity_available} because only that many are left.`,
            previousQuantity: line.quantity,
            quantity: line.quantity_available
          });
        }
      }
      if (issues.length > 0) await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [cart.id]);
      await this.releaseEmptyCart(client, cart.id);
      const refreshed = await this.findCartRow(client, owner);
      if (!refreshed) return { cart: emptyCart(owner), issues };
      return { cart: await this.loadCart(client, refreshed.id, owner), issues };
    });
  }

  /**
   * On sign-in the device cart is folded into the account cart. The account cart
   * wins when both exist for different merchants; identical lines are combined.
   */
  async merge(owner: Readonly<{ userId: string }> & { deviceId: string | null }): Promise<CartRecord> {
    return this.database.withTransaction(async (client) => {
      const accountOwner: CartOwner = { userId: owner.userId, deviceId: null };
      if (!owner.deviceId) {
        const existing = await this.findCartRow(client, accountOwner);
        return existing ? this.loadCart(client, existing.id, accountOwner) : emptyCart(accountOwner);
      }
      const deviceCart = await this.findCartRow(client, { userId: null, deviceId: owner.deviceId }, true);
      if (!deviceCart) {
        const existing = await this.findCartRow(client, accountOwner);
        return existing ? this.loadCart(client, existing.id, accountOwner) : emptyCart(accountOwner);
      }
      const accountCart = await this.findCartRow(client, accountOwner, true);
      if (!accountCart) {
        await client.query("UPDATE carts SET user_id = $1, device_id = NULL, updated_at = now() WHERE id = $2", [owner.userId, deviceCart.id]);
        return this.loadCart(client, deviceCart.id, accountOwner);
      }
      if (accountCart.merchant_id === deviceCart.merchant_id) {
        const deviceLines = await client.query<{ id: string; product_id: string; quantity: number; unit_price_minor: string; currency: string; option_signature: string }>(
          "SELECT id, product_id, quantity, unit_price_minor, currency, option_signature FROM cart_items WHERE cart_id = $1 FOR UPDATE",
          [deviceCart.id]
        );
        for (const line of deviceLines.rows) {
          const moved = await client.query<{ id: string }>(
            `INSERT INTO cart_items (cart_id, product_id, quantity, unit_price_minor, currency, option_signature)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (cart_id, product_id, option_signature)
               DO UPDATE SET quantity = LEAST(99, cart_items.quantity + EXCLUDED.quantity)
             RETURNING id`,
            [accountCart.id, line.product_id, line.quantity, line.unit_price_minor, line.currency, line.option_signature]
          );
          const target = moved.rows[0];
          if (target) {
            await client.query(
              `INSERT INTO cart_item_options (cart_item_id, option_id, display_name, price_delta_minor)
               SELECT $1, option_id, display_name, price_delta_minor FROM cart_item_options WHERE cart_item_id = $2
               ON CONFLICT (cart_item_id, option_id) DO NOTHING`,
              [target.id, line.id]
            );
          }
        }
        await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [accountCart.id]);
      }
      await client.query("DELETE FROM carts WHERE id = $1", [deviceCart.id]);
      return this.loadCart(client, accountCart.id, accountOwner);
    });
  }

  /**
   * Validates the chosen options against the product's groups. When no selection
   * is supplied at all (quick add), required groups fall back to their default
   * option so the line is still complete and priced correctly.
   */
  private async resolveOptions(client: QueryClient, productId: string, optionIds: readonly string[] | undefined): Promise<{
    options: CartItemOptionRecord[];
    signature: string;
    priceDeltaTotalMinor: number;
  }> {
    const explicit = optionIds !== undefined;
    const requested = [...new Set(optionIds ?? [])];
    if (requested.length > 40) throw new BadRequestException("Too many options were selected.");
    const groups = await client.query<OptionRow>(
      `SELECT o.id, o.display_name, o.price_delta_minor, o.is_available, COALESCE(o.is_default, false) AS is_default,
              g.id AS group_id, g.display_name AS group_name, g.slug AS group_slug,
              g.selection_type, g.is_required, g.min_selections, g.max_selections
       FROM product_option_groups g
       LEFT JOIN product_options o ON o.group_id = g.id
       WHERE g.product_id = $1
       ORDER BY g.sort_order ASC, g.display_name ASC, o.sort_order ASC, o.display_name ASC`,
      [productId]
    );
    if (groups.rows.length === 0) {
      if (requested.length > 0) throw new BadRequestException("This product has no selectable options.");
      return { options: [], signature: "", priceDeltaTotalMinor: 0 };
    }
    const byId = new Map<string, OptionRow>();
    for (const row of groups.rows) if (row.id) byId.set(row.id, row);
    const unique = [...requested];
    if (!explicit) {
      const defaults = new Map<string, OptionRow>();
      for (const row of groups.rows) {
        if (!row.id || !row.group_id || row.is_available === false) continue;
        const current = defaults.get(row.group_id);
        if (!current || (row.is_default && !current.is_default)) defaults.set(row.group_id, row);
      }
      for (const row of groups.rows) {
        if (!row.group_id || row.is_required !== true) continue;
        const chosen = defaults.get(row.group_id);
        if (chosen && !unique.includes(chosen.id)) unique.push(chosen.id);
      }
    }
    const selected: OptionRow[] = [];
    for (const id of unique) {
      const option = byId.get(id);
      if (!option) throw new BadRequestException("One of the selected options does not belong to this product.");
      if (!option.is_available) throw new ConflictException(`The option "${option.display_name}" is no longer available.`);
      selected.push(option);
    }
    const requiredGroups = new Map<string, OptionRow>();
    for (const row of groups.rows) {
      if (row.group_id) requiredGroups.set(row.group_id, row);
    }
    for (const [groupId, group] of requiredGroups) {
      const chosen = selected.filter((option) => option.group_id === groupId);
      const minimum = group.is_required ? Math.max(1, group.min_selections) : group.min_selections;
      if (chosen.length < minimum) throw new BadRequestException(`Choose ${minimum === 1 ? "an option" : `${minimum} options`} for "${group.group_name}".`);
      if (chosen.length > group.max_selections) throw new BadRequestException(`"${group.group_name}" allows at most ${group.max_selections} selection${group.max_selections === 1 ? "" : "s"}.`);
    }
    const signature = selected.map((option) => option.id).sort().join(",");
    const options = selected
      .slice()
      .sort((a, b) => a.group_name.localeCompare(b.group_name) || a.display_name.localeCompare(b.display_name))
      .map((option) => ({ optionId: option.id, displayName: option.display_name, priceDeltaMinor: Number(option.price_delta_minor) }));
    return {
      options,
      signature,
      priceDeltaTotalMinor: options.reduce((sum, option) => sum + option.priceDeltaMinor, 0)
    };
  }

  private async ensureCart(client: QueryClient, owner: CartOwner, merchantId: string): Promise<{ id: string; merchant_id: string }> {
    const existing = await client.query<{ id: string; merchant_id: string }>(
      `SELECT c.id, c.merchant_id FROM carts c WHERE ${ownerPredicate(owner, "$1")} ORDER BY c.updated_at DESC LIMIT 1 FOR UPDATE`,
      [ownerValue(owner)]
    );
    const cart = existing.rows[0];
    if (cart && cart.merchant_id !== merchantId) {
      throw new ConflictException("Your cart contains items from another merchant. Clear it before adding this product.");
    }
    if (cart) return cart;
    const created = await client.query<{ id: string; merchant_id: string }>(
      "INSERT INTO carts (user_id, device_id, merchant_id) VALUES ($1, $2, $3) RETURNING id, merchant_id",
      [owner.userId, owner.userId ? null : owner.deviceId, merchantId]
    );
    const row = created.rows[0];
    if (!row) throw new Error("Cart creation failed.");
    return row;
  }

  private async findCartRow(client: QueryClient, owner: CartOwner, forUpdate = false): Promise<CartRow | null> {
    const result = await client.query<CartRow>(
      `SELECT c.id, c.merchant_id, m.display_name AS merchant_name, m.slug AS merchant_slug,
              m.cover_image_url AS merchant_cover_image_url, m.supports_pickup, m.pickup_instructions,
              m.allows_scheduling, m.min_schedule_lead_minutes, m.max_schedule_days,
              m.cancellation_policy, m.refund_policy, c.updated_at
       FROM carts c JOIN merchants m ON m.id = c.merchant_id
       WHERE ${ownerPredicate(owner, "$1")}
       ORDER BY c.updated_at DESC LIMIT 1${forUpdate ? " FOR UPDATE OF c" : ""}`,
      [ownerValue(owner)]
    );
    return result.rows[0] ?? null;
  }

  private async releaseEmptyCart(client: QueryClient, cartId: string): Promise<void> {
    const remaining = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM cart_items WHERE cart_id = $1", [cartId]);
    if (Number(remaining.rows[0]?.count ?? "0") === 0) {
      await client.query("DELETE FROM carts WHERE id = $1", [cartId]);
    }
  }

  private async loadCart(client: QueryClient, cartId: string, owner: CartOwner): Promise<CartRecord> {
    const cartResult = await client.query<CartRow>(
      `SELECT c.id, c.merchant_id, m.display_name AS merchant_name, m.slug AS merchant_slug,
              m.cover_image_url AS merchant_cover_image_url, m.supports_pickup, m.pickup_instructions,
              m.allows_scheduling, m.min_schedule_lead_minutes, m.max_schedule_days,
              m.cancellation_policy, m.refund_policy, c.updated_at
       FROM carts c JOIN merchants m ON m.id = c.merchant_id WHERE c.id = $1`,
      [cartId]
    );
    const cart = cartResult.rows[0];
    if (!cart) return emptyCart(owner);
    const items = await client.query<CartItemRow>(
      `SELECT ci.id, ci.product_id, p.display_name, p.image_url, ci.quantity, ci.unit_price_minor, ci.currency,
              p.base_price_minor, p.is_available, i.quantity_available,
              catalog_stock_state(p.is_available, i.quantity_available) AS stock_state,
              COALESCE((
                SELECT json_agg(json_build_object('optionId', cio.option_id, 'displayName', cio.display_name, 'priceDeltaMinor', cio.price_delta_minor) ORDER BY cio.display_name)
                FROM cart_item_options cio WHERE cio.cart_item_id = ci.id
              ), '[]'::json) AS options_json
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       LEFT JOIN inventory i ON i.product_id = p.id WHERE ci.cart_id = $1 ORDER BY ci.created_at ASC`,
      [cartId]
    );
    return mapCart(cart, items.rows, owner);
  }
}

function mapCart(cart: CartRow, items: readonly CartItemRow[], owner: CartOwner): CartRecord {
  const mapped: CartItemRecord[] = items.map((item) => {
    const unitPriceMinor = Number(item.unit_price_minor);
    const options = (item.options_json ?? []).map((option) => ({
      optionId: option.optionId,
      displayName: option.displayName,
      priceDeltaMinor: Number(option.priceDeltaMinor)
    }));
    const maxQuantity = item.quantity_available === null ? 99 : Math.max(0, Math.min(99, item.quantity_available));
    const stockIssue = !item.is_available
      ? "Unavailable"
      : item.quantity_available !== null && item.quantity > item.quantity_available
        ? "Insufficient stock"
        : null;
    return {
      id: item.id,
      productId: item.product_id,
      displayName: item.display_name,
      imageUrl: item.image_url,
      quantity: item.quantity,
      basePriceMinor: Number(item.base_price_minor),
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * item.quantity,
      currency: item.currency,
      options,
      optionsLabel: options.map((option) => option.displayName).join(" · "),
      isAvailable: item.is_available && maxQuantity > 0,
      quantityAvailable: item.quantity_available,
      maxQuantity,
      stockState: item.stock_state ?? (item.is_available ? "in_stock" : "out_of_stock"),
      stockIssue
    };
  });
  return {
    id: cart.id,
    merchantId: cart.merchant_id,
    merchantName: cart.merchant_name,
    merchantSlug: cart.merchant_slug,
    merchantCoverImageUrl: cart.merchant_cover_image_url,
    currency: mapped[0]?.currency ?? "ETB",
    items: mapped,
    itemsSubtotalMinor: mapped.reduce((sum, item) => sum + item.lineTotalMinor, 0),
    itemCount: mapped.reduce((sum, item) => sum + item.quantity, 0),
    updatedAt: cart.updated_at.toISOString(),
    fulfillment: {
      supportsPickup: cart.supports_pickup,
      pickupInstructions: cart.pickup_instructions,
      allowsScheduling: cart.allows_scheduling,
      minScheduleLeadMinutes: cart.min_schedule_lead_minutes,
      maxScheduleDays: cart.max_schedule_days
    },
    policy: { cancellationPolicy: cart.cancellation_policy, refundPolicy: cart.refund_policy },
    owner: { type: owner.userId ? "account" : "device", deviceId: owner.userId ? null : owner.deviceId }
  };
}

function emptyCart(owner: CartOwner): CartRecord {
  return {
    id: null,
    merchantId: null,
    merchantName: null,
    merchantSlug: null,
    merchantCoverImageUrl: null,
    currency: "ETB",
    items: [],
    itemsSubtotalMinor: 0,
    itemCount: 0,
    updatedAt: new Date(0).toISOString(),
    fulfillment: {
      supportsPickup: false,
      pickupInstructions: null,
      allowsScheduling: false,
      minScheduleLeadMinutes: 60,
      maxScheduleDays: 3
    },
    policy: { cancellationPolicy: null, refundPolicy: null },
    owner: { type: owner.userId ? "account" : "device", deviceId: owner.userId ? null : owner.deviceId }
  };
}

function ownerValue(owner: CartOwner): string {
  return owner.userId ?? owner.deviceId ?? "";
}

function ownerPredicate(owner: CartOwner, index: string): string {
  return owner.userId
    ? `c.user_id = ${index}`
    : `c.user_id IS NULL AND c.device_id = ${index} AND ${index} <> ''`;
}
