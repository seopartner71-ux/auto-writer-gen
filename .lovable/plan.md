## Что и почему

Сейчас цикл «Улучшить качество текста» дирижируется из QualityImproveCard в браузере: он вызывает `improve-article`, ждёт, читает баллы, решает следующий проход, откатывает при ухудшении. Один проход `improve-article` уже живёт в `EdgeRuntime.waitUntil` — переживает F5. Но следующий проход некому запустить, если вкладка умерла. Отсюда «всё слетает».

Переносим верхний оркестратор (loop MAX_PASSES=2 + decideFix + rollback) на сервер, в тот же файл, где уже лежит серверный пайплайн одного прохода.

## Изменения

### 1. `supabase/functions/improve-article/index.ts`
- Новая ветка запроса: `body = { article_id, cycle: true, priority: "auto"|"ai"|"turgenev" }` → отвечает 202 и запускает `runImproveCycle` через `EdgeRuntime.waitUntil`.
- Новая функция `runImproveCycle({ admin, article_id, user_id, priority, orKey, lovableKey, authHeader, supabaseUrl })` в этом же файле:
  1. Ставит `quality_status='improving'`, `improve_stop_requested=false`, стартует `cycle_progress` в `quality_details`.
  2. Читает исходные баллы, `bestSnapshot = { content, ai, turg }`.
  3. Цикл `for pass in 1..2`:
     - Проверяет `improve_stop_requested` → если стоп, break.
     - `decideFix(scores, priority)` → `"humanize"` / `"turgenev"` / `null`.
     - Если `null` (цели достигнуты) → break, status `targets_met`.
     - Пишет `cycle_progress = { status:"running", pass, action, started_at }` в `quality_details`.
     - Вызывает существующую `runImprovePipeline({ ..., phase, initialContent: currentContent })` **прямым вызовом** и `await`.
     - После прохода читает свежие ai_score/turgenev_score. Правило отката (как на клиенте): humanize не должен поднять turgenev >+2; turgenev не должен уронить ai >3пп — откат к pre-снимку.
     - Обновляет `bestSnapshot`, если новый лучше.
  4. Финализация:
     - `quality_details.cycle_progress = { status: "done"|"stopped"|"balanced"|"no_progress", pass, best: {...}, finished_at }`.
     - `quality_status = null`, `improve_stop_requested = false`.
     - Событие `pipeline_events` с итогом (stage `improve`, meta `cycle_summary`).
- Между проходами `runImprovePipeline` уже сама пишет best-score и очищает status в 'checking'/null — оркестратор просто перечитывает статью и возвращает в `improving` перед следующим проходом.

### 2. `src/features/article-quality/QualityImproveCard.tsx`
- `runImprove()` заменяется на одиночный POST в `improve-article` с `{ cycle: true, priority }` → 202, дальше **никаких клиентских проходов**.
- Прогресс читается из `articles.quality_details.cycle_progress`:
  - Уже подписаны на UPDATE — добавляем `quality_details` в `select`.
  - Poll-fallback раз в 5с на случай пропущенного realtime-события.
- Рендер запущенного состояния берётся из `cycle_progress.pass / action / status`.
- **При монтировании компонента**: если `quality_status === "improving"` и `cycle_progress.status === "running"` — сразу показать «Проход X/2, ...» без ожидания клика. F5 бесшовный.
- «Остановить» уже пишет `improve_stop_requested = true` — сервер читает между шагами (`checkStopFlag` уже есть в pipeline; в оркестраторе тоже добавим).
- `logLines` больше не собирается на клиенте — вместо этого читаем `improve_last.trace` и `cycle_progress` для строки статуса.

### 3. Правки, вытекающие из уроков предыдущих итераций
- Никаких fetch между своими функциями — `runImprovePipeline` вызывается напрямую как JS-функция в том же процессе.
- Финальный best-score уже пишется синхронно с content внутри `runImprovePipeline` — не трогаем.
- Ошибка любого прохода: пишем в `cycle_progress.error`, `improve_last.status='error'`, снимаем `quality_status`.

## Что НЕ трогаем
- Сам пайплайн одного прохода (`runImprovePipeline`, humanize, turgenev, validators) — код тот же, вызывается в цикле.
- `quality-check` — остаётся фоновой перепроверкой после последнего прохода (как сейчас).
- Миграции БД не нужны: `cycle_progress` — просто ключ внутри существующего `quality_details jsonb`.

## Проверка
- Ручной прогон: жму «Улучшить», через 5с F5 — панель показывает «Проход 1/2: гуманизация» без перезапуска.
- В логах edge-функции: одна цепочка `improve` событий за весь цикл, `cycle_summary` в конце.
- В `pipeline_events` виден `stop_requested` при клике «Остановить», и цикл действительно останавливается перед следующим проходом.

Готов реализовать — жду одобрения.