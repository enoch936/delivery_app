BEGIN;

INSERT INTO service_categories (slug, display_name, description, sort_order, is_active)
VALUES
  ('restaurant', 'Restaurants', 'Hot meals, coffee and scheduled food orders', 10, true),
  ('grocery', 'Groceries', 'Everyday essentials and pantry items', 20, true),
  ('pharmacy', 'Pharmacy', 'Medicines and personal care', 30, true),
  ('retail', 'Retail', 'Electronics, books and general shopping', 40, true),
  ('parcel', 'Parcel', 'Send a package across the city', 50, true),
  ('courier', 'Courier', 'On-demand pickup and drop-off', 60, true)
ON CONFLICT (slug) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;

INSERT INTO merchants (
  slug, display_name, description, logo_url, cover_image_url, status,
  rating, rating_count, price_level, delivery_fee_minor, min_order_minor,
  eta_min_minutes, eta_max_minutes, is_featured, tags
)
VALUES
  ('sunrise-kitchen', 'Sunrise Kitchen', 'Ethiopian and continental plates made fresh every day.', NULL,
   'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80', 'active',
   4.8, 428, 2, 4500, 12000, 20, 30, true, ARRAY['injera', 'ethiopian', 'breakfast']),
  ('harvest-grocery', 'Harvest Grocery', 'Fresh produce, pantry staples and household essentials.', NULL,
   'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80', 'active',
   4.6, 312, 1, 3500, 5000, 15, 25, true, ARRAY['teff', 'vegetables', 'essentials']),
  ('bole-pharmacy', 'Bole Pharmacy', 'Licensed pharmacy with rapid prescription delivery.', NULL,
   'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=1200&q=80', 'active',
   4.9, 187, 2, 4000, 0, 15, 25, true, ARRAY['medicine', 'wellness', '24h']),
  ('merkato-electronics', 'Merkato Electronics', 'Phones, accessories and home electronics with warranty.', NULL,
   'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=1200&q=80', 'active',
   4.5, 96, 3, 6500, 20000, 35, 50, false, ARRAY['electronics', 'phones', 'warranty']),
  ('habesha-table', 'Habesha Table', 'Slow-cooked traditional dishes and sharing platters.', NULL,
   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80', 'active',
   4.7, 264, 2, 5000, 15000, 30, 45, true, ARRAY['doro wat', 'traditional', 'family']),
  ('green-leaf-market', 'Green Leaf Market', 'Organic vegetables, fruit boxes and fresh juice.', NULL,
   'https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=1200&q=80', 'active',
   4.6, 143, 2, 4000, 8000, 20, 35, false, ARRAY['organic', 'fruit', 'juice']),
  ('bole-books', 'Bole Books & Stationery', 'Books, school supplies and office stationery.', NULL,
   'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=1200&q=80', 'active',
   4.4, 58, 2, 4500, 5000, 30, 45, false, ARRAY['books', 'school', 'office']),
  ('express-parcel', 'Express Parcel', 'Same-day parcel delivery with live tracking.', NULL,
   'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=80', 'active',
   4.8, 521, 2, 0, 0, 45, 90, true, ARRAY['parcel', 'same day', 'tracking']),
  ('swift-courier', 'Swift Courier', 'Dedicated courier pickup and drop-off in Addis Ababa.', NULL,
   'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?auto=format&fit=crop&w=1200&q=80', 'active',
   4.7, 389, 2, 0, 0, 40, 75, false, ARRAY['courier', 'express', 'business'])
ON CONFLICT (slug) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    logo_url = EXCLUDED.logo_url,
    cover_image_url = EXCLUDED.cover_image_url,
    status = EXCLUDED.status,
    rating = EXCLUDED.rating,
    rating_count = EXCLUDED.rating_count,
    price_level = EXCLUDED.price_level,
    delivery_fee_minor = EXCLUDED.delivery_fee_minor,
    min_order_minor = EXCLUDED.min_order_minor,
    eta_min_minutes = EXCLUDED.eta_min_minutes,
    eta_max_minutes = EXCLUDED.eta_max_minutes,
    is_featured = EXCLUDED.is_featured,
    tags = EXCLUDED.tags;

INSERT INTO merchant_service_categories (merchant_id, service_category_id)
SELECT m.id, sc.id
FROM merchants m
JOIN service_categories sc ON sc.slug = CASE m.slug
  WHEN 'sunrise-kitchen' THEN 'restaurant'
  WHEN 'harvest-grocery' THEN 'grocery'
  WHEN 'bole-pharmacy' THEN 'pharmacy'
  WHEN 'merkato-electronics' THEN 'retail'
  WHEN 'habesha-table' THEN 'restaurant'
  WHEN 'green-leaf-market' THEN 'grocery'
  WHEN 'bole-books' THEN 'retail'
  WHEN 'express-parcel' THEN 'parcel'
  WHEN 'swift-courier' THEN 'courier'
END
WHERE m.slug IN ('sunrise-kitchen', 'harvest-grocery', 'bole-pharmacy', 'merkato-electronics', 'habesha-table', 'green-leaf-market', 'bole-books', 'express-parcel', 'swift-courier')
ON CONFLICT DO NOTHING;

INSERT INTO merchant_locations (merchant_id, city_id, service_zone_id, name, address_line, location, opening_hours, is_active)
SELECT m.id, c.id, sz.id, m.display_name || ' — Main', m.display_name || ', Addis Ababa',
  ST_SetSRID(ST_MakePoint(coords.lng, coords.lat), 4326),
  coords.hours_json, true
FROM merchants m
CROSS JOIN cities c
JOIN service_zones sz ON sz.city_id = c.id AND sz.slug = 'central'
CROSS JOIN (VALUES
  ('sunrise-kitchen', 38.7865, 9.0110, '{"default":{"open":"07:00","close":"22:00"}}'::jsonb),
  ('harvest-grocery', 38.7742, 9.0225, '{"default":{"open":"08:00","close":"21:00"}}'::jsonb),
  ('bole-pharmacy', 38.7938, 9.0054, '{"default":{"open":"00:00","close":"23:59"}}'::jsonb),
  ('merkato-electronics', 38.7590, 9.0340, '{"default":{"open":"09:00","close":"20:00"}}'::jsonb),
  ('habesha-table', 38.7661, 9.0148, '{"default":{"open":"11:00","close":"23:00"}}'::jsonb),
  ('green-leaf-market', 38.7991, 9.0269, '{"default":{"open":"07:30","close":"20:30"}}'::jsonb),
  ('bole-books', 38.7889, 8.9972, '{"default":{"open":"09:00","close":"19:00"}}'::jsonb),
  ('express-parcel', 38.7801, 9.0186, '{"default":{"open":"07:00","close":"22:00"}}'::jsonb),
  ('swift-courier', 38.7712, 9.0083, '{"default":{"open":"06:00","close":"23:00"}}'::jsonb)
) AS coords(slug, lng, lat, hours_json)
WHERE c.country_code = 'ET' AND c.slug = 'launch-city'
  AND m.slug = coords.slug
  AND NOT EXISTS (
    SELECT 1 FROM merchant_locations ml2
    WHERE ml2.merchant_id = m.id AND ml2.city_id = c.id AND ml2.name = m.display_name || ' — Main'
  );

UPDATE merchant_locations ml
SET location = ST_SetSRID(ST_MakePoint(coords.lng, coords.lat), 4326),
    opening_hours = coords.hours_json,
    is_active = true
FROM merchants m
JOIN (VALUES
  ('sunrise-kitchen', 38.7865, 9.0110, '{"default":{"open":"07:00","close":"22:00"}}'::jsonb),
  ('harvest-grocery', 38.7742, 9.0225, '{"default":{"open":"08:00","close":"21:00"}}'::jsonb),
  ('bole-pharmacy', 38.7938, 9.0054, '{"default":{"open":"00:00","close":"23:59"}}'::jsonb),
  ('merkato-electronics', 38.7590, 9.0340, '{"default":{"open":"09:00","close":"20:00"}}'::jsonb),
  ('habesha-table', 38.7661, 9.0148, '{"default":{"open":"11:00","close":"23:00"}}'::jsonb),
  ('green-leaf-market', 38.7991, 9.0269, '{"default":{"open":"07:30","close":"20:30"}}'::jsonb),
  ('bole-books', 38.7889, 8.9972, '{"default":{"open":"09:00","close":"19:00"}}'::jsonb),
  ('express-parcel', 38.7801, 9.0186, '{"default":{"open":"07:00","close":"22:00"}}'::jsonb),
  ('swift-courier', 38.7712, 9.0083, '{"default":{"open":"06:00","close":"23:00"}}'::jsonb)
) AS coords(slug, lng, lat, hours_json) ON coords.slug = m.slug
WHERE ml.merchant_id = m.id AND ml.name = m.display_name || ' — Main';

INSERT INTO product_categories (merchant_id, slug, display_name, sort_order)
SELECT m.id, data.slug, data.display_name, data.sort_order
FROM merchants m
JOIN (VALUES
  ('sunrise-kitchen', 'mains', 'Main dishes', 1),
  ('sunrise-kitchen', 'drinks', 'Drinks', 2),
  ('harvest-grocery', 'essentials', 'Essentials', 1),
  ('harvest-grocery', 'produce', 'Fresh produce', 2),
  ('bole-pharmacy', 'medicine', 'Medicine', 1),
  ('bole-pharmacy', 'wellness', 'Wellness', 2),
  ('merkato-electronics', 'phones', 'Phones', 1),
  ('merkato-electronics', 'accessories', 'Accessories', 2),
  ('habesha-table', 'platters', 'Sharing platters', 1),
  ('habesha-table', 'drinks', 'Drinks', 2),
  ('green-leaf-market', 'fruit', 'Fruit boxes', 1),
  ('green-leaf-market', 'juice', 'Fresh juice', 2),
  ('bole-books', 'books', 'Books', 1),
  ('bole-books', 'stationery', 'Stationery', 2)
) AS data(merchant_slug, slug, display_name, sort_order) ON data.merchant_slug = m.slug
ON CONFLICT (merchant_id, slug) DO UPDATE
SET display_name = EXCLUDED.display_name, sort_order = EXCLUDED.sort_order;

INSERT INTO products (merchant_id, category_id, sku, display_name, description, image_url, base_price_minor, currency, is_available)
SELECT m.id, pc.id, data.sku, data.display_name, data.description, data.image_url, data.price_minor, 'ETB', true
FROM merchants m
JOIN (VALUES
  ('sunrise-kitchen', 'mains', 'INJERA-PLATE', 'Injera combo plate', 'Seasonal vegetables, lentils and injera.', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80', 18500),
  ('sunrise-kitchen', 'mains', 'TIBBS', 'Beef tibbs', 'Pan-seared beef with rosemary and awaze.', 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80', 24500),
  ('sunrise-kitchen', 'drinks', 'AVOCADO-JUICE', 'Avocado juice', 'Fresh avocado blended with lime.', 'https://images.unsplash.com/photo-1622597467836-f3285f2131b8?auto=format&fit=crop&w=800&q=80', 4500),
  ('harvest-grocery', 'essentials', 'TEFF-1KG', 'Teff flour 1 kg', 'Stone-milled teff flour.', 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=800&q=80', 42000),
  ('harvest-grocery', 'produce', 'TOMATO-1KG', 'Tomatoes 1 kg', 'Vine-ripened local tomatoes.', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=800&q=80', 9000),
  ('harvest-grocery', 'produce', 'BANANA-BUNCH', 'Banana bunch', 'Naturally ripened bananas.', 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=800&q=80', 6500),
  ('bole-pharmacy', 'medicine', 'PARACETAMOL-500', 'Paracetamol 500 mg', '20 tablet pack for pain and fever.', 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=800&q=80', 3500),
  ('bole-pharmacy', 'wellness', 'VITAMIN-C', 'Vitamin C 1000 mg', '30 effervescent tablets.', 'https://images.unsplash.com/photo-1550572017-edd951b55104?auto=format&fit=crop&w=800&q=80', 12000),
  ('merkato-electronics', 'phones', 'SMARTPHONE-A1', 'Smartphone A1 128 GB', '6.5 inch display, dual SIM, 5000 mAh battery.', 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=800&q=80', 1899900),
  ('merkato-electronics', 'accessories', 'USB-C-20W', 'USB-C charger 20 W', 'Fast charger with cable.', 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=800&q=80', 89500),
  ('habesha-table', 'platters', 'DORO-WAT', 'Doro wat sharing platter', 'Slow-cooked chicken stew with injera.', 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80', 48000),
  ('habesha-table', 'drinks', 'HONEY-WINE', 'Honey wine glass', 'Traditional tej served chilled.', 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&w=800&q=80', 7500),
  ('green-leaf-market', 'fruit', 'FRUIT-BOX', 'Seasonal fruit box', 'Five varieties of fresh fruit.', 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=80', 32000),
  ('green-leaf-market', 'juice', 'MANGO-JUICE', 'Mango juice 1 L', 'Cold-pressed mango juice.', 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=800&q=80', 11000),
  ('bole-books', 'books', 'ATLAS-ET', 'Ethiopia road atlas', 'Detailed road and city maps.', 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=800&q=80', 28000),
  ('bole-books', 'stationery', 'NOTEBOOK-A5', 'A5 ruled notebook', '200 pages, hard cover.', 'https://images.unsplash.com/photo-1531346878377-a5be20888e57?auto=format&fit=crop&w=800&q=80', 6500)
) AS data(merchant_slug, category_slug, sku, display_name, description, image_url, price_minor)
  ON data.merchant_slug = m.slug
JOIN product_categories pc ON pc.merchant_id = m.id AND pc.slug = data.category_slug
ON CONFLICT (merchant_id, sku) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    image_url = EXCLUDED.image_url,
    base_price_minor = EXCLUDED.base_price_minor,
    category_id = EXCLUDED.category_id,
    is_available = EXCLUDED.is_available;

INSERT INTO inventory (product_id, quantity_available)
SELECT p.id, 75
FROM products p
JOIN merchants m ON m.id = p.merchant_id
WHERE m.slug IN ('sunrise-kitchen', 'harvest-grocery', 'bole-pharmacy', 'merkato-electronics', 'habesha-table', 'green-leaf-market', 'bole-books')
ON CONFLICT (product_id) DO UPDATE SET quantity_available = EXCLUDED.quantity_available;

INSERT INTO discovery_banners (title, subtitle, code, cta_label, image_url, accent_color, sort_order, is_active)
VALUES
  ('Fresh meals in 25 minutes', 'Breakfast, lunch and dinner from kitchens near you.', 'FAST25', 'Order food',
   'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80', '#E8613D', 10, true),
  ('20% off your first order', 'Use WELCOME20 at checkout on any merchant.', 'WELCOME20', 'Claim offer',
   'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80', '#2F6B4F', 20, true),
  ('Send parcels across Addis', 'Live tracking, proof of delivery and same-day courier.', 'EXPRESS', 'Book courier',
   'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=80', '#1E2A24', 30, true),
  ('Pharmacy at your door', 'Licensed medicines delivered in under 30 minutes.', 'CARE30', 'Shop pharmacy',
   'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=1200&q=80', '#1E88E5', 40, true)
ON CONFLICT (title) DO UPDATE
SET subtitle = EXCLUDED.subtitle,
    code = EXCLUDED.code,
    cta_label = EXCLUDED.cta_label,
    image_url = EXCLUDED.image_url,
    accent_color = EXCLUDED.accent_color,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;

INSERT INTO promotions (code, display_name, kind, value, currency, minimum_order_minor, maximum_discount_minor, is_active)
VALUES
  ('WELCOME20', '20% off your first order', 'PERCENT', 20, 'ETB', 10000, 20000, true),
  ('FAST50', 'ETB 50 off express delivery', 'FIXED', 5000, 'ETB', 15000, 5000, true)
ON CONFLICT (code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    kind = EXCLUDED.kind,
    value = EXCLUDED.value,
    minimum_order_minor = EXCLUDED.minimum_order_minor,
    maximum_discount_minor = EXCLUDED.maximum_discount_minor,
    is_active = EXCLUDED.is_active;

COMMIT;

