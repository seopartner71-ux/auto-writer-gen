
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS auto_humanize_threshold integer NOT NULL DEFAULT 40
CHECK (auto_humanize_threshold >= 0 AND auto_humanize_threshold <= 100);

COMMENT ON COLUMN public.profiles.auto_humanize_threshold IS
'Порог ai_score (выше = более человеческий): если итоговый ai_score статьи ниже этого значения, она автоматически переписывается через humanize. 0 = функция отключена. По умолчанию 40 (соответствует AI-вероятности 60%).';
