ALTER TABLE courier_location_samples
  ADD COLUMN IF NOT EXISTS client_operation_id text;

CREATE UNIQUE INDEX IF NOT EXISTS courier_location_samples_operation_idx
  ON courier_location_samples (courier_user_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
