BEGIN;

-- ---------------------------------------------------------------------------
-- Courier verification, city/category requirements and private document metadata
-- ---------------------------------------------------------------------------
ALTER TABLE courier_profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES cities(id),
  ADD COLUMN IF NOT EXISTS service_category_slug text,
  ADD COLUMN IF NOT EXISTS vehicle_model text,
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS availability_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_decision_reason text;

CREATE INDEX IF NOT EXISTS courier_profiles_city_category_idx
  ON courier_profiles (city_id, service_category_slug, status);

ALTER TABLE courier_documents
  ADD COLUMN IF NOT EXISTS original_name text,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS size_bytes integer CHECK (size_bytes IS NULL OR size_bytes > 0),
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'local_private',
  ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES courier_documents(id);

CREATE INDEX IF NOT EXISTS courier_documents_type_status_idx
  ON courier_documents (courier_user_id, document_type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS courier_verification_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES cities(id) ON DELETE CASCADE,
  service_category_slug text,
  vehicle_type text CHECK (vehicle_type IS NULL OR vehicle_type IN ('walking', 'bicycle', 'motorcycle', 'car', 'van')),
  document_type text NOT NULL CHECK (document_type IN ('national_id', 'driving_license', 'vehicle_registration', 'insurance', 'profile_photo')),
  is_required boolean NOT NULL DEFAULT true,
  requires_expiry boolean NOT NULL DEFAULT false,
  max_age_days integer CHECK (max_age_days IS NULL OR max_age_days > 0),
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, service_category_slug, vehicle_type, document_type)
);

CREATE INDEX IF NOT EXISTS courier_verification_requirements_lookup_idx
  ON courier_verification_requirements (city_id, service_category_slug, vehicle_type, is_active);

CREATE TABLE IF NOT EXISTS courier_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid REFERENCES courier_documents(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id),
  from_status text,
  to_status text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS courier_verification_events_courier_idx
  ON courier_verification_events (courier_user_id, created_at DESC);

-- Default requirements for the launch city and all service categories. Operators
-- can override these rows per city, category, and vehicle type.
INSERT INTO courier_verification_requirements (city_id, service_category_slug, vehicle_type, document_type, is_required, requires_expiry, max_age_days, sort_order)
SELECT c.id, NULL, NULL, doc.document_type, true, doc.requires_expiry, doc.max_age_days, doc.sort_order
FROM cities c
CROSS JOIN (VALUES
  ('national_id', false, NULL::integer, 10),
  ('driving_license', true, 3650, 20),
  ('profile_photo', false, NULL::integer, 30)
) AS doc(document_type, requires_expiry, max_age_days, sort_order)
WHERE c.slug = 'launch-city'
ON CONFLICT (city_id, service_category_slug, vehicle_type, document_type) DO NOTHING;

INSERT INTO courier_verification_requirements (city_id, service_category_slug, vehicle_type, document_type, is_required, requires_expiry, max_age_days, sort_order)
SELECT c.id, NULL, vehicle.vehicle_type, doc.document_type, true, doc.requires_expiry, doc.max_age_days, doc.sort_order
FROM cities c
CROSS JOIN (VALUES ('motorcycle'), ('car'), ('van')) AS vehicle(vehicle_type)
CROSS JOIN (VALUES
  ('vehicle_registration', false, NULL::integer, 40),
  ('insurance', true, 365, 50)
) AS doc(document_type, requires_expiry, max_age_days, sort_order)
WHERE c.slug = 'launch-city'
ON CONFLICT (city_id, service_category_slug, vehicle_type, document_type) DO NOTHING;

COMMIT;
