
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS is_ab_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_articles_is_ab_test ON public.articles(is_ab_test) WHERE is_ab_test = true;

CREATE TABLE IF NOT EXISTS public.ab_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  prompt text NOT NULL,
  mode text NOT NULL,
  runs_per_model integer NOT NULL DEFAULT 1,
  results jsonb NOT NULL DEFAULT '[]'::jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ab_test_runs TO authenticated;
GRANT ALL ON public.ab_test_runs TO service_role;

ALTER TABLE public.ab_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage ab_test_runs" ON public.ab_test_runs;
CREATE POLICY "Admins manage ab_test_runs"
  ON public.ab_test_runs
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
