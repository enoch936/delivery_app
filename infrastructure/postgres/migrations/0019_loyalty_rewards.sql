BEGIN;

-- Loyalty rewards catalog: spendable rewards bought with earned loyalty points.
CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  points_cost integer NOT NULL CHECK (points_cost > 0),
  reward_value_minor bigint NOT NULL DEFAULT 0 CHECK (reward_value_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'ETB',
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_rewards_active_idx ON loyalty_rewards (is_active, points_cost ASC);

DROP TRIGGER IF EXISTS loyalty_rewards_set_updated_at ON loyalty_rewards;
CREATE TRIGGER loyalty_rewards_set_updated_at BEFORE UPDATE ON loyalty_rewards FOR EACH ROW EXECUTE FUNCTION
set_updated_at();

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES loyalty_rewards(id) ON DELETE RESTRICT,
  points integer NOT NULL CHECK (points > 0),
  status text NOT NULL DEFAULT 'REDEEMED'
    CHECK (status IN ('PENDING', 'REDEEMED', 'CANCELLED', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS loyalty_redemptions_user_created_idx ON loyalty_redemptions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS loyalty_redemptions_set_updated_at ON loyalty_redemptions;
CREATE TRIGGER loyalty_redemptions_set_updated_at BEFORE UPDATE ON loyalty_redemptions FOR EACH ROW EXECUTE FUNCTION
set_updated_at();

COMMIT;
