-- 4 new document types: faq, case, whitepaper, catalog

INSERT INTO public.document_types (
  slug, name, description, category,
  target_length_words, target_pages,
  primary_model, fallback_model,
  ui_priority, is_active,
  preferred_distribution_platforms,
  anchors_config, client_pages_config,
  system_prompt_template,
  post_checks_config,
  pdf_template_config,
  html_landing_config
) VALUES

-- ================== FAQ ==================
(
  'faq',
  'FAQ / Частые вопросы',
  'Документ вопрос-ответ с 15-25 частыми вопросами по теме. 5-15 страниц. Идеален для базы знаний, службы поддержки, SEO-охвата длинного хвоста запросов.',
  'pdf',
  '{"min":1500,"max":3500}'::jsonb,
  '{"min":5,"max":15}'::jsonb,
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-opus-4',
  60, true,
  '["github_pages","docdroid"]'::jsonb,
  '{"count_min":2,"count_max":3,"placement":"body"}'::jsonb,
  '{"count_min":3,"count_max":6,"placement_rules":"anywhere"}'::jsonb,
  $PROMPT$Ты создаёшь FAQ-документ (частые вопросы и ответы) по теме "{{article.keyword}}".

СТРУКТУРА (строго):
# {{article.title}}

Короткий вводный абзац (2-3 предложения) — что найдёт читатель, для кого документ.

## Оглавление вопросов
- Вопрос 1
- Вопрос 2
- ...

## Вопросы и ответы

### Вопрос 1 текстом полностью — с знаком вопроса в конце?
Ответ 80-200 слов. Конкретика, цифры, примеры. Никакой воды.

### Вопрос 2 текстом полностью?
Ответ 80-200 слов.

... (всего 15-25 вопросов) ...

## Не нашли ответа?
2-3 предложения с CTA — обратиться к эксперту клиента.

ПРАВИЛА:
- 15-25 вопросов, каждый заканчивается знаком вопроса
- Вопросы отражают реальные интенты: что, почему, как, сколько, когда, стоит ли, чем отличается
- Ответы конкретные с цифрами и примерами, не абстрактные советы
- Никаких вводных фраз "в этой статье", "как известно"
- НЕ выдумывай названия брендов, компаний, продуктов, которых нет в источнике
- 5-9 контекстных ссылок в теле ответов (маркдаун-формат [текст](url))
- 2-3 ссылки на якоря клиента органично в ответах
- Финальный блок ровно "## Не нашли ответа?"
$PROMPT$,
  '[
    {"type":"h1_present"},
    {"type":"min_word_count","min":1400},
    {"type":"max_word_count","max":3700},
    {"type":"min_questions_count","min":15},
    {"type":"max_questions_count","max":30},
    {"type":"min_answer_word_count","min":50},
    {"type":"final_section_exact","title":"Не нашли ответа?"},
    {"type":"no_forbidden_openings","phrases":["в этой статье","в этом документе","в этом faq","как известно","многие задаются вопросом","стоит отметить"]},
    {"type":"no_invented_brands"},
    {"type":"context_links_count","min":5,"max":9}
  ]'::jsonb,
  '{
    "version":"1.0",
    "structure":[
      {"block":"cover","elements":["logo","h1_title","subtitle","banner_from_unsplash"],"subtitle":"Ответы на частые вопросы"},
      {"block":"faq_toc","title":"Оглавление вопросов"},
      {"block":"faq_sections","keep_together":true},
      {"block":"final_help_box","title":"Не нашли ответа?"},
      {"block":"author_card_full","background":"light_tint"},
      {"block":"cta_button","text":"Задать вопрос эксперту","utm_content":"cta_faq"},
      {"block":"brand_footer_pagination","left_content":"{{expert_name}}, {{brand_name}}","right_content":"{{domain}}"}
    ]
  }'::jsonb,
  '{
    "schema_type":"FAQPage",
    "hero_image":true,
    "content_placement":"full",
    "cta_placement":"bottom",
    "structured_data_faq_items":true,
    "download_button_text":"Скачать FAQ в PDF"
  }'::jsonb
),

-- ================== CASE ==================
(
  'case',
  'Кейс-стади',
  'История клиента с конкретными цифрами и результатами. 3-8 страниц. Формат Ситуация → Задача → Решение → Результаты. Идеален для LinkedIn Publisher и лидогенерации в B2B.',
  'pdf',
  '{"min":1500,"max":3000}'::jsonb,
  '{"min":3,"max":8}'::jsonb,
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-opus-4',
  65, true,
  '["github_pages","linkedin_publisher"]'::jsonb,
  '{"count_min":1,"count_max":2,"placement":"body"}'::jsonb,
  '{"count_min":2,"count_max":4,"placement_rules":"anywhere"}'::jsonb,
  $PROMPT$Ты создаёшь кейс-стади по теме "{{article.keyword}}" — конкретную историю из практики эксперта клиента.

СТРУКТУРА (строго, все H2 обязательны):
# {{article.title}}

## Кратко
3-4 предложения summary всей истории — контекст, что сделали, какой результат в цифрах.

## Ситуация
Опиши исходный контекст клиента: отрасль, масштаб, что было до. 150-250 слов, конкретика.

## Задача
Чётко сформулируй, что нужно было решить и почему это было сложно. 100-200 слов.

## Решение
Подробно: какая техника, подход, шаги. Что делали и в каком порядке. 300-500 слов. Стиль нарратива — рассказываем как историю.

## Результаты
Минимум 3 конкретных метрики с числами (проценты, время, стоимость, объём). Например:
- +40% урожайности
- -60% времени на обработку
- 2.5 млн ₽ дополнительной выручки

## Выводы
Bullet-список практических выводов для читателя. 4-6 пунктов.

## Хотите такой же результат?
CTA на консультацию с экспертом — 2-3 предложения.

ПРАВИЛА:
- В блоке "Результаты" обязательно минимум 3 конкретных метрики с числами и единицами (%, ₽, ч, шт, раз)
- Стиль нарратив, не отчёт
- 3-6 контекстных ссылок
- НЕ выдумывай названия компаний и продуктов
- Никаких "в этом кейсе", "стоит отметить"
- Финальный блок ровно "## Хотите такой же результат?"
$PROMPT$,
  '[
    {"type":"h1_present"},
    {"type":"min_word_count","min":1400},
    {"type":"max_word_count","max":3200},
    {"type":"required_sections","sections":["Кратко","Ситуация","Задача","Решение","Результаты","Выводы"]},
    {"type":"min_metrics_count","section":"Результаты","min":3},
    {"type":"no_forbidden_openings","phrases":["в этом кейсе","в этой статье","как известно","стоит отметить"]},
    {"type":"no_invented_brands"},
    {"type":"context_links_count","min":3,"max":6},
    {"type":"final_section_exact","title":"Хотите такой же результат?"}
  ]'::jsonb,
  '{
    "version":"1.0",
    "structure":[
      {"block":"cover","elements":["logo","h1_title","subtitle","banner_from_unsplash"],"subtitle":"Кейс из практики"},
      {"block":"summary_hero_box","source_section":"Результаты"},
      {"block":"narrative_sections","sections":["Ситуация","Задача","Решение","Результаты"]},
      {"block":"results_metrics_box","title":"Результаты"},
      {"block":"practical_conclusions_box","title":"Выводы"},
      {"block":"final_cta_section","title":"Хотите такой же результат?","cta_text":"Обсудить с экспертом","utm_content":"cta_case"},
      {"block":"author_card_full"},
      {"block":"brand_footer_pagination","left_content":"{{expert_name}}, {{brand_name}}","right_content":"{{domain}}"}
    ]
  }'::jsonb,
  '{
    "schema_type":"Article",
    "article_section":"Case Study",
    "hero_image":true,
    "content_placement":"full",
    "cta_placement":"top_and_bottom",
    "structured_data_include_result_metrics":true,
    "download_button_text":"Скачать кейс в PDF"
  }'::jsonb
),

-- ================== WHITEPAPER ==================
(
  'whitepaper',
  'Whitepaper / Аналитический отчёт',
  'Крупный аналитический документ с исследованием темы, выводами и рекомендациями. 15-30 страниц. Для распространения через Yumpu, Issuu, LinkedIn — B2B-аудитория, экспертный контент.',
  'pdf',
  '{"min":4000,"max":7000}'::jsonb,
  '{"min":15,"max":30}'::jsonb,
  'anthropic/claude-opus-4',
  'anthropic/claude-opus-4',
  55, true,
  '["yumpu","issuu","linkedin_publisher","github_pages"]'::jsonb,
  '{"count_min":2,"count_max":3,"placement":"body"}'::jsonb,
  '{"count_min":4,"count_max":8,"placement_rules":"by_h2"}'::jsonb,
  $PROMPT$Ты создаёшь whitepaper (аналитический отчёт) по теме "{{article.keyword}}" — это не пересказ, а анализ данных, трендов и обоснованных выводов.

СТРУКТУРА (строго):
# {{article.title}}

## Executive Summary
300-500 слов. Структура: контекст → главные находки → главные рекомендации (5-7 предложений структурированно).

## Глава 1: [название]
Анализ факта → тренд/паттерн → импликации для читателя. 500-900 слов.

## Глава 2: [название]
...

(всего 4-6 аналитических глав)

## Ключевые выводы
5-8 конкретных находок как bullet-список:
- Первая находка с обоснованием
- Вторая находка
- ...

## Рекомендации
5-7 конкретных действий, что делать читателю, bullet-список:
- Рекомендация 1
- Рекомендация 2
- ...

ПРАВИЛА:
- Стиль академический но не сухой, экспертный
- Каждая глава: анализ факта → тренд → импликации
- Ключевые выводы — минимум 5 буллет-пунктов, конкретные находки
- Рекомендации — минимум 5 буллет-пунктов, конкретные действия
- Никаких вводных фраз, filler-слов
- НЕ выдумывай статистику, названия, компании
- 6-11 контекстных ссылок с обоснованиями
$PROMPT$,
  '[
    {"type":"h1_present"},
    {"type":"min_word_count","min":3800},
    {"type":"max_word_count","max":7500},
    {"type":"h2_count","min":6,"max":12},
    {"type":"executive_summary_present","title":"Executive Summary","min_words":300,"max_words":600},
    {"type":"key_findings_present","title":"Ключевые выводы","min":5},
    {"type":"recommendations_present","title":"Рекомендации","min":5},
    {"type":"no_forbidden_openings","phrases":["в этом отчёте","в этой статье","как известно","стоит отметить","нельзя не отметить"]},
    {"type":"no_invented_brands"},
    {"type":"no_verbose_intro"},
    {"type":"context_links_count","min":6,"max":11}
  ]'::jsonb,
  '{
    "version":"1.0",
    "structure":[
      {"block":"cover_expert","subtitle":"Аналитический отчёт","category":"WHITEPAPER"},
      {"block":"table_of_contents","title":"Содержание"},
      {"block":"executive_summary_box","title":"Executive Summary"},
      {"block":"research_chapters","chapter_prefix":"Глава {n}","chapter_start_new_page":true,"h2_font_size":22},
      {"block":"key_findings_list","title":"Ключевые выводы"},
      {"block":"recommendations_box","title":"Рекомендации"},
      {"block":"author_card_full","background":"light_tint"},
      {"block":"cta_button","text":"Обсудить исследование","utm_content":"cta_whitepaper"},
      {"block":"back_cover"},
      {"block":"brand_footer_pagination","left_content":"{{expert_name}}, {{brand_name}}","right_content":"{{domain}}"}
    ]
  }'::jsonb,
  '{
    "schema_type":"Report",
    "hero_image":true,
    "content_placement":"excerpt_with_download",
    "excerpt_paragraphs":4,
    "excerpt_source_section":"Executive Summary",
    "prominent_download_button":true,
    "download_button_text":"Скачать полный whitepaper (PDF)",
    "download_button_size":"extra_large",
    "author_card_placement":"sidebar",
    "cta_placement":"bottom"
  }'::jsonb
),

-- ================== CATALOG ==================
(
  'catalog',
  'Каталог продуктов',
  'Структурированный каталог продуктов или услуг клиента. 15-40 страниц. Категории и элементы с описаниями. Для распространения через Yumpu, Issuu, Archive.org.',
  'pdf',
  '{"min":3000,"max":8000}'::jsonb,
  '{"min":15,"max":40}'::jsonb,
  'anthropic/claude-opus-4',
  'anthropic/claude-opus-4',
  50, true,
  '["yumpu","issuu","archive_org"]'::jsonb,
  '{"count_min":1,"count_max":2,"placement":"final"}'::jsonb,
  '{"count_min":8,"count_max":20,"placement_rules":"anywhere"}'::jsonb,
  $PROMPT$Ты создаёшь каталог по теме "{{article.keyword}}" — структурированный список с категориями и элементами.

СТРУКТУРА (строго):
# {{article.title}}

Короткое введение (100-150 слов) — для кого каталог, как им пользоваться.

## Оглавление категорий
- Категория 1: краткое пояснение
- Категория 2: краткое пояснение
- ...

## Категория 1: [название]
2-3 предложения о категории.

### Название элемента 1
Описание 2-3 предложения — что это, для кого, ключевая особенность.

- Характеристика 1
- Характеристика 2
- Характеристика 3
- (3-5 характеристик)

### Название элемента 2
...

## Категория 2: [название]
...

(всего 3-6 категорий по 5-15 элементов в каждой)

## Как выбрать?
3-5 конкретных критериев для читателя, bullet-список.

ПРАВИЛА:
- 3-6 категорий, в каждой минимум 5 элементов (H3)
- Каждый элемент: 2-3 предложения описания + 3-5 буллет-характеристик
- Категории должны иметь чёткую логику разбиения (по назначению, цене, типу)
- Финальный блок ровно "## Как выбрать?"
- НЕ выдумывай названия продуктов, которых нет в источнике
- 9-22 контекстных ссылок — каждый элемент может ссылаться на страницу клиента
- Никаких вводных фраз "в этом каталоге", "как известно"
$PROMPT$,
  '[
    {"type":"h1_present"},
    {"type":"min_word_count","min":2800},
    {"type":"max_word_count","max":8500},
    {"type":"toc_present","title":"Оглавление категорий"},
    {"type":"category_headers_count","pattern":"^##\\s+Категория","min":3,"max":6},
    {"type":"items_per_category_min","category_pattern":"^##\\s+Категория","min":5},
    {"type":"final_section_exact","title":"Как выбрать?"},
    {"type":"no_forbidden_openings","phrases":["в этом каталоге","в этой статье","как известно"]},
    {"type":"no_invented_brands"},
    {"type":"context_links_count","min":9,"max":22}
  ]'::jsonb,
  '{
    "version":"1.0",
    "structure":[
      {"block":"cover","elements":["logo","h1_title","banner_from_unsplash"]},
      {"block":"catalog_toc","title":"Оглавление категорий"},
      {"block":"category_headers","category_pattern":"^Категория","start_new_page":true},
      {"block":"selection_guide","title":"Как выбрать?"},
      {"block":"author_card_full"},
      {"block":"cta_button","text":"Задать вопрос по каталогу","utm_content":"cta_catalog"},
      {"block":"back_cover"},
      {"block":"brand_footer_pagination","left_content":"{{brand_name}}","right_content":"{{domain}}"}
    ]
  }'::jsonb,
  '{
    "schema_type":"ItemList",
    "hero_image":true,
    "content_placement":"excerpt_with_download",
    "excerpt_paragraphs":2,
    "prominent_download_button":true,
    "download_button_text":"Скачать полный каталог (PDF)",
    "download_button_size":"extra_large",
    "cta_placement":"bottom"
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  target_length_words = EXCLUDED.target_length_words,
  target_pages = EXCLUDED.target_pages,
  primary_model = EXCLUDED.primary_model,
  fallback_model = EXCLUDED.fallback_model,
  ui_priority = EXCLUDED.ui_priority,
  is_active = EXCLUDED.is_active,
  preferred_distribution_platforms = EXCLUDED.preferred_distribution_platforms,
  anchors_config = EXCLUDED.anchors_config,
  client_pages_config = EXCLUDED.client_pages_config,
  system_prompt_template = EXCLUDED.system_prompt_template,
  post_checks_config = EXCLUDED.post_checks_config,
  pdf_template_config = EXCLUDED.pdf_template_config,
  html_landing_config = EXCLUDED.html_landing_config,
  updated_at = now();
