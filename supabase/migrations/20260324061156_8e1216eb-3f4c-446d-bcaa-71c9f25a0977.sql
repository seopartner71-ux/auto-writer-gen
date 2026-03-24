
-- Subscription plans table
CREATE TABLE public.subscription_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_article_limit INTEGER NOT NULL,
  can_use_paa BOOLEAN DEFAULT false,
  can_use_clusters BOOLEAN DEFAULT false,
  can_export_html BOOLEAN DEFAULT false,
  price_rub INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Everyone can read plans
CREATE POLICY "Anyone can view plans" ON public.subscription_plans FOR SELECT USING (true);
-- Only admins can manage
CREATE POLICY "Admins can manage plans" ON public.subscription_plans FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Seed default plans
INSERT INTO public.subscription_plans (id, name, monthly_article_limit, can_use_paa, can_use_clusters, can_export_html, price_rub)
VALUES
  ('free', 'Бесплатный', 3, false, false, false, 0),
  ('basic', 'Базовый', 30, true, false, true, 4900),
  ('pro', 'Профессиональный', 100, true, true, true, 12400);
