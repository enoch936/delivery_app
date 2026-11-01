BEGIN;

-- Referral codes carry a validity window so stale codes stop working.
ALTER TABLE referral_codes ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE referral_codes SET expires_at = created_at + interval '30 days' WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS referral_codes_owner_expires_idx ON referral_codes (owner_user_id, expires_at DESC);

COMMIT;
