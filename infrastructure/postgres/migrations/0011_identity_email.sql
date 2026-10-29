BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS email_challenges (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  email citext NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('verification', 'recovery')),
  code_hash text NOT NULL,
  provider text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  consumed_at timestamptz,
  request_id text,
  ip_hash text,
  CHECK (expires_at > requested_at)
);
CREATE INDEX IF NOT EXISTS email_challenges_lookup_idx ON email_challenges (email, purpose, requested_at DESC);

COMMIT;
