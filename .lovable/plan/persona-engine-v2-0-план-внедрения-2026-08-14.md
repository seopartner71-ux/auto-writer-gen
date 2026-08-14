# Persona Engine v2.0 - план внедрения

Новый слой поверх существующего SEO-Модуля. Ничего из работающего (Writer, Research, Structure, Polish, Quality, GEO, author_profiles) не переписываем - только добавляем.

## Что появится у пользователя

Новый раздел меню "Persona Engine" (/persona-engine) с подзаголовком "Управление стилями авторов для генерации контента":
- список карточек персон (имя, роль, сайт, тематика, голос, экспертиза, статус, версия, использований, дата),
- создание персоны в 4 шага: URL сайта -> анализ сайта (Site DNA) -> описание автора обычным языком + примеры текстов + ползунки стиля -> сформированная Persona DNA / Style DNA / Master Prompt,
- Simple Mode (URL, описание, примеры, стиль) и Advanced Mode (все DNA-блоки, политики, Master Prompt, версии, evaluation),
- Test Lab: пишем задачу - получаем текст и Persona Match Score с разбивкой и списком отклонений,
- A/B сравнение двух персон на одной задаче,
- импорт/экспорт (JSON, Master Prompt, отчёт), дублирование, версии, статусы Draft/Active/Testing/Archived,
- Persona Health Score с подсказками и Quality Gate перед переводом в Active.

В Writer добавляется один селектор "Persona" (без персоны / список Active). Существующий выбор автора остаётся как есть.

## Этапы

Реализую поэтапно, каждый этап рабочий сам по себе.

Этап 1 - Данные и Site DNA
- Новые таблицы: `site_dna`, `personas`, `persona_versions`, `persona_evaluations`, `persona_style_examples`. Существующие таблицы не трогаем.
- Edge Function `site-dna-analyze`: разбор URL, извлечение фактов о компании, строгое правило null/unknown вместо выдумок. Результат кэшируется, обновление - только по кнопке.

Этап 2 - Prompt Engineer и компилятор
- Edge Function `persona-compile`: человеческое описание + примеры + Site DNA -> Persona DNA, Style DNA, Fact/Source/SEO/GEO/Anti-AI политики, Quality Control, confidence по каждому параметру, разрешение конфликтов и модель приоритетов.
- Клиентский Prompt Compiler (`personaCompiler.ts`): Persona DNA -> Master Prompt, дедупликация правил, перевод абстракций в наблюдаемое поведение. Master Prompt всегда производный, руками его править не нужно.
- Style Fingerprint по примерам текстов (метрики предложений, абзацев, вопросов, первого лица, терминов).

Этап 3 - Интерфейс раздела
- Страница, карточки, мастер создания, Advanced-панели, редактор Site DNA, версии, импорт/экспорт, Health Score.

Этап 4 - Test Lab и Evaluation
- Edge Function `persona-evaluate`: сравнение сгенерированного текста с Persona DNA, Persona Match Score по 12 метрикам, список отклонений, предложения улучшений (применяются только по подтверждению).
- Test Lab и A/B сравнение.

Этап 5 - Подключение к Writer
- Минимальное additive изменение: селектор Persona в форме генерации, передача `persona_context` (Site DNA + Persona DNA + Platform DNA) в существующие функции генерации как дополнительное поле. Логика генерации не меняется - только добавляется блок контекста в промпт.
- Platform DNA (website, dzen, vc, telegraph, external_media) как отдельный справочник, Persona остаётся неизменной.

## Технические детали

- Файлы в новой папке `src/features/persona-engine/` (page, components, services, types, prompts, validators, utils) + маршрут в App.tsx и пункт меню в AppSidebar.
- Используем существующий design system (shadcn, токены, стили app-shell), никаких глобальных изменений CSS.
- Модели: Gemini 2.5 Flash для анализа сайта и стиля, Sonnet для компиляции Persona DNA и evaluation.
- RLS: пользователь видит только свои персоны, админ - все. GRANT для всех новых таблиц.
- Изменяемые существующие файлы: `App.tsx` (маршрут), `AppSidebar.tsx` (пункт меню), форма генерации Writer (селектор + проброс контекста), функция генерации статьи (чтение опционального `persona_context`). Больше ничего.

## Что не меняем

Research, Structure, Polish, Quality, GEO, author_profiles и PersonaSelector, проекты, пользователи, платежи, существующие маршруты и API.
