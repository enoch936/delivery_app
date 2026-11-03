BEGIN;

ALTER TABLE business_accounts
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS spending_limit_minor bigint CHECK (spending_limit_minor IS NULL OR spending_limit_minor >= 0),
  ADD COLUMN IF NOT EXISTS monthly_spending_limit_minor bigint CHECK (monthly_spending_limit_minor IS NULL OR monthly_spending_limit_minor >= 0);

ALTER TABLE business_members
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE business_locations
  ADD COLUMN IF NOT EXISTS is_billing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pickup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone_e164 text,
  ADD COLUMN IF NOT EXISTS operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS business_cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  code text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_account_id, code)
);

CREATE INDEX IF NOT EXISTS business_cost_centers_account_idx
  ON business_cost_centers (business_account_id, is_active);

COMMIT;
