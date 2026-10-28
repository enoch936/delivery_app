-- ---------------------------------------------------------------------------
-- Settlement lifecycle, settled-order traceability and reconciliation support
-- ---------------------------------------------------------------------------

INSERT INTO ledger_accounts (code, display_name, account_type, currency) VALUES
  ('platform_bank', 'Platform bank', 'asset', 'ETB')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE merchant_settlements
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE courier_payouts
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS merchant_settlements_period_idx
  ON merchant_settlements (merchant_id, period_start, period_end, currency);

CREATE UNIQUE INDEX IF NOT EXISTS courier_payouts_period_idx
  ON courier_payouts (courier_user_id, period_start, period_end, currency);

CREATE INDEX IF NOT EXISTS merchant_settlements_status_idx
  ON merchant_settlements (status, period_end DESC);

CREATE INDEX IF NOT EXISTS courier_payouts_status_idx
  ON courier_payouts (status, period_end DESC);

CREATE TABLE IF NOT EXISTS merchant_settlement_orders (
  settlement_id uuid NOT NULL REFERENCES merchant_settlements(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  merchant_gross_minor bigint NOT NULL CHECK (merchant_gross_minor >= 0),
  commission_minor bigint NOT NULL CHECK (commission_minor >= 0),
  net_minor bigint NOT NULL CHECK (net_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (settlement_id, order_id)
);
CREATE INDEX IF NOT EXISTS merchant_settlement_orders_settlement_idx
  ON merchant_settlement_orders (settlement_id);

CREATE TABLE IF NOT EXISTS courier_payout_orders (
  payout_id uuid NOT NULL REFERENCES courier_payouts(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  courier_earning_minor bigint NOT NULL CHECK (courier_earning_minor >= 0),
  tip_minor bigint NOT NULL CHECK (tip_minor >= 0),
  net_minor bigint NOT NULL CHECK (net_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payout_id, order_id)
);
CREATE INDEX IF NOT EXISTS courier_payout_orders_payout_idx
  ON courier_payout_orders (payout_id);

DROP TRIGGER IF EXISTS merchant_settlements_set_updated_at ON merchant_settlements;
CREATE TRIGGER merchant_settlements_set_updated_at BEFORE UPDATE ON merchant_settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS courier_payouts_set_updated_at ON courier_payouts;
CREATE TRIGGER courier_payouts_set_updated_at BEFORE UPDATE ON courier_payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
