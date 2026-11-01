BEGIN;

-- Loyalty wallet: points customers earn from delivered orders and spend on rewards.
CREATE TABLE IF NOT EXISTS loyalty_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points <> 0),
  type text NOT NULL
    CHECK (type IN ('earn', 'redeem', 'referral_credit', 'bonus')),
  source text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS loyalty_transactions_user_created_idx ON loyalty_transactions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS loyalty_accounts_set_updated_at ON loyalty_accounts;
CREATE TRIGGER loyalty_accounts_set_updated_at BEFORE UPDATE ON loyalty_accounts FOR EACH ROW EXECUTE FUNCTION
set_updated_at();
DROP TRIGGER IF EXISTS loyalty_transactions_set_updated_at ON loyalty_transactions;
CREATE TRIGGER loyalty_transactions_set_updated_at BEFORE UPDATE ON loyalty_transactions FOR EACH ROW EXECUTE FUNCTION
set_updated_at();

-- Referral program: shareable codes, issued referrals and credited rewards.
CREATE TABLE IF NOT EXISTS referral_codes (
  code text PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_codes_owner_idx ON referral_codes (owner_user_id);

DROP TRIGGER IF EXISTS referral_codes_set_updated_at ON referral_codes;
CREATE TRIGGER referral_codes_set_updated_at BEFORE UPDATE ON referral_codes FOR EACH ROW EXECUTE FUNCTION
set_updated_at();

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CREDITED', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  credited_at timestamptz
);
CREATE INDEX IF NOT EXISTS referrals_referrer_created_idx ON referrals (referrer_user_id, created_at DESC);

COMMIT;
