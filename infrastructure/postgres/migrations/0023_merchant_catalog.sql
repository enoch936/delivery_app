BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS prep_minutes integer NOT NULL DEFAULT 0
  CHECK (prep_minutes >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS products_merchant_archived_idx ON products (merchant_id, archived_at) WHERE archived_at IS NULL;

ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS product_categories_merchant_archived_idx ON product_categories (merchant_id, archived_at) WHERE archived_at IS NULL;

COMMIT;
