
-- сбрасываем старые (созданные на прошлом шаге, пустые)
DROP TABLE IF EXISTS public.fact_check_patches CASCADE;
DROP TABLE IF EXISTS public.fact_checks CASCADE;
DROP TABLE IF EXISTS public.client_facts CASCADE;

-- fact_checks
CREATE TABLE public.fact_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | awaiting_verification | done | failed
  layer1_findings JSONB,
  critic_findings JSONB,
  factcheck_findings JSONB,
  fact_score INT,
  cost_usd NUMERIC(8,4),
  created_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_fact_checks_article ON public.fact_checks(article_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fact_checks TO authenticated;
GRANT ALL ON public.fact_checks TO service_role;
ALTER TABLE public.fact_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fc_owner_all" ON public.fact_checks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.articles a WHERE a.id = fact_checks.article_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.articles a WHERE a.id = fact_checks.article_id AND a.user_id = auth.uid()));

-- fact_check_patches
CREATE TABLE public.fact_check_patches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_check_id UUID REFERENCES public.fact_checks(id) ON DELETE CASCADE,
  article_id UUID NOT NULL,
  old_fragment TEXT NOT NULL,
  new_fragment TEXT NOT NULL,
  applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,
  snapshot_before TEXT
);
CREATE INDEX idx_patches_check ON public.fact_check_patches(fact_check_id);
CREATE INDEX idx_patches_article ON public.fact_check_patches(article_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fact_check_patches TO authenticated;
GRANT ALL ON public.fact_check_patches TO service_role;
ALTER TABLE public.fact_check_patches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fcp_owner_all" ON public.fact_check_patches FOR ALL
  USING (EXISTS (SELECT 1 FROM public.articles a WHERE a.id = fact_check_patches.article_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.articles a WHERE a.id = fact_check_patches.article_id AND a.user_id = auth.uid()));

-- client_facts
CREATE TABLE public.client_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  kind TEXT NOT NULL, -- 'stoplist' | 'catalog' | 'fact'
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_client_facts_client ON public.client_facts(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_facts TO authenticated;
GRANT ALL ON public.client_facts TO service_role;
ALTER TABLE public.client_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cf_owner_all" ON public.client_facts FOR ALL
  USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id);
