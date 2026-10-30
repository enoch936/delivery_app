BEGIN;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS delivery_radius_km numeric(6,2) NOT NULL DEFAULT 8
  CHECK (delivery_radius_km > 0 AND delivery_radius_km <= 200);
CREATE INDEX IF NOT EXISTS merchant_locations_geography_idx
  ON merchant_locations USING gist ((location::geography)) WHERE is_active = true;

-- A branch must be in range and, when configured, its delivery zone must cover
-- the destination. Unknown coordinates are browse-only, not a delivery promise.
CREATE OR REPLACE FUNCTION discovery_location_available(
  point geometry, zone_id uuid, radius_km numeric, latitude double precision, longitude double precision
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN latitude IS NULL OR longitude IS NULL THEN true ELSE
    ST_DWithin(point::geography, ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, radius_km * 1000)
    AND (zone_id IS NULL OR EXISTS (
      SELECT 1 FROM service_zones z WHERE z.id = zone_id AND z.is_active = true
        AND ST_Covers(z.boundary, ST_SetSRID(ST_MakePoint(longitude, latitude), 4326))
    )) END;
$$;

-- Evaluate today's trading window plus the previous day's overnight spill, rather than
-- treating the early morning as part of tonight's not-yet-open window.
CREATE OR REPLACE FUNCTION discovery_is_open(hours jsonb, at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  local_ts timestamp := at AT TIME ZONE 'Africa/Addis_Ababa';
  names text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
  day_index integer := extract(dow FROM local_ts)::integer;
  day_window jsonb;
  opens time;
  closes time;
  previous boolean;
BEGIN
  IF hours IS NULL OR hours = '{}'::jsonb THEN RETURN true; END IF;
  FOREACH previous IN ARRAY ARRAY[false, true] LOOP
    day_window := COALESCE(hours -> names[(day_index + CASE WHEN previous THEN 6 ELSE 0 END) % 7 + 1], hours -> 'default');
    IF day_window IS NULL OR jsonb_typeof(day_window) <> 'object' OR COALESCE((day_window ->> 'closed')::boolean, false) THEN CONTINUE; END IF;
    opens := (day_window ->> 'open')::time;
    closes := (day_window ->> 'close')::time;
    IF opens IS NULL OR closes IS NULL THEN
      IF NOT previous THEN RETURN true; END IF;
    ELSIF opens = closes THEN
      IF NOT previous THEN RETURN true; END IF;
    ELSIF previous THEN
      IF closes < opens AND local_ts::time < closes THEN RETURN true; END IF;
    ELSIF closes < opens THEN
      IF local_ts::time >= opens THEN RETURN true; END IF;
    ELSIF local_ts::time >= opens AND local_ts::time < closes THEN RETURN true;
    END IF;
  END LOOP;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RETURN false;
END;
$$;

COMMIT;