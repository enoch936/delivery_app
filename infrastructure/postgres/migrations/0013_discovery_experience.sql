BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS rating numeric(2,1) NOT NULL DEFAULT 4.7 CHECK (rating >= 0 AND rating <= 5),
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  ADD COLUMN IF NOT EXISTS price_level smallint NOT NULL DEFAULT 2 CHECK (price_level BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS delivery_fee_minor bigint NOT NULL DEFAULT 5000 CHECK (delivery_fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS min_order_minor bigint NOT NULL DEFAULT 0 CHECK (min_order_minor >= 0),
  ADD COLUMN IF NOT EXISTS eta_min_minutes integer NOT NULL DEFAULT 20 CHECK (eta_min_minutes > 0),
  ADD COLUMN IF NOT EXISTS eta_max_minutes integer NOT NULL DEFAULT 35 CHECK (eta_max_minutes >= eta_min_minutes),
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS merchants_featured_rating_idx ON merchants (is_featured DESC, rating DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS merchants_name_trgm_idx ON merchants USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS merchant_locations_geo_idx ON merchant_locations USING gist (location);

CREATE TABLE IF NOT EXISTS discovery_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text NOT NULL,
  code text,
  cta_label text NOT NULL DEFAULT 'Order now',
  image_url text,
  accent_color text NOT NULL DEFAULT '#E8613D',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_banners_title_idx ON discovery_banners (title);

CREATE TABLE IF NOT EXISTS user_recent_searches (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term text NOT NULL CHECK (char_length(term) BETWEEN 1 AND 120),
  hit_count integer NOT NULL DEFAULT 1 CHECK (hit_count > 0),
  last_searched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, term)
);
CREATE INDEX IF NOT EXISTS user_recent_searches_user_time_idx ON user_recent_searches (user_id, last_searched_at DESC);

DROP TRIGGER IF EXISTS discovery_banners_set_updated_at ON discovery_banners;
CREATE TRIGGER discovery_banners_set_updated_at BEFORE UPDATE ON discovery_banners FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION discovery_is_open(hours jsonb, at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  local_ts timestamp;
  day_key text;
  day_hours jsonb;
  opens_at time;
  closes_at time;
BEGIN
  IF hours IS NULL OR hours = '{}'::jsonb THEN
    RETURN true;
  END IF;
  local_ts := at AT TIME ZONE 'Africa/Addis_Ababa';
  day_key := (ARRAY['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])[extract(dow FROM local_ts)::integer + 1];
  day_hours := COALESCE(hours -> day_key, hours -> 'default');
  IF day_hours IS NULL OR jsonb_typeof(day_hours) <> 'object' THEN
    RETURN false;
  END IF;
  IF COALESCE((day_hours ->> 'closed')::boolean, false) THEN
    RETURN false;
  END IF;
  opens_at := (day_hours ->> 'open')::time;
  closes_at := (day_hours ->> 'close')::time;
  IF opens_at IS NULL OR closes_at IS NULL THEN
    RETURN true;
  END IF;
  IF closes_at <= opens_at THEN
    RETURN local_ts::time >= opens_at OR local_ts::time < closes_at;
  END IF;
  RETURN local_ts::time >= opens_at AND local_ts::time < closes_at;
END;
$$;

COMMIT;
