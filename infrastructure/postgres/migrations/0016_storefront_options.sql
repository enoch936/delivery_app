BEGIN;

-- Storefront service terms and collection/scheduling capabilities.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS cancellation_policy text,
  ADD COLUMN IF NOT EXISTS refund_policy text,
  ADD COLUMN IF NOT EXISTS supports_pickup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_instructions text,
  ADD COLUMN IF NOT EXISTS allows_scheduling boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_schedule_lead_minutes integer NOT NULL DEFAULT 60
    CHECK (min_schedule_lead_minutes >= 0 AND min_schedule_lead_minutes <= 10080),
  ADD COLUMN IF NOT EXISTS max_schedule_days integer NOT NULL DEFAULT 3
    CHECK (max_schedule_days >= 0 AND max_schedule_days <= 30);

-- Product option groups cover both sellable variations (size, pack, storage)
-- and customisation (protein, spice level, extras).
CREATE TABLE IF NOT EXISTS product_option_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  selection_type text NOT NULL DEFAULT 'single' CHECK (selection_type IN ('single', 'multi')),
  is_required boolean NOT NULL DEFAULT false,
  min_selections integer NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections integer NOT NULL DEFAULT 1 CHECK (max_selections >= 1 AND max_selections <= 20),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, slug),
  CHECK (min_selections <= max_selections),
  CHECK (selection_type <> 'single' OR max_selections = 1)
);
CREATE INDEX IF NOT EXISTS product_option_groups_product_idx ON product_option_groups (product_id, sort_order);

CREATE TABLE IF NOT EXISTS product_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  sku text,
  display_name text NOT NULL,
  price_delta_minor bigint NOT NULL DEFAULT 0 CHECK (price_delta_minor >= 0),
  is_default boolean NOT NULL DEFAULT false,
  is_available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, sku)
);
CREATE INDEX IF NOT EXISTS product_options_group_idx ON product_options (group_id, sort_order);

-- Chosen options snapshot their label and price so a cart line stays
-- reproducible even after the merchant edits the menu.
CREATE TABLE IF NOT EXISTS cart_item_options (
  cart_item_id uuid NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES product_options(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  price_delta_minor bigint NOT NULL,
  PRIMARY KEY (cart_item_id, option_id)
);

-- Two lines of the same product may coexist when their options differ.
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS option_signature text NOT NULL DEFAULT '';
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_cart_id_product_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_line_idx
  ON cart_items (cart_id, product_id, option_signature);

-- A cart belongs to an account or to a device, never to both, and the device
-- cart is merged into the account cart on sign-in.
ALTER TABLE carts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE carts ADD COLUMN IF NOT EXISTS device_id text;
ALTER TABLE carts DROP CONSTRAINT IF EXISTS carts_user_id_merchant_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS carts_user_merchant_idx
  ON carts (user_id, merchant_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carts_device_merchant_idx
  ON carts (device_id, merchant_id) WHERE device_id IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carts_owner_check') THEN
    ALTER TABLE carts ADD CONSTRAINT carts_owner_check CHECK (user_id IS NOT NULL OR device_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS carts_updated_idx ON carts (updated_at DESC);

-- Fulfilment mode and scheduling are priced and snapshotted per quote/order.
ALTER TABLE checkout_quotes
  ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'delivery'
    CHECK (fulfillment_type IN ('delivery', 'pickup')),
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_location_id uuid REFERENCES merchant_locations(id);
ALTER TABLE checkout_quotes ALTER COLUMN delivery_address_id DROP NOT NULL;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'delivery'
    CHECK (fulfillment_type IN ('delivery', 'pickup')),
  ADD COLUMN IF NOT EXISTS pickup_location_id uuid REFERENCES merchant_locations(id);
ALTER TABLE orders ALTER COLUMN delivery_address_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_quotes_fulfillment_address_check') THEN
    ALTER TABLE checkout_quotes ADD CONSTRAINT checkout_quotes_fulfillment_address_check
      CHECK (fulfillment_type <> 'delivery' OR delivery_address_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_quotes_pickup_location_check') THEN
    ALTER TABLE checkout_quotes ADD CONSTRAINT checkout_quotes_pickup_location_check
      CHECK (fulfillment_type <> 'pickup' OR pickup_location_id IS NOT NULL);
  END IF;
END $$;

-- Display-friendly stock state, shared by browse, storefront and cart.
CREATE OR REPLACE FUNCTION catalog_stock_state(product_available boolean, quantity integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN product_available IS NOT TRUE THEN 'out_of_stock'
    WHEN quantity IS NULL THEN 'in_stock'
    WHEN quantity <= 0 THEN 'out_of_stock'
    WHEN quantity <= 5 THEN 'low_stock'
    ELSE 'in_stock'
  END;
$$;

COMMIT;
