
CREATE TABLE IF NOT EXISTS public.app_prompts (
  key text PRIMARY KEY,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_prompts TO authenticated;
GRANT ALL ON public.app_prompts TO service_role;

ALTER TABLE public.app_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage app_prompts" ON public.app_prompts;
CREATE POLICY "admins manage app_prompts" ON public.app_prompts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "authenticated read app_prompts" ON public.app_prompts;
CREATE POLICY "authenticated read app_prompts" ON public.app_prompts
  FOR SELECT TO authenticated
  USING (true);

INSERT INTO public.app_prompts (key, content) VALUES
  ('fact_critic', 'PLACEHOLDER: критик глубокой проверки. Реальный промпт будет вставлен вручную. На вход подаётся текст статьи. Верни строго JSON-массив findings вида [{"type":"outdated_fact|invented_fact|logic_break|anon_expert|self_repeat|seam","severity":"critical|major|minor","quote":"точная цитата","verdict":"краткий вердикт","suggested_fix":"или null","source_url":"или null","search_query":"или null — заполняй только для устаревающих фактов класса DATED"}]. Без markdown, без пояснений.')
ON CONFLICT (key) DO NOTHING;
