BEGIN;

CREATE TABLE IF NOT EXISTS business_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  invoice_number text NOT NULL UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'void')),
  pdf_storage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_account_id, order_id)
);

CREATE INDEX IF NOT EXISTS business_invoices_account_idx
  ON business_invoices (business_account_id, issued_at DESC);

COMMIT;
