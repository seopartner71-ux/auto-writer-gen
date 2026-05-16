INSERT INTO public.app_settings (key, value, description) VALUES
  ('prodamus_nano_annual_link', '', 'Prodamus form link for annual NANO subscription'),
  ('prodamus_basic_annual_link', '', 'Prodamus form link for annual PRO subscription'),
  ('prodamus_pro_annual_link', '', 'Prodamus form link for annual FACTORY subscription'),
  ('polar_nano_annual_product_id', '', 'Polar product ID for annual NANO plan (USD)'),
  ('polar_basic_annual_product_id', '', 'Polar product ID for annual PRO plan (USD)'),
  ('polar_pro_annual_product_id', '', 'Polar product ID for annual FACTORY plan (USD)'),
  ('annual_discount_percent', '20', 'Discount percent applied to annual checkout vs monthly x12')
ON CONFLICT (key) DO NOTHING;