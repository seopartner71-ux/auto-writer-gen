
-- fact_checks: один прогон Глубокой проверки по статье
CREATE TABLE public.fact_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  layer INT NOT NULL DEFAULT 1,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings_count INT NOT NULL DEFAULT 0,
  score INT,
  input_hash TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fact_checks_article ON public.fact_checks(article_id);
CREATE INDEX idx_fact_checks_user ON public.fact_checks(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fact_checks TO authenticated;
GRANT ALL ON public.fact_checks TO service_role;
ALTER TABLE public.fact_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fc_owner_all" ON public.fact_checks FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- fact_check_patches: конкретные патчи/исправления по одному finding
CREATE TABLE public.fact_check_patches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fact_check_id UUID NOT NULL REFERENCES public.fact_checks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  original_text TEXT,
  suggested_text TEXT,
  applied_text TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  offset_start INT,
  offset_end INT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_patches_check ON public.fact_check_patches(fact_check_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fact_check_patches TO authenticated;
GRANT ALL ON public.fact_check_patches TO service_role;
ALTER TABLE public.fact_check_patches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fcp_owner_all" ON public.fact_check_patches FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- client_facts: белый список фактов/цифр/имён клиента, чтобы отличать «безымянных экспертов» от реальных
CREATE TABLE public.client_facts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,
  kind TEXT NOT NULL DEFAULT 'fact',
  key TEXT,
  value TEXT NOT NULL,
  source_url TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_facts_user ON public.client_facts(user_id);
CREATE INDEX idx_client_facts_project ON public.client_facts(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_facts TO authenticated;
GRANT ALL ON public.client_facts TO service_role;
ALTER TABLE public.client_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cf_owner_all" ON public.client_facts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger (общий, не трогаем существующие)
CREATE OR REPLACE FUNCTION public.fact_check_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_fact_checks_touch BEFORE UPDATE ON public.fact_checks
  FOR EACH ROW EXECUTE FUNCTION public.fact_check_touch_updated_at();
CREATE TRIGGER trg_fact_check_patches_touch BEFORE UPDATE ON public.fact_check_patches
  FOR EACH ROW EXECUTE FUNCTION public.fact_check_touch_updated_at();
CREATE TRIGGER trg_client_facts_touch BEFORE UPDATE ON public.client_facts
  FOR EACH ROW EXECUTE FUNCTION public.fact_check_touch_updated_at();
