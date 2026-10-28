BEGIN;

-- ---------------------------------------------------------------------------
-- Ledger hardening: append-only entries and deferred balance validation
-- ---------------------------------------------------------------------------
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS ledger_transactions_append_only ON ledger_transactions;
CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE OR REPLACE FUNCTION assert_ledger_transaction_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_id uuid;
  debit_total numeric;
  credit_total numeric;
  currency_count integer;
  entry_count integer;
BEGIN
  target_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT
    COALESCE(sum(amount_minor) FILTER (WHERE side = 'debit'), 0),
    COALESCE(sum(amount_minor) FILTER (WHERE side = 'credit'), 0),
    count(DISTINCT currency),
    count(*)
  INTO debit_total, credit_total, currency_count, entry_count
  FROM ledger_entries
  WHERE transaction_id = target_id;

  IF entry_count = 0 THEN
    RETURN NULL;
  END IF;
  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'Ledger transaction % is not balanced (debit %, credit %)', target_id, debit_total, credit_total;
  END IF;
  IF currency_count <> 1 THEN
    RAISE EXCEPTION 'Ledger transaction % mixes currencies', target_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_transaction_entries();

CREATE OR REPLACE FUNCTION assert_ledger_transaction_not_empty() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = NEW.id) THEN
    RAISE EXCEPTION 'Ledger transaction % has no entries', NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_transactions_not_empty ON ledger_transactions;
CREATE CONSTRAINT TRIGGER ledger_transactions_not_empty
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_transaction_not_empty();

CREATE INDEX IF NOT EXISTS ledger_transactions_created_idx
  ON ledger_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_account_currency_idx
  ON ledger_entries (account_id, currency, created_at DESC);

-- ---------------------------------------------------------------------------
-- Versioned commission rules and immutable application snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'merchant', 'category')),
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
  service_category_slug text,
  rate_bps integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  fixed_fee_minor bigint NOT NULL DEFAULT 0 CHECK (fixed_fee_minor >= 0),
  minimum_fee_minor bigint NOT NULL DEFAULT 0 CHECK (minimum_fee_minor >= 0),
  maximum_fee_minor bigint CHECK (maximum_fee_minor IS NULL OR maximum_fee_minor >= minimum_fee_minor),
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = upper(currency)),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (scope <> 'merchant' OR merchant_id IS NOT NULL),
  CHECK (scope <> 'category' OR service_category_slug IS NOT NULL),
  CHECK (scope = 'merchant' OR merchant_id IS NULL),
  CHECK (scope = 'category' OR service_category_slug IS NULL)
);
CREATE INDEX IF NOT EXISTS commission_rules_active_idx
  ON commission_rules (scope, merchant_id, service_category_slug, effective_from DESC)
  WHERE is_active = true;

ALTER TABLE order_financials
  ADD COLUMN IF NOT EXISTS commission_rule_id uuid REFERENCES commission_rules(id),
  ADD COLUMN IF NOT EXISTS commission_rate_bps integer CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS commission_base_minor bigint CHECK (commission_base_minor IS NULL OR commission_base_minor >= 0),
  ADD COLUMN IF NOT EXISTS provider_fee_minor bigint NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS financial_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  merchant_id uuid REFERENCES merchants(id) ON DELETE RESTRICT,
  courier_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('commission', 'fee', 'refund', 'penalty', 'bonus', 'dispute', 'correction')),
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'APPLIED', 'REJECTED')),
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  applied_at timestamptz,
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ledger_transaction_id IS NULL OR status = 'APPLIED')
);
CREATE INDEX IF NOT EXISTS financial_adjustments_status_idx
  ON financial_adjustments (status, created_at ASC);
CREATE INDEX IF NOT EXISTS financial_adjustments_order_idx
  ON financial_adjustments (order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Provider references, fee snapshots and idempotent refunds
-- ---------------------------------------------------------------------------
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_merchant_reference text,
  ADD COLUMN IF NOT EXISTS provider_fee_minor bigint NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_merchant_reference_idx
  ON payments (provider, provider_merchant_reference)
  WHERE provider_merchant_reference IS NOT NULL;

ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS provider_merchant_reference text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS failure_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_provider_merchant_reference_idx
  ON refunds (payment_id, provider_merchant_reference)
  WHERE provider_merchant_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_payment_idempotency_idx
  ON refunds (payment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE payment_webhook_events ADD COLUMN IF NOT EXISTS payload_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_events_payload_hash_idx
  ON payment_webhook_events (provider, payload_hash)
  WHERE payload_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Cash on delivery custody and reconciliation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cod_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  courier_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COLLECTED', 'REMITTED', 'RECONCILED', 'FAILED')),
  collected_at timestamptz,
  remitted_at timestamptz,
  remitted_by uuid REFERENCES users(id),
  remittance_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cod_collections_status_idx
  ON cod_collections (status, created_at ASC);
CREATE INDEX IF NOT EXISTS cod_collections_courier_idx
  ON cod_collections (courier_user_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Tokenised payout destinations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('merchant', 'courier', 'business')),
  owner_id uuid NOT NULL,
  provider text NOT NULL,
  provider_account_reference text,
  bank_slug text,
  account_name text NOT NULL,
  account_number_last4 char(4),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'DISABLED', 'REJECTED')),
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider_account_reference IS NOT NULL OR (bank_slug IS NOT NULL AND account_number_last4 IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_accounts_one_default_idx
  ON payout_accounts (owner_type, owner_id, currency)
  WHERE is_default = true AND status = 'VERIFIED';
CREATE INDEX IF NOT EXISTS payout_accounts_owner_idx
  ON payout_accounts (owner_type, owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_reference text,
  idempotency_key text NOT NULL,
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  item_count integer NOT NULL CHECK (item_count > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED')),
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, idempotency_key)
);
CREATE INDEX IF NOT EXISTS payout_batches_status_idx
  ON payout_batches (status, created_at ASC);

CREATE TABLE IF NOT EXISTS payout_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
  settlement_kind text NOT NULL CHECK (settlement_kind IN ('merchant', 'courier')),
  settlement_id uuid NOT NULL,
  payout_account_id uuid NOT NULL REFERENCES payout_accounts(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  provider_reference text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_kind, settlement_id)
);
CREATE INDEX IF NOT EXISTS payout_batch_items_batch_idx
  ON payout_batch_items (batch_id, status);

-- ---------------------------------------------------------------------------
-- Subscriptions and invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code = lower(code)),
  name text NOT NULL,
  description text,
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  included_deliveries integer CHECK (included_deliveries IS NULL OR included_deliveries >= 0),
  discount_bps integer NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  business_account_id uuid REFERENCES business_accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_reference text,
  status text NOT NULL DEFAULT 'TRIALING'
    CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end > current_period_start),
  CHECK ((user_id IS NOT NULL) <> (business_account_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx
  ON subscriptions (user_id, status, current_period_end DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_business_idx
  ON subscriptions (business_account_id, status, current_period_end DESC)
  WHERE business_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'VOID', 'REFUNDED')),
  provider_reference text,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_invoices_subscription_idx
  ON subscription_invoices (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_invoices_open_idx
  ON subscription_invoices (status, due_at)
  WHERE status = 'OPEN';

INSERT INTO ledger_accounts (code, display_name, account_type, currency) VALUES
  ('provider_fee_expense', 'Payment provider fees', 'expense', 'ETB'),
  ('cash_in_transit', 'Cash in transit', 'asset', 'ETB'),
  ('cash_on_hand', 'Cash on hand', 'asset', 'ETB'),
  ('adjustment_expense', 'Financial adjustments', 'expense', 'ETB'),
  ('subscription_revenue', 'Subscription revenue', 'revenue', 'ETB')
ON CONFLICT (code) DO NOTHING;

DROP TRIGGER IF EXISTS order_financials_set_updated_at ON order_financials;
CREATE TRIGGER order_financials_set_updated_at BEFORE UPDATE ON order_financials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS financial_adjustments_set_updated_at ON financial_adjustments;
CREATE TRIGGER financial_adjustments_set_updated_at BEFORE UPDATE ON financial_adjustments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS cod_collections_set_updated_at ON cod_collections;
CREATE TRIGGER cod_collections_set_updated_at BEFORE UPDATE ON cod_collections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS payout_accounts_set_updated_at ON payout_accounts;
CREATE TRIGGER payout_accounts_set_updated_at BEFORE UPDATE ON payout_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS payout_batches_set_updated_at ON payout_batches;
CREATE TRIGGER payout_batches_set_updated_at BEFORE UPDATE ON payout_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS payout_batch_items_set_updated_at ON payout_batch_items;
CREATE TRIGGER payout_batch_items_set_updated_at BEFORE UPDATE ON payout_batch_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS subscription_plans_set_updated_at ON subscription_plans;
CREATE TRIGGER subscription_plans_set_updated_at BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS subscription_invoices_set_updated_at ON subscription_invoices;
CREATE TRIGGER subscription_invoices_set_updated_at BEFORE UPDATE ON subscription_invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
