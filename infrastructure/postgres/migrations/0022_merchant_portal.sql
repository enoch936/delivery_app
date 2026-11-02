BEGIN;

-- Operator decision reasons surfaced to merchants (rejection / suspension).
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS suspension_reason text;

-- Business verification documents uploaded by the merchant during onboarding.
CREATE TABLE IF NOT EXISTS merchant_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  document_type text NOT NULL
    CHECK (document_type IN ('business_registration', 'tax_identification', 'trading_license', 'operating_permit', 'insurance', 'profile_photo')),
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_documents_merchant_idx ON merchant_documents (merchant_id, created_at DESC);

COMMIT;
