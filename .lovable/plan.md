# План: продуктовые риски и приоритеты после аудита

Делаем строго по списку из аудита. Разбиваю на 6 итераций — каждая независима, можно остановиться на любой.

---

## Итерация 1. Запись метрик качества + алёрты (критично)

**Проблема:** uniqueness_percent NULL у 100% статей, turgenev_score NULL у 93%. Метрики не пишутся в БД.

**Что делаю:**
- Чиню `quality-check` edge-функцию: гарантирую upsert полей `turgenev_score`, `uniqueness_percent`, `ai_score` в `articles` всегда, даже при частичной ошибке провайдеров (не блокировать запись одного, если упал другой).
- Добавляю запись провалов в `error_logs` (контекст `quality-check`) — раньше функция молча проглатывала.
- В пайплайне `ArticlesPage.tsx` гарантирую вызов `quality-check` после `polish-article` и до публикации.
- Создаю cron-функцию `quality-metrics-alert` (раз в час): если за последние 50 статей > 10% NULL по turgenev/uniqueness — TG-алёрт админу через `telegram-notify`.

## Итерация 2. Humanize Fix по факту

**Проблема:** средний `ai_score` = 50, при этом `rewritten=true` — 0 раз. Триггер не работает.

**Что делаю:**
- В `quality-check` после получения ai_score: если `ai_score >= 60` — автоматически вызываю `improve-article` (или `polish-article` с режимом humanize), сохраняю новую версию в `article_versions`, ставлю `rewritten=true`, перепроверяю.
- Лимит: максимум 1 авто-rewrite на статью, чтобы не зациклиться.
- Логирую в `cost_log` отдельной операцией `humanize_auto`.

## Итерация 3. Чистка неиспользуемых интеграций

**Что скрываю из UI** (код оставляю, чтобы не ломать существующих юзеров):
- Hashnode, Dev.to — не использовались никем.
- Blogger (есть таблица `blogger_connections`, но 0 connection в проде по фактическим данным).
- Medium-подобные раздаётся в `syndicate-article` — выключаю в UI.
- GitHub-публикация и Vercel-deploy скрываю под «Расширенное» (использовались только админом).

Останется в основном UI: WordPress, Telegraph, Ghost.

## Итерация 4. Сайдбар: 3 группы + «Ещё»

Текущие 40 пунктов перегруппирую:
- **Создать**: Dashboard, Quick Start, Projects, Keywords, Topical Map, Sources, Article Audit, My Articles, Articles, Author Profiles, Prompts, Calendar.
- **Опубликовать**: WordPress, Indexing, Site Factory, Integrations.
- **Аналитика**: Analytics, Network Monitor, Radar, Mentions, Domain Hunter.
- **Ещё** (свернуто): Wiki, Changelog, Support, Pricing, Settings, Admin (для админа).

Группы — `<SidebarGroup>` с `defaultOpen` для активной ветки (как в гайде shadcn).

## Итерация 5. Админский dashboard: «Сегодня в цифрах»

Виджет на `AdminPage`:
- Статей за 24ч / 7д / 30д.
- Средний AI-score, средний Турgenev, % прошедших Humanize.
- Себестоимость в $ за 24ч / 7д / 30д (из `cost_log`).
- Красная метка если `uniqueness_percent NULL > 10%` или средний `ai_score > 55`.

Только данные, без редактирования. 1 SQL-вью + 1 React-компонент.

## Итерация 6. Тесты на 3 критические edge-функции

Создаю `_test.ts` рядом с функциями:
- `generate-article/index_test.ts` — мок LLM, проверка структуры ответа, обработка отсутствия ключевика, лимит retry.
- `quality-check/index_test.ts` — частичный фейл одного провайдера не должен блокировать запись остальных метрик.
- `polish-article/index_test.ts` — короткий вход возвращает skipped, длинный возвращает очищенный текст без английских вставок и с валидным JSON-LD.

Использую `Deno.test` + `std/dotenv`.

---

## Чего НЕ делаю в этом плане (сознательно)

- Unit-экономику PRO/FACTORY (тариф `1 credit = 1 article` при себестоимости Opus $0.34) — это требует ваших решений по цене, не код. Подготовлю калькулятор отдельно после согласия.
- Глобальный рефакторинг 88 edge-функций — не сейчас.

---

## Порядок и риски

```text
1 (метрики) → 2 (humanize) → 5 (admin dashboard)   ← вижу что чиню
                ↓
3 (сайдбар чистка) → 4 (3 группы)                  ← UX без риска для бэка
                ↓
6 (тесты)                                           ← закрепляем
```

Скажи «погнали» — начну с Итерации 1. Или скажи, какие итерации убрать/переставить.
