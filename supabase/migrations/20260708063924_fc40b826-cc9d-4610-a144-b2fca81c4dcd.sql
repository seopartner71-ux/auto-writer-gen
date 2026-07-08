ALTER TABLE public.cost_log
  DROP CONSTRAINT IF EXISTS cost_log_operation_type_check;

ALTER TABLE public.cost_log
  ADD CONSTRAINT cost_log_operation_type_check CHECK (
    operation_type = ANY (ARRAY[
      'site_generation'::text,
      'article_generation'::text,
      'llm_call'::text,
      'fal_ai_photo'::text,
      'fal_ai_portrait'::text,
      'fal_ai_logo'::text,
      'cloudflare_deploy'::text,
      'auto_post_cron'::text
    ])
  );

ALTER TABLE public.cost_log
  ADD COLUMN IF NOT EXISTS article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cost_log_article_created
  ON public.cost_log(article_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cost_log_metadata_article_created
  ON public.cost_log((metadata->>'article_id'), created_at DESC)
  WHERE metadata ? 'article_id';