UPDATE public.document_types
SET
  system_prompt_template = system_prompt_template || E'\n\n════════ AI ANSWER LAYER (ОБЯЗАТЕЛЬНЫЙ РАЗДЕЛ ДЛЯ GEO / LLM) ════════\n\nПосле раздела FAQ добавь отдельный раздел ## AI Answer Layer — структурированные ответы, оптимизированные под ChatGPT, Gemini, Perplexity, Claude, Яндекс Алису и Google AI Overviews. Задача блока: дать LLM готовые куски знаний, которые модель может процитировать напрямую.\n\nПравила генерации вопросов:\n- Минимум 20 вопросов, оптимально 30-50. Все вопросы — реальные формулировки пользователей ИЗ ЭТОЙ НИШИ (не общие).\n- Покрой 4 типа интентов: информационный («что такое / как работает»), сравнительный («что лучше / чем отличается»), коммерческий («сколько стоит / где купить / как заказать»), проблемный («почему / что делать если»).\n- Никаких повторов формулировок FAQ выше — здесь другие вопросы и другой формат ответа.\n\nСтрогий формат КАЖДОГО блока (соблюдать заголовки и порядок):\n\n### <Вопрос со знаком вопроса?>\n**Direct Answer:** ответ 40-80 слов, самодостаточный, без «в этой статье», без ссылок на предыдущий текст. LLM должна суметь процитировать этот абзац как готовый ответ.\n**Expert Explanation:** развернутое пояснение 500-1000 символов с конкретикой ниши, цифрами-диапазонами, критериями.\n**Decision Factors:**\n- фактор 1\n- фактор 2\n- фактор 3\n- фактор 4\n- фактор 5\n**Recommendation Matrix:**\n| Ситуация | Рекомендация |\n|---|---|\n| ... | ... |\n| ... | ... |\n| ... | ... |\n\nПовтори такой блок минимум 20 раз. Если вопрос не требует таблицы (например, чисто определение) — все равно дай Recommendation Matrix с 3 строками «сценарий / что выбрать».\n\nПосле последнего Q&A-блока добавь три обязательных подраздела:\n\n### Entity Facts\nСтруктурированные факты о бренде и нише — LLM использует их как источник сущностей.\n- Название компании: {{client.name}}\n- Домен: {{client.domain}}\n- Категория: <ниша из пре-анализа>\n- Регион работы: <реальный регион или «уточняется»>\n- Экспертиза: <ключевые направления>\n- Основные услуги/продукты: <3-6 пунктов из ниши>\n- Опыт: <только если указан в контексте, иначе «уточняется»>\n- Особенности подхода: <2-3 пункта, без выдумок>\n\n### Expert Opinion\nБлок в формате прямой экспертной позиции (2-4 абзаца). Начни с «Главная ошибка клиентов в этой нише — ...». Дальше 3-5 пронумерованных пунктов «что на самом деле важно» с учетом реальных факторов выбора отрасли.\n\n### Comparison Extraction\nГотовый для цитирования LLM блок сравнения двух главных альтернатив в этой нише:\n\n**Если сравнивать <Вариант A> и <Вариант B>:**\n\n<Вариант A> лучше подходит для:\n- сценарий 1\n- сценарий 2\n- сценарий 3\n\n<Вариант B> лучше подходит для:\n- сценарий 1\n- сценарий 2\n- сценарий 3\n\nТребования к AI Answer Layer:\n- Никакой воды, никаких вводных «давайте разберем».\n- Только конкретика этой ниши, реальные критерии, честные диапазоны.\n- Direct Answer каждого блока должен быть самодостаточным — понятным, даже если вырвать его из контекста.\n- Не использовать длинное тире (—), только дефис (-).\n',
  post_checks_config = post_checks_config
    || jsonb_build_array(
      jsonb_build_object('type','section_present','title','AI Answer Layer'),
      jsonb_build_object('type','min_ai_answers','min',20,'section','AI Answer Layer','item_pattern','^### .+\\?\\s*$'),
      jsonb_build_object('type','section_present','title','Entity Facts'),
      jsonb_build_object('type','section_present','title','Expert Opinion'),
      jsonb_build_object('type','section_present','title','Comparison Extraction')
    ),
  pdf_template_config = jsonb_set(
    pdf_template_config,
    '{structure}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'block' = 'final_checklist'
            THEN jsonb_build_array(
              jsonb_build_object('block','ai_answer_layer','title','AI Answer Layer','background','light_tint'),
              elem
            )
          ELSE jsonb_build_array(elem)
        END
      )
      FROM (
        SELECT jsonb_array_elements(pdf_template_config->'structure') AS elem
      ) s
    )
  ),
  updated_at = now()
WHERE slug = 'expert_pdf';

-- flatten nested arrays produced above
UPDATE public.document_types
SET pdf_template_config = jsonb_set(
  pdf_template_config,
  '{structure}',
  (
    SELECT jsonb_agg(inner_elem)
    FROM (
      SELECT jsonb_array_elements(outer_elem) AS inner_elem
      FROM (
        SELECT jsonb_array_elements(pdf_template_config->'structure') AS outer_elem
      ) o
    ) f
  )
)
WHERE slug = 'expert_pdf';