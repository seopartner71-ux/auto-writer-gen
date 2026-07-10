# /rewrite — рерайт чужих статей

Переиспользуем existing pipeline (`improve-article`, quality-check, humanizePass, validators, judges). Ничего в нём не ломаем — добавляем новый профиль и новый источник черновиков.

## 1. Данные (миграция)

- `articles`: добавить `source text default 'generated'` (значения: `generated | rewrite | factory | vc_writer`) и `humanize_profile text default 'standard'` (`standard | conservative`). Backfill существующих в `generated`.
- Индекс: `create index on articles(user_id, source) where source = 'rewrite';`
- `cost_log`: колонка уже есть, будем писать `source='rewrite'` через существующее поле context/meta (проверю по факту — если поля source нет, добавлю).
- Никаких новых таблиц.

## 2. Роут и навигация

- Роут `/rewrite` в `App.tsx` под `ProtectedRoute`.
- Пункт в `AppSidebar` в группе «Создать» (после «Новая статья»), иконка `Wand2`.
- Ключи в `src/shared/i18n/article.ts` неймспейс `rewrite.*`.

## 3. UI — `src/pages/RewritePage.tsx`

Одна страница, горизонтальный степпер (Вход → Аудит → Исправление), состояние в локальном reducer + URL-параметр `?article=<id>` для F5-safe восстановления.

### Шаг 1 — Вход
Компонент `RewriteInput.tsx`:
- textarea 50 000 знаков + live-счётчик, вставка HTML/MD/plain.
- upload `.docx` (mammoth → HTML) и `.md` (readAsText).
- поля: главный ключ (required), URL источника (optional).
- Автодетект языка: доля кириллицы > 30% → `ru`, иначе `en`. Селектор языка с ручным override.
- Кнопка «Проверить бесплатно».

### Шаг 2 — Аудит (0 кредитов)
При клике:
1. Insert в `articles`: `source='rewrite'`, `status='draft'`, `content`, `language`, `main_keyword`, `source_url`, `humanize_profile='conservative'`.
2. Вызов существующего `quality-check` с флагом `mode='audit'` (уже поддерживается — только пре-скан без LLM).
3. Дополнительно вызвать `_shared/contentValidator` client-side для мгновенного отображения (dangling, fake_quotes, nominative, sentence_structure). Плотность ключа — уже есть в quality-check, лемматизированная.
4. Для `ru` — Тургенев (существующий бесплатный вызов). Для `en` — статус `not_applicable`.

Компонент `RewriteAuditReport.tsx`:
- Две колонки/секции:
  - «Исправим автоматически»: cliches, canceler, dangling, nominative_inserts, predictability, keyword_density, ai_detection.
  - «Требует вашей правки»: broken_h_structure, factual_conflicts, missing_h1, fake_quotes (с меткой «можно только удалить»).
- Каждая проблема = карточка: цитата фрагмента (highlight в оригинале) + пояснение + категория.
- Вердикт: `ready | needs_fixes | needs_rewrite` (по количеству/тяжести проблем во 2-й группе).
- Cost-бейдж: `N = max(5, ceil(chars/1500))` кредитов, кнопка «Исправить за N».

Классификация багов по группам — маппинг в `src/features/rewrite/issueGroups.ts`.

### Шаг 3 — Исправление
1. Клиент → новая edge-функция `rewrite-start` (тонкая обёртка):
   - `verifyAuth`, load article, проверка `source='rewrite'` и владельца.
   - Атомарное списание N кредитов через существующий RPC (`deduct_credits` или аналог из `improve-article`).
   - Пометка `articles.humanize_profile='conservative'`.
   - Проксирует в существующий `improve-article` с флагом `cycle:true, priority:'auto'`.
   - Возвращает 202.
2. `humanizePass.ts` — единственная точка изменения существующего кода: при `humanize_profile='conservative'` в system-prompt добавляется блок «Это авторский текст пользователя…» (текст из ТЗ). Никакой другой логики не трогаем — валидаторы, судьи, СОХРАНИТЬ-блок, rollback, no_progress, turgenev_unavailable работают как есть.
3. Прогресс — уже пишется в `articles.quality_details.cycle_progress`, реюзаем `QualityImproveCard` / `HumanizeProgress`.
4. Rollback кредитов: в `improve-article` уже есть терминальные статусы. Добавляем в его финалайзер: если `source='rewrite'` и итог = `error | no_progress_upstream_fail` — возврат кредитов + `pipeline_events{kind:'rewrite_refund'}`. (Плановый `no_progress` без падения — не возвращаем, работа сделана.)

Финальный экран `RewriteResult.tsx`:
- DIFF-вьюер поабзацно: `diff-match-patch` (уже возможно в bundle, иначе `bun add diff`), рендер side-by-side или inline с подсветкой. MVP — просто подсветка изменённых абзацев без accept/reject (accept/reject — во вторую итерацию, честно проговариваем).
- Действия: копировать HTML, скачать .docx (реюзаем `markdownToDocx.ts` / существующий экспорт `MyArticlesPage`), «Сохранить в проект» → выбор проекта, обновление `articles.project_id`.

## 4. Логирование

- `cost_log`: все LLM-вызовы уже логируются через `logLLM` внутри improve-article, `article_id` попадёт автоматически. Дополнительно проставим `source='rewrite'` через meta (или новую колонку — см. п.1).
- `pipeline_events`: existing события + `rewrite_started`, `rewrite_refund`, `rewrite_completed`.
- `tg-daily-digest`: добавить агрегат «рерайтов: N» — count `articles where source='rewrite' and created_at::date = today`.

## 5. Уникальность (опционально)

Если в `api_keys` есть валидный `text_ru` — вызов на шаге 1 после ввода, warning-бейдж «текст неуникален (X%)». Не блокирует. Если ключа нет — секция скрыта.

## 6. Чего НЕ делаем в этой итерации

- Accept/reject по абзацам в DIFF — вторая итерация.
- Originality.ai для EN — вторая итерация (пока `detector_not_applicable`).
- Не трогаем формат `subscription_plans`, лимиты — рерайт списывает из того же баланса.

## Файлы

Новые:
- `supabase/migrations/*_articles_source_and_profile.sql`
- `supabase/functions/rewrite-start/index.ts`
- `src/pages/RewritePage.tsx`
- `src/features/rewrite/RewriteInput.tsx`
- `src/features/rewrite/RewriteAuditReport.tsx`
- `src/features/rewrite/RewriteResult.tsx`
- `src/features/rewrite/issueGroups.ts`
- `src/features/rewrite/diffView.tsx`
- `src/features/rewrite/detectLang.ts`

Правки (минимальные):
- `src/App.tsx` — роут.
- `src/components/AppSidebar.tsx` — пункт меню.
- `src/shared/i18n/article.ts` — ключи `rewrite.*`.
- `supabase/functions/_shared/humanizePass.ts` — блок промпта при `conservative`.
- `supabase/functions/improve-article/index.ts` — read `humanize_profile`, refund-hook для `source='rewrite'`.
- `supabase/functions/tg-daily-digest/index.ts` — строка «рерайтов».

## Вопросы перед стартом

1. **Оценка кредитов**: формула `max(5, ceil(chars/1500))` — при 50k знаков это 34 кредита. Сойдёт или хочешь другой прайсинг (например, привязать к тарифу)?
2. **DIFF в MVP**: подсветка изменённых абзацев без accept/reject устраивает как первая версия?
3. **Лимит по тарифу**: рерайт доступен всем тарифам, включая NANO? Или только PRO/FACTORY?
4. **Экспорт .docx**: реюзать текущий парсер из `MyArticlesPage` или нужен отдельный (там есть чистка под Miralinks/GGL — для рерайта не нужна)?
