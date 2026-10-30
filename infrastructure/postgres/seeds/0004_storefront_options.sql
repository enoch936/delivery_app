BEGIN;

-- Storefront terms, collection and scheduling support.
UPDATE merchants SET
  supports_pickup = CASE WHEN slug IN ('sunrise-kitchen', 'habesha-table', 'harvest-grocery', 'green-leaf-market', 'bole-pharmacy', 'merkato-electronics', 'bole-books') THEN true ELSE false END,
  allows_scheduling = true,
  min_schedule_lead_minutes = CASE WHEN slug IN ('sunrise-kitchen', 'habesha-table') THEN 45 ELSE 60 END,
  max_schedule_days = CASE WHEN slug IN ('express-parcel', 'swift-courier') THEN 7 ELSE 3 END,
  cancellation_policy = 'Cancel free within 2 minutes of ordering. After the merchant accepts, a cancellation fee up to the order value may apply.',
  refund_policy = 'Refunds return to the original payment method within 5 business days after the merchant confirms the cancellation.',
  pickup_instructions = 'Collect at the counter and quote your order number. Bring a photo ID for pharmacy and electronics orders.'
WHERE slug IN (
  'sunrise-kitchen', 'harvest-grocery', 'bole-pharmacy', 'merkato-electronics', 'habesha-table',
  'green-leaf-market', 'bole-books', 'express-parcel', 'swift-courier'
);

INSERT INTO product_option_groups (product_id, slug, display_name, selection_type, is_required, min_selections, max_selections, sort_order)
SELECT p.id, data.group_slug, data.group_name, data.selection_type, data.is_required, data.min_selections, data.max_selections, data.sort_order
FROM products p
JOIN merchants m ON m.id = p.merchant_id
JOIN (VALUES
  ('sunrise-kitchen', 'INJERA-PLATE', 'protein', 'Choose your protein', 'single', true, 1, 1, 10),
  ('sunrise-kitchen', 'INJERA-PLATE', 'spice', 'Spice level', 'single', true, 1, 1, 20),
  ('sunrise-kitchen', 'INJERA-PLATE', 'extras', 'Add extras', 'multi', false, 0, 3, 30),
  ('sunrise-kitchen', 'TIBBS', 'portion', 'Portion', 'single', true, 1, 1, 10),
  ('sunrise-kitchen', 'TIBBS', 'spice', 'Spice level', 'single', true, 1, 1, 20),
  ('sunrise-kitchen', 'AVOCADO-JUICE', 'size', 'Size', 'single', true, 1, 1, 10),
  ('sunrise-kitchen', 'AVOCADO-JUICE', 'extras', 'Add extras', 'multi', false, 0, 2, 20),
  ('habesha-table', 'DORO-WAT', 'size', 'Platter size', 'single', true, 1, 1, 10),
  ('habesha-table', 'DORO-WAT', 'extras', 'Add extras', 'multi', false, 0, 3, 20),
  ('harvest-grocery', 'TEFF-1KG', 'pack', 'Pack size', 'single', true, 1, 1, 10),
  ('harvest-grocery', 'TOMATO-1KG', 'pack', 'Pack size', 'single', true, 1, 1, 10),
  ('harvest-grocery', 'BANANA-BUNCH', 'size', 'Bunch size', 'single', true, 1, 1, 10),
  ('green-leaf-market', 'FRUIT-BOX', 'size', 'Box size', 'single', true, 1, 1, 10),
  ('green-leaf-market', 'MANGO-JUICE', 'size', 'Bottle size', 'single', true, 1, 1, 10),
  ('bole-pharmacy', 'PARACETAMOL-500', 'pack', 'Pack size', 'single', true, 1, 1, 10),
  ('bole-pharmacy', 'VITAMIN-C', 'pack', 'Pack size', 'single', true, 1, 1, 10),
  ('merkato-electronics', 'SMARTPHONE-A1', 'storage', 'Storage', 'single', true, 1, 1, 10),
  ('merkato-electronics', 'SMARTPHONE-A1', 'colour', 'Colour', 'single', true, 1, 1, 20),
  ('merkato-electronics', 'USB-C-20W', 'cable', 'Cable length', 'single', true, 1, 1, 10),
  ('bole-books', 'NOTEBOOK-A5', 'pack', 'Quantity', 'single', true, 1, 1, 10)
) AS data(merchant_slug, sku, group_slug, group_name, selection_type, is_required, min_selections, max_selections, sort_order)
  ON data.merchant_slug = m.slug AND data.sku = p.sku
ON CONFLICT (product_id, slug) DO UPDATE
SET display_name = EXCLUDED.display_name,
    selection_type = EXCLUDED.selection_type,
    is_required = EXCLUDED.is_required,
    min_selections = EXCLUDED.min_selections,
    max_selections = EXCLUDED.max_selections,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

INSERT INTO product_options (group_id, sku, display_name, price_delta_minor, is_default, is_available, sort_order)
SELECT g.id, data.option_sku, data.display_name, data.price_delta_minor, data.is_default, true, data.sort_order
FROM product_option_groups g
JOIN products p ON p.id = g.product_id
JOIN merchants m ON m.id = p.merchant_id
JOIN (VALUES
  ('sunrise-kitchen', 'INJERA-PLATE', 'protein', 'INJERA-PLATE-LENTIL', 'Misir wot (lentils)', 0, true, 10),
  ('sunrise-kitchen', 'INJERA-PLATE', 'protein', 'INJERA-PLATE-BEEF', 'Beef tibbs', 7000, false, 20),
  ('sunrise-kitchen', 'INJERA-PLATE', 'protein', 'INJERA-PLATE-CHICKEN', 'Chicken wot', 9000, false, 30),
  ('sunrise-kitchen', 'INJERA-PLATE', 'spice', 'INJERA-PLATE-MILD', 'Mild', 0, false, 10),
  ('sunrise-kitchen', 'INJERA-PLATE', 'spice', 'INJERA-PLATE-MEDIUM', 'Medium', 0, true, 20),
  ('sunrise-kitchen', 'INJERA-PLATE', 'spice', 'INJERA-PLATE-HOT', 'Hot', 0, false, 30),
  ('sunrise-kitchen', 'INJERA-PLATE', 'extras', 'INJERA-EXTRA', 'Extra injera', 2000, false, 10),
  ('sunrise-kitchen', 'INJERA-PLATE', 'extras', 'AYIB-CHEESE', 'Ayib cheese', 3000, false, 20),
  ('sunrise-kitchen', 'INJERA-PLATE', 'extras', 'SHIRO-EXTRA', 'Shiro', 2500, false, 30),
  ('sunrise-kitchen', 'TIBBS', 'portion', 'TIBBS-REGULAR', 'Regular', 0, true, 10),
  ('sunrise-kitchen', 'TIBBS', 'portion', 'TIBBS-LARGE', 'Large', 6000, false, 20),
  ('sunrise-kitchen', 'TIBBS', 'spice', 'TIBBS-MILD', 'Mild', 0, false, 10),
  ('sunrise-kitchen', 'TIBBS', 'spice', 'TIBBS-HOT', 'Hot', 0, true, 20),
  ('sunrise-kitchen', 'AVOCADO-JUICE', 'size', 'JUICE-REGULAR', 'Regular', 0, true, 10),
  ('sunrise-kitchen', 'AVOCADO-JUICE', 'size', 'JUICE-LARGE', 'Large', 1500, false, 20),
  ('sunrise-kitchen', 'AVOCADO-JUICE', 'extras', 'JUICE-LIME', 'Extra lime', 500, false, 10),
  ('sunrise-kitchen', 'AVOCADO-JUICE', 'extras', 'JUICE-NOSUGAR', 'No added sugar', 0, false, 20),
  ('habesha-table', 'DORO-WAT', 'size', 'DORO-HALF', 'Half platter', 0, true, 10),
  ('habesha-table', 'DORO-WAT', 'size', 'DORO-FULL', 'Full platter', 45000, false, 20),
  ('habesha-table', 'DORO-WAT', 'extras', 'DORO-EXTRA-INJERA', 'Extra injera', 2000, false, 10),
  ('habesha-table', 'DORO-WAT', 'extras', 'DORO-AYIB', 'Ayib cheese', 3000, false, 20),
  ('harvest-grocery', 'TEFF-1KG', 'pack', 'TEFF-1KG-SINGLE', '1 kg', 0, true, 10),
  ('harvest-grocery', 'TEFF-1KG', 'pack', 'TEFF-5KG', '5 kg', 168000, false, 20),
  ('harvest-grocery', 'TEFF-1KG', 'pack', 'TEFF-25KG', '25 kg', 790000, false, 30),
  ('harvest-grocery', 'TOMATO-1KG', 'pack', 'TOMATO-1KG-SINGLE', '1 kg', 0, true, 10),
  ('harvest-grocery', 'TOMATO-1KG', 'pack', 'TOMATO-3KG', '3 kg', 7000, false, 20),
  ('harvest-grocery', 'BANANA-BUNCH', 'size', 'BANANA-SMALL', 'Small bunch', 0, true, 10),
  ('harvest-grocery', 'BANANA-BUNCH', 'size', 'BANANA-LARGE', 'Large bunch', 9000, false, 20),
  ('green-leaf-market', 'FRUIT-BOX', 'size', 'FRUITBOX-SMALL', 'Small box', 0, true, 10),
  ('green-leaf-market', 'FRUIT-BOX', 'size', 'FRUITBOX-LARGE', 'Large box', 25000, false, 20),
  ('green-leaf-market', 'MANGO-JUICE', 'size', 'MANGO-1L', '1 L', 0, true, 10),
  ('green-leaf-market', 'MANGO-JUICE', 'size', 'MANGO-2L', '2 L', 12000, false, 20),
  ('bole-pharmacy', 'PARACETAMOL-500', 'pack', 'PARA-20', '20 tablets', 0, true, 10),
  ('bole-pharmacy', 'PARACETAMOL-500', 'pack', 'PARA-100', '100 tablets', 9000, false, 20),
  ('bole-pharmacy', 'VITAMIN-C', 'pack', 'VITC-30', '30 tablets', 0, true, 10),
  ('bole-pharmacy', 'VITAMIN-C', 'pack', 'VITC-60', '60 tablets', 15000, false, 20),
  ('merkato-electronics', 'SMARTPHONE-A1', 'storage', 'PHONE-128', '128 GB', 0, true, 10),
  ('merkato-electronics', 'SMARTPHONE-A1', 'storage', 'PHONE-256', '256 GB', 45000, false, 20),
  ('merkato-electronics', 'SMARTPHONE-A1', 'colour', 'PHONE-BLACK', 'Black', 0, true, 10),
  ('merkato-electronics', 'SMARTPHONE-A1', 'colour', 'PHONE-SILVER', 'Silver', 0, false, 20),
  ('merkato-electronics', 'SMARTPHONE-A1', 'colour', 'PHONE-BLUE', 'Blue', 0, false, 30),
  ('merkato-electronics', 'USB-C-20W', 'cable', 'USBC-1M', '1 m', 0, true, 10),
  ('merkato-electronics', 'USB-C-20W', 'cable', 'USBC-2M', '2 m', 2000, false, 20),
  ('bole-books', 'NOTEBOOK-A5', 'pack', 'NOTEBOOK-SINGLE', 'Single notebook', 0, true, 10),
  ('bole-books', 'NOTEBOOK-A5', 'pack', 'NOTEBOOK-PACK5', 'Pack of 5', 18000, false, 20)
) AS data(merchant_slug, sku, group_slug, option_sku, display_name, price_delta_minor, is_default, sort_order)
  ON data.merchant_slug = m.slug AND data.sku = p.sku AND data.group_slug = g.slug
ON CONFLICT (group_id, sku) DO UPDATE
SET display_name = EXCLUDED.display_name,
    price_delta_minor = EXCLUDED.price_delta_minor,
    is_default = EXCLUDED.is_default,
    is_available = EXCLUDED.is_available,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

COMMIT;
