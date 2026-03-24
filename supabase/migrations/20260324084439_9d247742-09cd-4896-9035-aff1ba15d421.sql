
CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL DEFAULT '',
  description text,
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage settings
CREATE POLICY "Admins can manage app_settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Authenticated users can read settings (needed for pricing page)
CREATE POLICY "Authenticated can read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- Insert default Polar product IDs
INSERT INTO public.app_settings (key, value, description) VALUES
  ('polar_basic_product_id', '9b2d1bf3-565e-4e56-bd02-e52b008694d1', 'Polar Product ID для тарифа Basic'),
  ('polar_pro_product_id', '04d93830-5940-41d0-8d51-0204713bff08', 'Polar Product ID для тарифа Pro');
