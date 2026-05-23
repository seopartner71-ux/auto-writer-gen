# Commercial Page Generator — `/commercial`

Отдельный генератор коммерческих страниц (услуга, категория, товар, локальный бизнес). Полностью переиспользует существующий дизайн-систему, sidebar/topbar shell, кредиты, OpenRouter и редактор.

## 1. База данных (миграция)

Расширяем `articles` без новых таблиц:

- `page_type text default 'article'` — значения: `article | service | category | product | local`
- `commercial_brief jsonb` — сохранённый бриф для регенерации блоков

Индекс по `page_type` для фильтрации. RLS не трогаем — наследуется.

## 2. Edge Function `generate-commercial-block`

`supabase/functions/generate-commercial-block/index.ts`. Использует `_shared/cors`, `_shared/auth`, `_shared/withTimeout`, `_shared/errorHandler`.

Поток:
1. JWT verify через verifyAuth
2. Zod-валидация body: `block_type`, `page_type`, `brief`, `target_words`, `model`
3. План-гейт: NANO ограничен типами `service|local` и базовыми блоками (без `seo_text`, без `geo_seo`)
4. Списание 1 кредита через `deduct_credits_v2` (reason `commercial_block`, metadata = block_type)
5. Построение system+user промпта по шаблону из спеки (правила анти-клише, объём, чистый HTML)
6. OpenRouter call (модель из body, fallback `google/gemini-2.0-flash-lite-001`), `withTimeout(60_000)`
7. При ошибке OpenRouter → `refund_credits` и возврат 502
8. Возврат `{ content, word_count, block_type }`

Содержит маппинг `(page_type, block_type) → промпт-фрагмент` с конкретными инструкциями для каждого блока (H1+лид, выгоды, как работаем, FAQ и т.д.).

## 3. Edge Function `commercial-brief-helper` (AI-помощник в брифе)

Отдельная маленькая функция для генерации УТП и преимуществ. 0 кредитов (лёгкая модель, дешёвая). Rate-limit через `check_rate_limit(user, 'commercial_brief_helper', 30, 60)`.

Body: `{ kind: 'utp'|'benefits', niche, page_type, city? }`
Возврат: `{ items: string[] }` (5 для УТП, 8 для benefits, парсинг JSON-массива из ответа модели).

## 4. Frontend — структура файлов

```text
src/pages/CommercialPage.tsx                    — page shell + wizard state
src/features/commercial/
  ├─ types.ts                                   — PageType, Brief, Block, WizardStep
  ├─ constants.ts                               — карты блоков по типам, иконки, тоны
  ├─ wizard/
  │   ├─ StepIndicator.tsx                      — индикатор шагов (новый, в стиле проекта)
  │   ├─ Step1PageType.tsx                      — 2×2 grid карточек
  │   ├─ Step2Brief.tsx                         — условные поля по page_type
  │   ├─ Step3Blocks.tsx                        — список блоков с toggle + drag
  │   └─ Step4Generate.tsx                      — прогресс + результат + правая панель
  ├─ AIHelperPopover.tsx                        — кнопка "Сгенерировать через AI" + выбор из вариантов
  ├─ hooks/
  │   ├─ useCommercialWizard.ts                 — общий state машины (zustand или useReducer)
  │   └─ useGenerateBlocks.ts                   — последовательная генерация блоков
  └─ utils/
      ├─ buildBlocksForType.ts                  — генерирует дефолтный список блоков по типу + условия (prices/city)
      └─ assembleHtml.ts                        — склейка блоков в финальный HTML
```

## 5. Wizard UI — переиспользуемые компоненты

- Page shell — тот же, что в `ImageGeneratorPage` / `ArticlesPage`
- Topbar — Title + динамический Badge с типом + credits counter
- Карточки — `Card` с glassmorphism (как в проекте)
- Сегментированные контролы — те же что в Image Generator
- Chip-список — компонент из article structure (selectable chips)
- Drag-and-drop для блоков — `@dnd-kit/core` (уже в проекте, проверить, иначе добавить)
- Прогресс генерации — animated pulse dot + текст, как в Image Generator
- Редактор результата — тот же что в article generator (`ArticleEditor`)

Step indicator — новый компонент, но строго в стиле существующих карточек/бордеров. Никаких новых цветов, шрифтов, теней.

## 6. Навигация

В `AppSidebar` (или эквиваленте) в секцию "Контент" после "Статьи" добавить пункт "Коммерческие страницы" с иконкой `Store` (lucide). Маршрут `/commercial` в роутере с lazy import + ProtectedRoute.

## 7. Кредиты и план-гейты

- Стоимость показываем в Step 3: количество включённых блоков (1 кредит = 1 блок)
- Списание через edge функцию по факту генерации каждого блока (атомарно)
- При ошибке любого блока — refund этого блока, остальные сохраняются
- NANO: только `service` и `local`, скрыть `seo_text`/`geo_seo`/`prices` блоки; PRO/FACTORY — всё
- Гейт проверяется и на фронте (показ карточек/блоков), и на бэке (security)

## 8. Сохранение результата

После генерации всех блоков:
- Склеить HTML через `assembleHtml`
- INSERT в `articles`: `title` = H1 из первого блока, `content` = HTML, `page_type` = выбранный тип, `commercial_brief` = весь бриф, `status` = 'draft', `user_id` = auth.uid()
- Кнопка "Сохранить как статью" → переход на `/articles/:id` (редактор уже умеет)
- Кнопки экспорта (WordPress, HTML, DOCX) — переиспользуем существующие из articles

## 9. Тосты

- "Блок сгенерирован" (тихий тост, для каждого блока)
- "Ошибка генерации блока — кредит возвращён"
- "Тип страницы доступен на тарифе PRO" (при попытке выбрать запрещённый тип на NANO)
- "Страница сохранена в Статьи"

## 10. Технические детали (для разработчика)

- Wizard state: `useReducer` с действиями `SET_TYPE`, `SET_BRIEF`, `TOGGLE_BLOCK`, `REORDER`, `NEXT`, `BACK`, `RESET`. localStorage persistence по ключу `commercial-wizard-draft-{userId}` чтобы не терять прогресс
- Условный рендер блоков: `Цены` блок включается только если `brief.has_prices === true`; `Гео-абзац` только если `brief.city` непустой
- Последовательная генерация: `for...of` с `await`, обновление прогресса между блоками, AbortController на случай отмены
- Каждый блок хранится в state как `{ id, type, title, target_words, enabled, content?, status: 'pending'|'generating'|'done'|'error' }` — UI правой панели читает прямо отсюда
- Кнопка "Перегенерировать" блока в Step 4 — пере-вызов той же edge функции, замена `content` в state, без потери остальных
- Подсчёт `word_count` — split по `\s+` на сервере, для итоговой суммы — сумма по блокам
- Полная страница после генерации показывается в read-only режиме первой; после "Сохранить как статью" → редактируемый редактор в `/articles/:id`

## 11. Что НЕ делаем в этой итерации

- Реальный drag-reorder можно отложить (включить toggle, оставить фиксированный порядок) если `@dnd-kit` не подключён — спрошу решение
- Массовая batch-генерация для FACTORY — отдельная фича, не в этой итерации
- Кастомные блоки пользователем — пока только предопределённый набор

## Открытые вопросы

1. Внутри `articles.commercial_brief` хранить как plain jsonb или шифровать через `encrypt_sensitive`? Считаю, что бриф — не sensitive, plain jsonb ок.
2. Drag-reorder блоков обязателен в MVP или можно ограничиться toggle on/off с фиксированным порядком?
3. NANO — действительно "доступно" со скрытыми SEO-блоками, или вообще не показывать `/commercial` в сайдбаре до апгрейда?

Если эти три пункта ок (по умолчанию: plain jsonb, без drag в MVP, NANO видит сайдбар но с ограничениями) — стартую реализацию.