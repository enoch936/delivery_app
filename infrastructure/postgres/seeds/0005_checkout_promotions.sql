BEGIN;

INSERT INTO promotions (code, display_name, kind, value, currency, minimum_order_minor, maximum_discount_minor, is_active)
VALUES
  ('FAST25', 'ETB 25 off a fast food order', 'FIXED', 2500, 'ETB', 12000, 2500, true),
  ('EXPRESS', 'ETB 50 off express delivery', 'FIXED', 5000, 'ETB', 20000, 5000, true),
  ('CARE30', '30% off pharmacy orders', 'PERCENT', 30, 'ETB', 20000, 30000, true)
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    kind = EXCLUDED.kind,
    value = EXCLUDED.value,
    minimum_order_minor = EXCLUDED.minimum_order_minor,
    maximum_discount_minor = EXCLUDED.maximum_discount_minor,
    is_active = EXCLUDED.is_active;

COMMIT;
