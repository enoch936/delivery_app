BEGIN;

-- ---------------------------------------------------------------------------
-- Geospatial intelligence core
-- Additive only. Existing tables and API contracts are preserved.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS geo_dataset_sources (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  license_name text,
  license_url text,
  attribution text NOT NULL,
  dataset_version text,
  imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO geo_dataset_sources (id, display_name, license_name, license_url, attribution)
VALUES
  ('osm', 'OpenStreetMap Ethiopia', 'ODbL 1.0', 'https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors'),
  ('microsoft_buildings', 'Microsoft Global ML Building Footprints', 'ODbL 1.0', 'https://github.com/microsoft/GlobalMLBuildingFootprints', '© Microsoft / OpenStreetMap contributors'),
  ('google_open_buildings', 'Google Open Buildings', 'CC BY 4.0 / Google Open Buildings terms', 'https://sites.research.google/open-buildings/', '© Google Open Buildings')
ON CONFLICT (id) DO NOTHING;

-- Unified building footprint model. Source provenance is mandatory so
-- attribution and confidence can be audited per feature.
CREATE TABLE IF NOT EXISTS building_footprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES geo_dataset_sources(id),
  source_feature_id text,
  geometry geometry(MultiPolygon, 4326) NOT NULL,
  building_type text,
  name text,
  height_m numeric(8,2) CHECK (height_m IS NULL OR height_m >= 0),
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'community_verified', 'operator_verified')),
  area_sqm double precision,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_feature_id IS NOT NULL OR source_id <> 'osm')
);

CREATE UNIQUE INDEX IF NOT EXISTS building_footprints_source_feature_idx
  ON building_footprints (source_id, source_feature_id)
  WHERE source_feature_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS building_footprints_geometry_gix
  ON building_footprints USING gist (geometry);
CREATE INDEX IF NOT EXISTS building_footprints_source_idx
  ON building_footprints (source_id, verification_status);

-- Deduplication evidence. Never delete a source feature automatically; record
-- overlap evidence and let ingestion decide with an explicit threshold.
CREATE TABLE IF NOT EXISTS building_footprint_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES building_footprints(id) ON DELETE CASCADE,
  duplicate_of uuid NOT NULL REFERENCES building_footprints(id) ON DELETE CASCADE,
  overlap_ratio numeric(5,4) NOT NULL CHECK (overlap_ratio > 0 AND overlap_ratio <= 1),
  centroid_distance_m double precision NOT NULL CHECK (centroid_distance_m >= 0),
  decision text NOT NULL DEFAULT 'candidate'
    CHECK (decision IN ('candidate', 'kept_separate', 'merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_id, duplicate_of),
  CHECK (building_id <> duplicate_of)
);
CREATE INDEX IF NOT EXISTS building_footprint_matches_duplicate_idx
  ON building_footprint_matches (duplicate_of, overlap_ratio DESC);

-- Verified entrances and delivery access points. A building polygon is never
-- an entrance by itself; every access point must be explicitly captured.
CREATE TABLE IF NOT EXISTS delivery_access_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES building_footprints(id) ON DELETE SET NULL,
  merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
  merchant_location_id uuid REFERENCES merchant_locations(id) ON DELETE CASCADE,
  label text NOT NULL,
  entrance_type text NOT NULL DEFAULT 'street'
    CHECK (entrance_type IN ('street', 'compound', 'mall', 'lobby', 'gate', 'parking', 'other')),
  location geometry(Point, 4326) NOT NULL,
  access_instructions text,
  source text NOT NULL DEFAULT 'operator'
    CHECK (source IN ('merchant_verified', 'customer_confirmed', 'operator_verified', 'imported')),
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_access_points_geometry_gix
  ON delivery_access_points USING gist (location);
CREATE INDEX IF NOT EXISTS delivery_access_points_merchant_idx
  ON delivery_access_points (merchant_id, verification_status);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_access_points_location_idx
  ON delivery_access_points (merchant_location_id, location)
  WHERE merchant_location_id IS NOT NULL;

-- Address intelligence fields on existing customer addresses.
ALTER TABLE IF EXISTS customer_addresses
  ADD COLUMN IF NOT EXISTS landmark text,
  ADD COLUMN IF NOT EXISTS entrance_instructions text,
  ADD COLUMN IF NOT EXISTS geocode_source text,
  ADD COLUMN IF NOT EXISTS pin_confidence numeric(4,3)
    CHECK (pin_confidence IS NULL OR (pin_confidence >= 0 AND pin_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS access_point_id uuid REFERENCES delivery_access_points(id) ON DELETE SET NULL;

-- Latest live position metadata used by consumers that must not query history.
ALTER TABLE IF EXISTS courier_availability
  ADD COLUMN IF NOT EXISTS accuracy_meters numeric(8,2),
  ADD COLUMN IF NOT EXISTS heading_degrees numeric(6,2),
  ADD COLUMN IF NOT EXISTS speed_mps numeric(8,2),
  ADD COLUMN IF NOT EXISTS location_recorded_at timestamptz;

ALTER TABLE IF EXISTS merchant_locations
  ADD COLUMN IF NOT EXISTS entrance_instructions text,
  ADD COLUMN IF NOT EXISTS access_point_id uuid REFERENCES delivery_access_points(id) ON DELETE SET NULL;

-- Geocode result cache (respects Nominatim policy by reducing repeated calls).
CREATE TABLE IF NOT EXISTS geocode_cache (
  cache_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('forward', 'reverse')),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geocode_cache_expiry_idx ON geocode_cache (expires_at);

-- Route response cache. Keys are derived from provider, profile and coordinates.
CREATE TABLE IF NOT EXISTS map_route_cache (
  cache_key text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'valhalla',
  profile text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_route_cache_expiry_idx ON map_route_cache (expires_at);

-- Retention helpers. The application deletes expired samples in batches; the
-- index keeps retention jobs and history queries bounded.
CREATE INDEX IF NOT EXISTS courier_location_samples_recorded_idx
  ON courier_location_samples (recorded_at);
CREATE INDEX IF NOT EXISTS courier_location_samples_courier_recorded_idx
  ON courier_location_samples (courier_user_id, recorded_at DESC);

COMMENT ON TABLE building_footprints IS
  'Unified building footprints. A polygon is not a delivery entrance; see delivery_access_points.';
COMMENT ON TABLE delivery_access_points IS
  'Explicitly verified entrances/access points. Never inferred from a building polygon.';

COMMIT;
