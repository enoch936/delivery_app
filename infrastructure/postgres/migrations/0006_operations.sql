DO $$ BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'operations';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'finance';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'business_admin';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

BEGIN;

-- ---------------------------------------------------------------------------
-- Profiles, favorites and customer preferences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_locale text NOT NULL DEFAULT 'en-ET',
  marketing_consent boolean NOT NULL DEFAULT false,
  analytics_consent boolean NOT NULL DEFAULT false,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_product_idx
  ON favorites (user_id, merchant_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS favorites_merchant_only_idx
  ON favorites (user_id, merchant_id) WHERE product_id IS NULL;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  order_updates boolean NOT NULL DEFAULT true,
  promotions boolean NOT NULL DEFAULT false,
  security_alerts boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Order extensions
-- ---------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_location_id uuid REFERENCES merchant_locations(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lat double precision;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lng double precision;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_minor bigint NOT NULL DEFAULT 0 CHECK (tip_minor >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'UNPAID'
  CHECK (payment_status IN ('UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','chapa','telebirr','sandbox'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_otp_hash text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_proof_required boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_note text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_user_id uuid;


ALTER TABLE order_items ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS tip_minor bigint NOT NULL DEFAULT 0 CHECK (tip_minor >= 0);
ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0);
ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS distance_meters integer;
ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS distance_source text NOT NULL DEFAULT 'straight_line'
  CHECK (distance_source IN ('straight_line', 'road_network'));
ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS delivery_estimate_minutes integer;
ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS promotion_id uuid;
ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS pricing_rule_id uuid;
ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS service_category_slug text;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS distance_meters integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_estimate_minutes integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address_snapshot jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_name_snapshot text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS commission_bps integer NOT NULL DEFAULT 1500 CHECK (commission_bps BETWEEN 0 AND 10000);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS rating_average numeric(3,2) NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_merchant_status_idx ON orders (merchant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_courier_idx ON orders (courier_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Courier domain
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courier_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  full_name text,
  vehicle_type text NOT NULL DEFAULT 'motorcycle'
    CHECK (vehicle_type IN ('walking', 'bicycle', 'motorcycle', 'car', 'van')),
  vehicle_plate text,
  service_zone_id uuid REFERENCES service_zones(id),
  capacity_units integer NOT NULL DEFAULT 1 CHECK (capacity_units BETWEEN 1 AND 50),
  rejection_reason text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  rating_average numeric(3,2) NOT NULL DEFAULT 0,
  completed_deliveries integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_profiles_status_idx ON courier_profiles (status);

CREATE TABLE IF NOT EXISTS courier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('national_id', 'driving_license', 'vehicle_registration', 'insurance', 'profile_photo')),
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id),
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_documents_courier_idx ON courier_documents (courier_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS courier_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL,
  plate_number text,
  make_model text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courier_availability (
  courier_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_online boolean NOT NULL DEFAULT false,
  accepting_offers boolean NOT NULL DEFAULT true,
  last_location geometry(Point, 4326),
  last_seen_at timestamptz,
  active_order_id uuid REFERENCES orders(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_availability_online_idx ON courier_availability (is_online, accepting_offers);
CREATE INDEX IF NOT EXISTS courier_availability_location_idx ON courier_availability USING gist (last_location);

CREATE TABLE IF NOT EXISTS delivery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  courier_user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'accepted', 'arrived_pickup', 'picked_up', 'delivered', 'cancelled', 'failed')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  distance_to_pickup_meters integer,
  estimated_pickup_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_assignments_one_active_per_order
  ON delivery_assignments (order_id)
  WHERE status IN ('offered', 'accepted', 'arrived_pickup', 'picked_up');
CREATE INDEX IF NOT EXISTS delivery_assignments_courier_idx ON delivery_assignments (courier_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES delivery_assignments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  courier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  score numeric(10,4) NOT NULL DEFAULT 0,
  distance_to_pickup_meters integer,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, courier_user_id),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS dispatch_offers_courier_pending_idx ON dispatch_offers (courier_user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS courier_location_samples (
  id bigserial PRIMARY KEY,
  courier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES delivery_assignments(id) ON DELETE SET NULL,
  location geometry(Point, 4326) NOT NULL,
  accuracy_meters numeric(8,2),
  heading_degrees numeric(6,2),
  speed_mps numeric(8,2),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_location_samples_courier_idx ON courier_location_samples (courier_user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS courier_location_samples_order_idx ON courier_location_samples (order_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS courier_location_samples_location_idx ON courier_location_samples USING gist (location);

CREATE TABLE IF NOT EXISTS delivery_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES delivery_assignments(id) ON DELETE SET NULL,
  proof_type text NOT NULL CHECK (proof_type IN ('otp', 'photo', 'signature', 'merchant_handoff', 'customer_handoff')),
  storage_key text,
  recipient_name text,
  notes text,
  captured_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_proofs_order_idx ON delivery_proofs (order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  provider_reference text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  checkout_url text,
  idempotency_key text,
  expires_at timestamptz,
  paid_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  status text NOT NULL,
  provider_reference text,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  provider_reference text,
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_status_idx ON refunds (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'revenue', 'expense', 'equity')),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference_type, reference_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id),
  side text NOT NULL CHECK (side IN ('debit', 'credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx ON ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS merchant_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  gross_sales_minor bigint NOT NULL DEFAULT 0,
  commission_minor bigint NOT NULL DEFAULT 0,
  refunds_minor bigint NOT NULL DEFAULT 0,
  net_payable_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'FAILED')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS courier_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  gross_earnings_minor bigint NOT NULL DEFAULT 0,
  deductions_minor bigint NOT NULL DEFAULT 0,
  tips_minor bigint NOT NULL DEFAULT 0,
  net_payable_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'FAILED')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS order_financials (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  merchant_gross_minor bigint NOT NULL DEFAULT 0,
  commission_minor bigint NOT NULL DEFAULT 0,
  courier_earning_minor bigint NOT NULL DEFAULT 0,
  platform_revenue_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  tip_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Pricing, promotions and reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES cities(id) ON DELETE CASCADE,
  service_category_slug text,
  base_delivery_fee_minor bigint NOT NULL CHECK (base_delivery_fee_minor >= 0),
  per_km_fee_minor bigint NOT NULL DEFAULT 0 CHECK (per_km_fee_minor >= 0),
  minimum_delivery_fee_minor bigint NOT NULL DEFAULT 0 CHECK (minimum_delivery_fee_minor >= 0),
  maximum_delivery_fee_minor bigint NOT NULL CHECK (maximum_delivery_fee_minor >= 0),
  service_fee_minor bigint NOT NULL DEFAULT 0 CHECK (service_fee_minor >= 0),
  night_surcharge_minor bigint NOT NULL DEFAULT 0 CHECK (night_surcharge_minor >= 0),
  commission_bps integer NOT NULL DEFAULT 1500 CHECK (commission_bps BETWEEN 0 AND 10000),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (maximum_delivery_fee_minor >= minimum_delivery_fee_minor)
);

CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code = upper(code)),
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PERCENT', 'FIXED')),
  value integer NOT NULL CHECK (value > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  minimum_order_minor bigint NOT NULL DEFAULT 0 CHECK (minimum_order_minor >= 0),
  maximum_discount_minor bigint,
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
  usage_limit integer,
  per_user_limit integer NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'PERCENT' OR value <= 100),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, order_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  courier_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  merchant_rating smallint NOT NULL CHECK (merchant_rating BETWEEN 1 AND 5),
  courier_rating smallint CHECK (courier_rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_merchant_idx ON reviews (merchant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Messaging, notifications and support
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('order', 'support')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'participant',
  last_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app', 'push', 'sms', 'email')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
  error_message text,
  attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Business accounts and fleet
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  billing_email citext,
  billing_phone_e164 text,
  tax_identifier text,
  monthly_spend_limit_minor bigint,
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = upper(currency)),
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_members (
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner', 'admin', 'member', 'driver')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_account_id, user_id)
);
CREATE INDEX IF NOT EXISTS business_members_user_idx ON business_members (user_id);

CREATE TABLE IF NOT EXISTS business_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  label text NOT NULL,
  address_line text NOT NULL,
  contact_name text,
  contact_phone_e164 text,
  location geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_orders (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  cost_center text,
  reference_code text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_orders_account_idx ON business_orders (business_account_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Feature flags and outbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key text PRIMARY KEY,
  description text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx ON outbox_events (available_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_events_aggregate_idx ON outbox_events (aggregate_type, aggregate_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_transactions_reference_idx
  ON ledger_transactions (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS orders_active_idx ON orders (status, updated_at DESC)
  WHERE status NOT IN ('DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED');

INSERT INTO ledger_accounts (code, display_name, account_type, currency) VALUES
  ('payment_clearing', 'Payment clearing', 'asset', 'ETB'),
  ('customer_receivable', 'Customer receivable', 'asset', 'ETB'),
  ('merchant_payable', 'Merchant payable', 'liability', 'ETB'),
  ('courier_payable', 'Courier payable', 'liability', 'ETB'),
  ('tips_payable', 'Tips payable', 'liability', 'ETB'),
  ('platform_revenue', 'Platform revenue', 'revenue', 'ETB'),
  ('tax_payable', 'Tax payable', 'liability', 'ETB'),
  ('discount_expense', 'Discount expense', 'expense', 'ETB'),
  ('refund_expense', 'Refund expense', 'expense', 'ETB')
ON CONFLICT (code) DO NOTHING;

INSERT INTO feature_flags (flag_key, description, is_enabled) VALUES
  ('scheduled_orders', 'Allow customers to schedule eligible orders.', true),
  ('customer_tips', 'Expose optional courier tips during checkout.', true),
  ('promotions', 'Allow promotion redemption during checkout.', true),
  ('business_accounts', 'Enable business account workflows.', true),
  ('live_tracking', 'Show persisted courier location to the order owner.', true)
ON CONFLICT (flag_key) DO NOTHING;

DROP TRIGGER IF EXISTS user_profiles_set_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_set_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS courier_profiles_set_updated_at ON courier_profiles;
CREATE TRIGGER courier_profiles_set_updated_at BEFORE UPDATE ON courier_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS payments_set_updated_at ON payments;
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS refunds_set_updated_at ON refunds;
CREATE TRIGGER refunds_set_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS support_tickets_set_updated_at ON support_tickets;
CREATE TRIGGER support_tickets_set_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS business_accounts_set_updated_at ON business_accounts;
CREATE TRIGGER business_accounts_set_updated_at BEFORE UPDATE ON business_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;






