BEGIN;

-- Promotional banners can deep-link into a category browse or a storefront, so a
-- tap is a real navigation instead of a copied code.
ALTER TABLE discovery_banners
  ADD COLUMN IF NOT EXISTS target_category_slug text,
  ADD COLUMN IF NOT EXISTS target_merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS discovery_banners_active_window_idx
  ON discovery_banners (sort_order, starts_at) WHERE is_active = true;

-- Discovery ordering and matching support.
CREATE INDEX IF NOT EXISTS products_description_trgm_idx ON products USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_user_created_at_idx ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id);
CREATE INDEX IF NOT EXISTS service_categories_active_order_idx ON service_categories (sort_order) WHERE is_active = true;

-- Today's trading window in the market timezone. NULL means "always open" or
-- "no usable schedule"; {"closed":true} means the merchant is not trading today.
CREATE OR REPLACE FUNCTION discovery_today_hours(hours jsonb, at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  local_ts timestamp := at AT TIME ZONE 'Africa/Addis_Ababa';
  names text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
  day_key text := names[extract(dow FROM local_ts)::integer + 1];
  day_window jsonb;
  opens time;
  closes time;
BEGIN
  IF hours IS NULL OR hours = '{}'::jsonb THEN RETURN NULL; END IF;
  day_window := COALESCE(hours -> day_key, hours -> 'default');
  IF day_window IS NULL OR jsonb_typeof(day_window) <> 'object' THEN RETURN NULL; END IF;
  IF COALESCE((day_window ->> 'closed')::boolean, false) THEN RETURN jsonb_build_object('closed', true); END IF;
  opens := (day_window ->> 'open')::time;
  closes := (day_window ->> 'close')::time;
  IF opens IS NULL OR closes IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('closed', false, 'open', to_char(opens, 'HH24:MI'), 'close', to_char(closes, 'HH24:MI'));
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Next instant the merchant starts trading, or NULL when it is always open (or
-- no schedule is configured). Used for "Opens at 07:00" copy when closed.
CREATE OR REPLACE FUNCTION discovery_next_open(hours jsonb, at timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
  local_ts timestamp := at AT TIME ZONE 'Africa/Addis_Ababa';
  names text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
  day_offset integer;
  day_date date;
  day_window jsonb;
  opens time;
  candidate timestamp;
BEGIN
  IF hours IS NULL OR hours = '{}'::jsonb THEN RETURN NULL; END IF;
  FOR day_offset IN 0..7 LOOP
    day_date := (local_ts + make_interval(days => day_offset))::date;
    day_window := COALESCE(hours -> names[extract(dow FROM day_date)::integer + 1], hours -> 'default');
    CONTINUE WHEN day_window IS NULL OR jsonb_typeof(day_window) <> 'object';
    CONTINUE WHEN COALESCE((day_window ->> 'closed')::boolean, false);
    opens := (day_window ->> 'open')::time;
    CONTINUE WHEN opens IS NULL OR (day_window ->> 'close')::time IS NULL;
    candidate := day_date + opens;
    IF candidate > local_ts THEN
      RETURN candidate AT TIME ZONE 'Africa/Addis_Ababa';
    END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Quote an ETA from the merchant's prep window plus straight-line travel time
-- (about 18-23 km/h in Addis traffic). Never narrower than a 5 minute window.
DROP FUNCTION IF EXISTS discovery_eta(numeric, integer, integer);
CREATE OR REPLACE FUNCTION discovery_eta(distance_km double precision, base_min integer, base_max integer)
RETURNS integer[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN distance_km IS NULL OR distance_km < 0 THEN ARRAY[base_min, GREATEST(base_max, base_min + 5)]
    ELSE ARRAY[
      GREATEST(1, base_min + ceil(distance_km * 2.6)::integer + 2),
      GREATEST(
        base_min + ceil(distance_km * 2.6)::integer + 7,
        base_max + ceil(distance_km * 3.4)::integer + 4
      )
    ]
  END;
$$;

COMMIT;
