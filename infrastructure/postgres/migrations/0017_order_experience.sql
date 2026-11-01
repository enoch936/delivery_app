-- ---------------------------------------------------------------------------
-- Order experience: post-delivery issues, disputes and support follow-up
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL
    CHECK (category IN (
      'missing_item', 'wrong_item', 'damaged', 'late_delivery', 'never_delivered',
      'quality', 'courier_issue', 'merchant_issue', 'refund_request', 'other'
    )),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 2000),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
  priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  resolution text,
  refund_id uuid REFERENCES refunds(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_issues_order_created_idx ON order_issues (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_issues_user_created_idx ON order_issues (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_issues_status_priority_idx ON order_issues (status, priority, created_at ASC);
CREATE INDEX IF NOT EXISTS order_issues_refund_idx ON order_issues (refund_id) WHERE refund_id IS NOT NULL;

DROP TRIGGER IF EXISTS order_issues_set_updated_at ON order_issues;
CREATE TRIGGER order_issues_set_updated_at BEFORE UPDATE ON order_issues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Fast customer support lookups for refund state on recent orders.
CREATE INDEX IF NOT EXISTS refunds_order_status_created_idx ON refunds (order_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_proofs_order_proof_created_idx ON delivery_proofs (order_id, proof_type, created_at DESC);
