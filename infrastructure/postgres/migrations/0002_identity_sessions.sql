BEGIN;

CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('phone_login')),
  phone_e164 text NOT NULL,
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
CREATE INDEX IF NOT EXISTS auth_challenges_phone_requested_idx ON auth_challenges (phone_e164, requested_at DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS user_sessions_active_user_idx ON user_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

COMMIT;
