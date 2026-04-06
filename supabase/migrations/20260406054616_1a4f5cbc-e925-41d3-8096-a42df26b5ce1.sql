
CREATE TABLE public.site_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metrica_id text DEFAULT '',
  yandex_verification text DEFAULT '',
  google_verification text DEFAULT '',
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read site_settings"
  ON public.site_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage site_settings"
  ON public.site_settings FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Insert default row
INSERT INTO public.site_settings (metrica_id, yandex_verification, google_verification)
VALUES ('', '', '');
