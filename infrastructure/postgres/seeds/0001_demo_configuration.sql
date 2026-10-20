BEGIN;

INSERT INTO countries (code, display_name, default_currency, default_locale, is_active)
VALUES ('ET', 'Ethiopia', 'ETB', 'en-ET', false)
ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, default_currency = EXCLUDED.default_currency, default_locale = EXCLUDED.default_locale;

INSERT INTO cities (country_code, slug, display_name, timezone, is_active)
VALUES ('ET', 'launch-city', 'Configure launch city', 'Africa/Addis_Ababa', false)
ON CONFLICT (country_code, slug) DO NOTHING;

COMMIT;
