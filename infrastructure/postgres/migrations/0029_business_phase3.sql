BEGIN;

ALTER TABLE business_orders
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS parent_schedule_id uuid;

CREATE TABLE IF NOT EXISTS business_delivery_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  template_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  next_run_at timestamptz NOT NULL,
  end_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_delivery_schedules_account_idx
  ON business_delivery_schedules (business_account_id, is_active, next_run_at);

CREATE TABLE IF NOT EXISTS business_order_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_order_id uuid NOT NULL REFERENCES business_orders(order_id) ON DELETE CASCADE,
  stop_type text NOT NULL CHECK (stop_type IN ('pickup', 'dropoff', 'waypoint')),
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  label text,
  address_line text NOT NULL,
  location geometry(Point, 4326),
  contact_name text,
  contact_phone_e164 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'arrived', 'completed', 'skipped')),
  arrived_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_order_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS business_order_stops_order_idx
  ON business_order_stops (business_order_id, sequence_number);

COMMIT;
