# План закрытия техдолга

Работаем по убыванию критичности. Каждый пункт - отдельный коммит, чтобы можно было откатить.

## 1. GEO Radar: честная visibility для brand-keywords

Проблема: если keyword содержит название бренда - модель вынуждена его упомянуть, `brand_mentioned=true` всегда, метрика visibility 57% становится фейковой.

Решение в `supabase/functions/radar-check/index.ts`:
- Добавить детектор: если `keyword.toLowerCase().includes(brand.toLowerCase())` или наоборот - помечать запрос как `branded=true`.
- Для branded-запросов НЕ засчитывать `brand_mentioned` в visibility. Считать только `cited` (есть ли ссылка/упоминание сайта) и `recommended` (рекомендует ли модель к выбору).
- В UI на `RadarPage` показывать badge "Branded query - visibility excluded" рядом с такими keywords.
- В формуле итоговой visibility делить только на non-branded запросы.

## 2. Beget timeouts: фоновая очередь для image generation

Проблема: Flux Pro иногда > 180s, PHP-proxy дропает.

Решение:
- Использовать существующую таблицу `background_jobs` (уже есть, видна в схеме).
- В `generate-image` edge function: если запрос пришёл с флагом `async=true` - создать запись в `background_jobs` (job_type='image_generation', status='pending'), сразу вернуть `job_id`, запустить генерацию в `EdgeRuntime.waitUntil()`.
- По завершении обновить job: `status='completed'`, `result={ url, storage_path }`.
- На клиенте `ImageGeneratorPage`: после POST поллить `background_jobs` по `id` каждые 3с до `completed/failed`. Realtime подписка - бонус, не обязателен.
- Синхронный режим (`async=false`) оставить для preview/мелких задач.

## 3. Shared infra для новых edge functions

`radar-check` и `generate-geo-plan` не используют `_shared/` модули.

Решение: рефакторинг обоих файлов:
- `import { corsHeaders } from '../_shared/cors.ts'`
- `import { verifyJWT } from '../_shared/auth.ts'`
- `import { withTimeout } from '../_shared/withTimeout.ts'`
- `import { handleError } from '../_shared/errorHandler.ts'`

Убрать дублирование CORS-заголовков и ручного base64url JWT-декода.

## 4. Синхронизация тарифов: единый источник правды

Проблема: `_shared/planLimits.ts` хардкодит `basic=5` статей, реальные лимиты в БД `subscription_plans.monthly_article_limit` (basic=450 кредитов).

Решение:
- Удалить захардкоженные числа из `PLAN_LIMITS`, `IMPROVE_LIMITS`, `BULK_LIMITS`.
- Превратить в async-функции `getPlanLimit(plan, type)` которые читают `subscription_plans` из БД с in-memory кэшем на 60с.
- Все вызовы (`generate-article`, `seo-improve`, `bulk-generate`) - перевести на async-версию.
- Поле в БД для bulk-лимита: добавить колонку `bulk_limit INTEGER DEFAULT 1` в `subscription_plans` через migration.

## 5. useTrialStatus: исправить определение paid-плана

В `src/shared/hooks/useTrialStatus.ts` сейчас:
```ts
const isFreePlan = !profile?.plan || profile.plan === "free" || profile.plan === "basic";
const isPaidPlan = profile?.plan === "pro";
```

Это неверно: `basic` (NANO) - платный, `pro` (PRO) - платный, `factory` (FACTORY) - платный. Бесплатных тарифов нет вообще (есть trial на кредитах).

Решение:
- `isPaidPlan = ['basic','pro','factory'].includes(profile?.plan)`
- `isFreePlan = !profile?.plan` (только если профиля нет / плана нет)
- Логика nudge/paywall переориентируется на `credits_amount <= 0` независимо от плана.

## 6. Radar: убрать Llama или поднять timeout

Llama стабильно падает по 45s. Два варианта:
- Поднять её personal timeout до 90s (другие модели не трогаем).
- Или вообще удалить из списка проверяемых моделей.

Делаю первый вариант - поднимаю до 90s. Если снова таймауты - вторым шагом удалим.

---

## Порядок выполнения

1. Пункт 5 (useTrialStatus) - 1 файл, безопасно.
2. Пункт 6 (Llama timeout) - 1 строка в radar-check.
3. Пункт 1 (Radar branded queries) - radar-check + RadarPage.
4. Пункт 3 (shared infra) - рефакторинг 2 функций.
5. Пункт 4 (планы из БД) - миграция + рефакторинг 3-4 edge функций.
6. Пункт 2 (async image gen) - самый объёмный, требует Realtime/polling на клиенте.

После каждого пункта - короткий чек что не сломалось.

Подтверди план - и начну с пункта 1 (useTrialStatus). Если хочешь другой порядок или какие-то пункты пропустить - скажи сейчас.