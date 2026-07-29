CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'document-jobs-worker-tick') THEN
    PERFORM cron.unschedule('document-jobs-worker-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'document-jobs-worker-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/document-jobs-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1),
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

UPDATE public.document_types
SET
  primary_model = CASE
    WHEN slug IN ('faq','case','howto') THEN 'anthropic/claude-sonnet-4'
    WHEN slug IN ('whitepaper','catalog') THEN 'anthropic/claude-opus-4'
    ELSE primary_model
  END,
  fallback_model = CASE
    WHEN slug IN ('faq','case','howto') THEN 'anthropic/claude-opus-4'
    WHEN slug IN ('whitepaper','catalog') THEN 'anthropic/claude-opus-4'
    ELSE fallback_model
  END,
  target_length_words = CASE
    WHEN slug = 'faq' THEN '{"min":1200,"max":2600}'::jsonb
    WHEN slug = 'case' THEN '{"min":1200,"max":2600}'::jsonb
    WHEN slug = 'howto' THEN '{"min":700,"max":1500}'::jsonb
    ELSE target_length_words
  END
WHERE slug IN ('faq','case','howto','whitepaper','catalog');

UPDATE public.document_types
SET post_checks_config = jsonb_build_array(
  jsonb_build_object('type','h1_present'),
  jsonb_build_object('type','min_word_count','min',1100),
  jsonb_build_object('type','max_word_count','max',2800),
  jsonb_build_object('type','min_questions_count','min',12),
  jsonb_build_object('type','max_questions_count','max',25),
  jsonb_build_object('type','min_answer_word_count','min',40),
  jsonb_build_object('type','final_section_exact','title','Не нашли ответа?'),
  jsonb_build_object('type','no_forbidden_openings','phrases',jsonb_build_array('в этой статье','в этом документе','в этом faq','как известно','многие задаются вопросом','стоит отметить')),
  jsonb_build_object('type','no_invented_brands'),
  jsonb_build_object('type','context_links_count','min',1,'max',9)
)
WHERE slug = 'faq';

UPDATE public.document_types
SET post_checks_config = jsonb_build_array(
  jsonb_build_object('type','h1_present'),
  jsonb_build_object('type','min_word_count','min',1100),
  jsonb_build_object('type','max_word_count','max',2800),
  jsonb_build_object('type','required_sections','sections',jsonb_build_array('Кратко','Ситуация','Задача','Решение','Результаты','Выводы')),
  jsonb_build_object('type','min_metrics_count','section','Результаты','min',3),
  jsonb_build_object('type','no_forbidden_openings','phrases',jsonb_build_array('в этом кейсе','в этой статье','как известно','стоит отметить')),
  jsonb_build_object('type','no_invented_brands'),
  jsonb_build_object('type','context_links_count','min',1,'max',6),
  jsonb_build_object('type','final_section_exact','title','Хотите такой же результат?')
)
WHERE slug = 'case';

UPDATE public.document_types
SET system_prompt_template = $CASE$
Ты профессиональный редактор кейс-стади. Сделай цельный кейс по теме "{{article.keyword}}" строго по структуре ниже.

## Контекст клиента
Бренд: {{client.name}}
Домен: https://{{client.domain}}
Эксперт-автор: {{client.expert_name}}
Тональность: {{client.brand_voice}}

## ЖЕСТКИЕ ТРЕБОВАНИЯ
- Верни только Markdown.
- Общий объем 1200-2600 слов.
- Все обязательные H2 должны быть в документе: `## Кратко`, `## Ситуация`, `## Задача`, `## Решение`, `## Результаты`, `## Выводы`, `## Хотите такой же результат?`.
- В `## Результаты` обязательно минимум 3 строки с цифрами и единицами: %, ₽, шт, дней, часов, раз. Если точных цифр нет в источнике, используй аккуратные практические диапазоны и пометь их как ориентиры.
- Не выдумывай названия компаний, клиентов и продуктов. Если кейс обезличен - пиши "практика показывает".
- Финальный раздел должен называться ровно `## Хотите такой же результат?`.

## Шаблон
# [Название кейса с ключом]

## Кратко
3-5 предложений: контекст, задача, решение, результат.

## Ситуация
180-300 слов.

## Задача
150-250 слов.

## Решение
350-600 слов, можно использовать пункты `- `.

## Результаты
- Метрика 1: +XX%
- Метрика 2: XX шт / дней / часов
- Метрика 3: XX ₽ / раз / %

## Выводы
- 4-6 практических выводов.

## Хотите такой же результат?
1-3 предложения CTA.

## Ссылки клиента
{{anchors_block}}
{{client_pages_block}}
$CASE$
WHERE slug = 'case';

UPDATE public.document_types
SET system_prompt_template = $FAQ$
Ты профессиональный редактор FAQ. Сделай документ вопросов и ответов по теме "{{article.keyword}}" строго по структуре ниже.

## Контекст клиента
Бренд: {{client.name}}
Домен: https://{{client.domain}}
Эксперт-автор: {{client.expert_name}}
Тональность: {{client.brand_voice}}

## ЖЕСТКИЕ ТРЕБОВАНИЯ
- Верни только Markdown.
- Общий объем 1200-2600 слов.
- 12-25 вопросов H3, каждый заголовок заканчивается `?`.
- Каждый ответ минимум 40 слов.
- Финальный раздел должен называться ровно `## Не нашли ответа?`.
- Не начинай с клише. Не выдумывай бренды, продукты и компании.

## Шаблон
# {{article.keyword}}: ответы на частые вопросы

Короткое вступление 2-3 предложения.

### Вопрос 1?
Ответ минимум 40 слов.

### Вопрос 2?
Ответ минимум 40 слов.

[Продолжи до 12-25 вопросов]

## Не нашли ответа?
1-3 предложения CTA.

## Ссылки клиента
{{anchors_block}}
{{client_pages_block}}
$FAQ$
WHERE slug = 'faq';

UPDATE public.document_generation_jobs
SET status = 'queued', attempts = 0, last_error = null, claimed_at = null, completed_at = null, updated_at = now()
WHERE status = 'failed'
  AND COALESCE(last_error, '') ILIKE '%invalid token%';

UPDATE public.ecosystem_formats ef
SET status = 'queued', progress = 0, error_reason = null, updated_at = now()
FROM public.document_generation_jobs j
WHERE j.ecosystem_format_id = ef.id
  AND j.status = 'queued'
  AND ef.status IN ('queued','generating','failed');