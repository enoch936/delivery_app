BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS business_orders_account_order_idx
  ON business_orders (business_account_id, order_id);

CREATE TABLE IF NOT EXISTS business_fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  label text NOT NULL,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('motorcycle', 'car', 'van', 'bicycle')),
  make_model text,
  plate_number text NOT NULL,
  registration_expires_on date,
  insurance_expires_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_account_id, plate_number),
  UNIQUE (id, business_account_id)
);

CREATE INDEX IF NOT EXISTS business_fleet_vehicles_account_idx
  ON business_fleet_vehicles (business_account_id, is_active, label);

CREATE TABLE IF NOT EXISTS business_fleet_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  driver_user_id uuid NOT NULL REFERENCES users(id),
  vehicle_id uuid NOT NULL,
  assigned_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (business_account_id, order_id)
    REFERENCES business_orders (business_account_id, order_id) ON DELETE CASCADE,
  FOREIGN KEY (business_account_id, driver_user_id)
    REFERENCES business_members (business_account_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id, business_account_id)
    REFERENCES business_fleet_vehicles (id, business_account_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS business_fleet_assignment_order_active_idx
  ON business_fleet_assignments (order_id) WHERE status = 'assigned';
CREATE UNIQUE INDEX IF NOT EXISTS business_fleet_assignment_driver_active_idx
  ON business_fleet_assignments (driver_user_id) WHERE status = 'assigned';
CREATE UNIQUE INDEX IF NOT EXISTS business_fleet_assignment_vehicle_active_idx
  ON business_fleet_assignments (vehicle_id) WHERE status = 'assigned';
CREATE INDEX IF NOT EXISTS business_fleet_assignment_account_history_idx
  ON business_fleet_assignments (business_account_id, created_at DESC);

DROP TRIGGER IF EXISTS business_fleet_vehicles_set_updated_at ON business_fleet_vehicles;
CREATE TRIGGER business_fleet_vehicles_set_updated_at
  BEFORE UPDATE ON business_fleet_vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS business_fleet_assignments_set_updated_at ON business_fleet_assignments;
CREATE TRIGGER business_fleet_assignments_set_updated_at
  BEFORE UPDATE ON business_fleet_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
