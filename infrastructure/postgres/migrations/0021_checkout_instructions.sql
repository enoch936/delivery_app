ALTER TABLE checkout_quotes ADD COLUMN IF NOT EXISTS delivery_instructions text;

CREATE INDEX IF NOT EXISTS checkout_quotes_expiry_idx ON checkout_quotes (expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_pending_expiry_idx ON payments (expires_at) WHERE status = 'PENDING';
