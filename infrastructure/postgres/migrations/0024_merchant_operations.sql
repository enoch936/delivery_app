BEGIN;

-- Merchant availability, delivery/pickup modes and temporary pauses.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS supports_delivery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accepting_orders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS availability_note text;

ALTER TABLE merchant_members
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS merchant_members_active_merchant_idx
  ON merchant_members (merchant_id, is_active);

CREATE TABLE IF NOT EXISTS merchant_staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff')),
  permissions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid NOT NULL REFERENCES users(id),
  accepted_by uuid REFERENCES users(id),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_staff_invitations_pending_idx
  ON merchant_staff_invitations (merchant_id, phone_e164)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS merchant_staff_invitations_phone_idx
  ON merchant_staff_invitations (phone_e164, status);

CREATE TABLE IF NOT EXISTS merchant_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES merchant_locations(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS merchant_closures_merchant_window_idx
  ON merchant_closures (merchant_id, starts_at, ends_at);

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS support_tickets_merchant_idx
  ON support_tickets (merchant_id, created_at DESC);

COMMIT;
