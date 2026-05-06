
CREATE TABLE public.article_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  keyword text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_article_audits_user_created ON public.article_audits(user_id, created_at DESC);

ALTER TABLE public.article_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own audits" ON public.article_audits
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own audits" ON public.article_audits
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own audits" ON public.article_audits
  FOR DELETE USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.changelog (version, title, is_major, items, release_date)
VALUES (
  '2.7.0',
  'AI-аудит статьи по URL',
  true,
  '[
    {"type":"feature","text":"Новая страница Аудит статьи: вставьте URL и получите отчет за 30 секунд"},
    {"type":"feature","text":"Анализ структуры, плотности ключа, NLP-терминов и сравнение с медианами ТОП-10"},
    {"type":"feature","text":"Конкретные рекомендации и приоритеты для роста в выдаче"},
    {"type":"feature","text":"Кнопка Переписать эту статью переносит данные в генератор"}
  ]'::jsonb,
  CURRENT_DATE
)
ON CONFLICT (version) DO NOTHING;
