## Дашборд аналитики расходов фабрики сайтов

Новая admin-only вкладка для отслеживания всех расходов на генерацию: токены LLM, FAL AI картинки, деплой, автопостинг.

### 1. База данных

Миграция создаёт таблицу `cost_log`:

- `id`, `created_at`
- `project_id` (uuid, nullable — для операций без привязки)
- `user_id` (uuid)
- `operation_type` (text с CHECK: `site_generation`, `article_generation`, `fal_ai_photo`, `fal_ai_portrait`, `fal_ai_logo`, `cloudflare_deploy`, `auto_post_cron`)
- `model` (text, nullable — например `claude-sonnet-4`, `flux-schnell`)
- `tokens_input`, `tokens_output` (integer)
- `cost_usd` (numeric(10,6))
- `metadata` (jsonb — детали операции)

Индексы по `created_at`, `project_id`, `operation_type`.

RLS:
- SELECT — только `admin`
- INSERT — только `service_role` (через edge functions)
- UPDATE/DELETE — запрещено всем

Дополнительно: настройка `usd_to_rub_rate` в `app_settings` (по умолчанию `90`).

### 2. Логирование расходов

Добавляем хелпер `supabase/functions/_shared/costLogger.ts`:

```ts
export async function logCost(supabase, params: {
  project_id?: string; user_id?: string;
  operation_type: string; model?: string;
  tokens_input?: number; tokens_output?: number;
  cost_usd: number; metadata?: any;
})
```

Цены (константы):
- Claude Sonnet 4: input `$3/1M`, output `$15/1M`
- GPT-5: input `$1.25/1M`, output `$10/1M` (Lovable AI proxy — фиксированный коэффициент)
- FAL AI flux/schnell: `$0.003` / image
- Cloudflare deploy: `$0`

Интеграция логирования в существующие edge functions:
- `seed-starter-articles` — на каждую сгенерированную статью (LLM tokens)
- `generate-site-content` / `generate-site-config` / `generate-site-name` — генерация сайта
- `generate-pro-image` и места вызова FAL AI в `deploy-cloudflare-direct` — фото/портреты/логотипы
- `deploy-cloudflare-direct` — `cloudflare_deploy` с `cost_usd=0` (для счётчика операций)
- `auto-publish-weekly` / `process-wp-schedule` — `auto_post_cron`

Каждая вставка не блокирует основной поток (`.then().catch(noop)`).

### 3. Edge function `cost-analytics`

Один защищённый endpoint с действиями:

- `summary` — карточки (всего, месяц, сегодня, средний/проект)
- `by_type` — агрегация по operation_type (count + sum)
- `timeseries` — массив `{date, cost_usd}` с гранулярностью `day|week|month`, период настраивается
- `by_project` — джойн с `projects` (имя, домен)
- `forecast` — линейная экстраполяция за месяц + сценарий 50 сайтов (среднее × 50)
- `export_csv` — возвращает CSV всех записей с фильтрами

JWT валидация + проверка роли `admin` через `user_roles`.

### 4. UI: новая вкладка в AdminPage

Файл `src/components/admin/CostAnalyticsTab.tsx`. Регистрируется в `src/pages/AdminPage.tsx` как новая `<TabsTrigger value="costs">Расходы</TabsTrigger>`.

Маршрут `/admin` уже защищён `AdminLayout` (requiredRole=admin) — отдельный `/admin/analytics` не нужен. В тексте использую "Расходы" во вкладке (страница остаётся /admin).

Структура компонента:

1. **KPI карточки**: Всего / За месяц / За сегодня / Средний на сайт. Каждая показывает `$X.XX` и `≈ ₽X` мелким шрифтом.
2. **Таблица "По типам операций"**: операция, кол-во, средняя стоимость, итого.
3. **График по времени**: SVG line chart (без новых либ), переключатель `День / Неделя / Месяц`. Цвета по типу: текст — синий, фото — фиолетовый, деплой — зелёный, автопост — оранжевый. Стек/линии.
4. **Таблица "По проектам"**: сайт (домен → ссылка), статей, фото, токенов, деплоев, итого $. Сортировка по колонкам, поиск по домену.
5. **Прогноз**: при текущем темпе (среднее за 7 дней × 30) — статей, фото, $. При масштабе 50 сайтов — средний cost/сайт × 50 + ежемесячная стоимость автопостинга.
6. **Фильтры**: проект (select), тип операции (multi), даты от/до.
7. **Экспорт**: кнопка "Скачать CSV" → вызов `cost-analytics?action=export_csv` с текущими фильтрами.

Все цены показываются в $ с пересчётом в ₽ по курсу из `app_settings.usd_to_rub_rate`.

### 5. Технические детали

- Курс ₽ читается из `app_settings` (если нет — fallback `90`).
- SVG график — собственная реализация (как `siteWidgets.ts` в фабрике), без `recharts` для admin (быстрее).
- Запросы кэшируются `react-query` 60 секунд.
- CSV формируется на сервере с `Content-Disposition: attachment`.
- Логирование в существующих функциях — best-effort (try/catch, не ломает основной flow).

### 6. Файлы

Создать:
- `supabase/migrations/<ts>_cost_log.sql`
- `supabase/functions/_shared/costLogger.ts`
- `supabase/functions/cost-analytics/index.ts`
- `src/components/admin/CostAnalyticsTab.tsx`

Изменить:
- `src/pages/AdminPage.tsx` (новая вкладка)
- `supabase/functions/seed-starter-articles/index.ts` (логирование)
- `supabase/functions/deploy-cloudflare-direct/index.ts` (логирование деплоя + FAL)
- `supabase/functions/generate-pro-image/index.ts` (логирование FAL)
- `supabase/functions/generate-site-content/index.ts`, `generate-site-name/index.ts`, `generate-site-config/index.ts` (логирование LLM)
- `supabase/functions/auto-publish-weekly/index.ts`, `process-wp-schedule/index.ts` (логирование автопостинга)

Деплой: миграция → деплой `cost-analytics` + всех изменённых функций.

### 7. Что не делаю

- Не создаю отдельный route `/admin/analytics` (вкладка в `/admin` чище и переиспользует layout). Если нужно отдельным URL — скажите, добавлю.
- Не пересчитываю исторические расходы — таблица начнёт заполняться с момента деплоя. Старые операции в логе не появятся.
