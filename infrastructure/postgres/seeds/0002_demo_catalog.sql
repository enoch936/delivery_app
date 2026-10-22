BEGIN;

UPDATE countries SET is_active = true WHERE code = 'ET';

UPDATE cities
SET is_active = true, display_name = 'Launch City'
WHERE country_code = 'ET' AND slug = 'launch-city';

INSERT INTO service_zones (city_id, slug, display_name, boundary, is_active)
SELECT c.id, 'central', 'Central service zone',
  ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((38.70 8.95, 38.85 8.95, 38.85 9.10, 38.70 9.10, 38.70 8.95))'), 4326)),
  true
FROM cities c
WHERE c.country_code = 'ET' AND c.slug = 'launch-city'
ON CONFLICT (city_id, slug) DO UPDATE SET is_active = EXCLUDED.is_active, boundary = EXCLUDED.boundary;

INSERT INTO service_categories (slug, display_name, description, sort_order, is_active)
VALUES
  ('restaurant', 'Restaurant meals', 'Hot meals and scheduled food orders', 10, true),
  ('grocery', 'Groceries', 'Everyday essentials and pantry items', 20, true),
  ('retail', 'Retail', 'General merchant catalog shopping', 30, true)
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, is_active = EXCLUDED.is_active;

INSERT INTO merchants (slug, display_name, description, status)
VALUES
  ('harvest-grocery', 'Harvest Grocery', 'Fresh produce and pantry staples.', 'active'),
  ('sunrise-kitchen', 'Sunrise Kitchen', 'Ethiopian and continental plates.', 'active')
ON CONFLICT (slug) DO UPDATE SET status = EXCLUDED.status, display_name = EXCLUDED.display_name;

INSERT INTO merchant_service_categories (merchant_id, service_category_id)
SELECT m.id, sc.id
FROM merchants m
JOIN service_categories sc ON sc.slug = CASE m.slug WHEN 'harvest-grocery' THEN 'grocery' WHEN 'sunrise-kitchen' THEN 'restaurant' END
ON CONFLICT DO NOTHING;

INSERT INTO merchant_locations (merchant_id, city_id, service_zone_id, name, address_line, location, is_active)
SELECT m.id, c.id, sz.id, m.display_name || ' — Main', 'Demo address, launch city',
  ST_SetSRID(ST_MakePoint(38.78, 9.02), 4326), true
FROM merchants m
CROSS JOIN cities c
JOIN service_zones sz ON sz.city_id = c.id AND sz.slug = 'central'
WHERE c.country_code = 'ET' AND c.slug = 'launch-city'
  AND NOT EXISTS (
    SELECT 1 FROM merchant_locations ml2
    WHERE ml2.merchant_id = m.id AND ml2.city_id = c.id AND ml2.name = m.display_name || ' — Main'
  );

INSERT INTO product_categories (merchant_id, slug, display_name, sort_order)
SELECT m.id, 'essentials', 'Essentials', 1
FROM merchants m WHERE m.slug = 'harvest-grocery'
ON CONFLICT (merchant_id, slug) DO NOTHING;

INSERT INTO product_categories (merchant_id, slug, display_name, sort_order)
SELECT m.id, 'mains', 'Main dishes', 1
FROM merchants m WHERE m.slug = 'sunrise-kitchen'
ON CONFLICT (merchant_id, slug) DO NOTHING;

INSERT INTO products (merchant_id, category_id, sku, display_name, description, base_price_minor, currency, is_available)
SELECT m.id, pc.id, 'TEFF-1KG', 'Teff flour 1 kg', 'Stone-milled teff flour.', 42000, 'ETB', true
FROM merchants m
JOIN product_categories pc ON pc.merchant_id = m.id AND pc.slug = 'essentials'
WHERE m.slug = 'harvest-grocery'
ON CONFLICT (merchant_id, sku) DO UPDATE SET base_price_minor = EXCLUDED.base_price_minor, is_available = EXCLUDED.is_available;

INSERT INTO products (merchant_id, category_id, sku, display_name, description, base_price_minor, currency, is_available)
SELECT m.id, pc.id, 'INJERA-PLATE', 'Injera combo plate', 'Seasonal vegetables with injera.', 18500, 'ETB', true
FROM merchants m
JOIN product_categories pc ON pc.merchant_id = m.id AND pc.slug = 'mains'
WHERE m.slug = 'sunrise-kitchen'
ON CONFLICT (merchant_id, sku) DO UPDATE SET base_price_minor = EXCLUDED.base_price_minor, is_available = EXCLUDED.is_available;

INSERT INTO inventory (product_id, quantity_available)
SELECT p.id, 120
FROM products p
JOIN merchants m ON m.id = p.merchant_id
WHERE m.slug = 'harvest-grocery' AND p.sku = 'TEFF-1KG'
ON CONFLICT (product_id) DO UPDATE SET quantity_available = EXCLUDED.quantity_available;

INSERT INTO inventory (product_id, quantity_available)
SELECT p.id, 40
FROM products p
JOIN merchants m ON m.id = p.merchant_id
WHERE m.slug = 'sunrise-kitchen' AND p.sku = 'INJERA-PLATE'
ON CONFLICT (product_id) DO UPDATE SET quantity_available = EXCLUDED.quantity_available;

COMMIT;
