
UPDATE public.document_types
SET primary_model = 'anthropic/claude-sonnet-4.5',
    fallback_model = 'anthropic/claude-haiku-4.5',
    target_length_words = jsonb_build_object('min', 2500, 'max', 3800)
WHERE slug = 'guide';

UPDATE public.ecosystem_formats
SET status = 'failed',
    error_reason = 'Таймаут генерации (Opus). Попробуйте снова - модель переведена на Sonnet 4.5.',
    progress = 0
WHERE status = 'generating'
  AND started_at < now() - interval '5 minutes';
