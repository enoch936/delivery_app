BEGIN;

-- ---------------------------------------------------------------------------
-- Customer account experience: accessibility, consent and deletion lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS text_scale numeric(3,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS reduce_motion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS high_contrast boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS screen_reader_hints boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;

DO $$ BEGIN
  ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_text_scale_check
    CHECK (text_scale >= 1.00 AND text_scale <= 2.00);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Normalize legacy locale identifiers to the short codes used by mobile clients.
UPDATE user_profiles
SET preferred_locale = CASE WHEN preferred_locale LIKE 'am%' THEN 'am' ELSE 'en' END,
    updated_at = now()
WHERE preferred_locale NOT IN ('en', 'am');

ALTER TABLE user_profiles ALTER COLUMN preferred_locale SET DEFAULT 'en';

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
  reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,
  cancelled_at timestamptz,
  completed_at timestamptz,
  request_id text,
  CHECK (scheduled_for > requested_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_pending_idx
  ON account_deletion_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS account_deletion_requests_schedule_idx
  ON account_deletion_requests (scheduled_for) WHERE status = 'pending';

COMMIT;
