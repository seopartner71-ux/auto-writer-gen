
CREATE TABLE public.legal_pages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.legal_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read legal pages" ON public.legal_pages FOR SELECT USING (true);
CREATE POLICY "Admins can manage legal pages" ON public.legal_pages FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.legal_pages (slug, title, content) VALUES
  ('offer', 'Публичная оферта', ''),
  ('privacy', 'Политика конфиденциальности', ''),
  ('terms', 'Пользовательское соглашение', ''),
  ('cookies', 'Политика использования Cookie', '');
