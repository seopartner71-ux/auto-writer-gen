
-- Tracked keywords for rank tracker (Google + Yandex daily positions)
CREATE TABLE public.tracked_keywords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NULL,
  keyword TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'google' CHECK (engine IN ('google','yandex')),
  region TEXT NOT NULL DEFAULT 'ru',
  city TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_checked_at TIMESTAMPTZ NULL,
  last_position INTEGER NULL,
  last_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tracked_keywords_user ON public.tracked_keywords(user_id);
CREATE INDEX idx_tracked_keywords_active ON public.tracked_keywords(is_active) WHERE is_active = true;
CREATE UNIQUE INDEX uq_tracked_keywords_combo
  ON public.tracked_keywords(user_id, keyword, target_domain, engine, region, COALESCE(city,''));

ALTER TABLE public.tracked_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracked_keywords_select_own"
  ON public.tracked_keywords FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tracked_keywords_insert_own"
  ON public.tracked_keywords FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tracked_keywords_update_own"
  ON public.tracked_keywords FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "tracked_keywords_delete_own"
  ON public.tracked_keywords FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_tracked_keywords_updated
  BEFORE UPDATE ON public.tracked_keywords
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Daily history snapshots
CREATE TABLE public.rank_history (
  id BIGSERIAL PRIMARY KEY,
  tracked_keyword_id UUID NOT NULL REFERENCES public.tracked_keywords(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  engine TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  position INTEGER NULL,
  url TEXT NULL,
  raw_top10 JSONB NULL
);

CREATE INDEX idx_rank_history_tracked ON public.rank_history(tracked_keyword_id, checked_at DESC);
CREATE INDEX idx_rank_history_user_date ON public.rank_history(user_id, checked_at DESC);

ALTER TABLE public.rank_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rank_history_select_own"
  ON public.rank_history FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Only edge functions (service role) write history; no client INSERT policy.
