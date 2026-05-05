CREATE TABLE public.topical_maps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  topic TEXT NOT NULL,
  geo TEXT NOT NULL DEFAULT 'ru',
  language TEXT NOT NULL DEFAULT 'ru',
  clusters JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_keywords INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.topical_maps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own topical maps"
  ON public.topical_maps FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own topical maps"
  ON public.topical_maps FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own topical maps"
  ON public.topical_maps FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins manage all topical maps"
  ON public.topical_maps FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_topical_maps_user_created ON public.topical_maps(user_id, created_at DESC);