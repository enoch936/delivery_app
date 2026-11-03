BEGIN;

-- ---------------------------------------------------------------------------
-- Pickup and delivery execution
-- Server-authoritative proof of delivery, failure reporting and returns.
-- ---------------------------------------------------------------------------

-- Ops can configure the proof required for an order; NULL keeps the legacy
-- behaviour derived from delivery_proof_required.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_proof_mode text
  CHECK (delivery_proof_mode IN ('otp', 'qr', 'photo', 'signature', 'handoff'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_attempt_count integer NOT NULL DEFAULT 0;

-- The merchant contact the courier may call while assigned to the delivery.
ALTER TABLE merchant_locations ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE merchant_locations ADD COLUMN IF NOT EXISTS contact_phone_e164 text;
ALTER TABLE merchant_locations DROP CONSTRAINT IF EXISTS merchant_locations_contact_phone_check;
ALTER TABLE merchant_locations ADD CONSTRAINT merchant_locations_contact_phone_check
  CHECK (contact_phone_e164 IS NULL OR contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE delivery_assignments ADD COLUMN IF NOT EXISTS failure_reason_code text
  CHECK (failure_reason_code IN (
    'inaccessible_address', 'recipient_unavailable', 'recipient_refused', 'damaged_goods',
    'order_not_ready', 'safety_concern', 'vehicle_issue', 'other'
  ));
ALTER TABLE delivery_assignments ADD COLUMN IF NOT EXISTS failure_notes text;
ALTER TABLE delivery_assignments ADD COLUMN IF NOT EXISTS return_required boolean NOT NULL DEFAULT false;
ALTER TABLE delivery_assignments ADD COLUMN IF NOT EXISTS return_status text NOT NULL DEFAULT 'not_required'
  CHECK (return_status IN ('not_required', 'pending', 'completed'));
ALTER TABLE delivery_assignments ADD COLUMN IF NOT EXISTS return_confirmed_at timestamptz;
ALTER TABLE delivery_assignments ADD COLUMN IF NOT EXISTS return_notes text;

CREATE INDEX IF NOT EXISTS delivery_assignments_pending_return_idx
  ON delivery_assignments (courier_user_id, return_status)
  WHERE return_status = 'pending';

-- QR proof is verified against the same HMAC delivery code as OTP.
ALTER TABLE delivery_proofs DROP CONSTRAINT IF EXISTS delivery_proofs_proof_type_check;
ALTER TABLE delivery_proofs ADD CONSTRAINT delivery_proofs_proof_type_check
  CHECK (proof_type IN ('otp', 'qr', 'photo', 'signature', 'merchant_handoff', 'customer_handoff'));

CREATE INDEX IF NOT EXISTS delivery_assignments_failure_idx
  ON delivery_assignments (courier_user_id, failure_reason_code, cancelled_at DESC)
  WHERE failure_reason_code IS NOT NULL;

COMMIT;
