# SILO-архитектура внутри существующей Site Factory

## Что уже подтверждено аудитом

- `projects` = сайт, `articles.project_id` = страница. Промежуточных уровней нет.
- `clusters` - плоская таблица (id, user_id, title, description), без `project_id` и `parent_id`. Использовать её как SILO-иерархию нельзя без риска для текущих данных.
- URL считается на лету при каждом деплое: `slugify(article.title)` + паттерн `SITE_URL_PATTERN = "/posts/{slug}.html"` в `deploy-cloudflare-direct/index.ts`. В БД slug не хранится.
- Related-блок = `allPosts.filter(...).slice(0,3)` в шаблонах.
- Sitemap собирается в `seoChrome.ts` (`sitemapXml`, `sitemapXmlWithExtras`), с hard-валидацией в `index.ts` (обязательный `<?xml`, совпадение домена в robots.txt).
- Перелинковка живёт в двух местах: `smart-interlinking` (пишет ссылки прямо в `articles.content`) и `normalizeInternalLinks` (чинит ссылки при деплое). Граф нигде не хранится.

## Принцип

Всё новое - аддитивно. Существующие проекты остаются `url_scheme = 'legacy'` и рендерятся тем же кодом, что и сегодня. Ветка SILO включается только при `projects.url_scheme = 'silo'`.

## P0. Модель данных (миграции)

- `site_silos`: id, project_id, name, slug, description, position, status, hub_article_id (nullable), created_at, updated_at.
- `site_clusters`: id, project_id, silo_id, parent_id (nullable), name, slug, description, position, type ('hub' | 'cluster'), hub_article_id, created_at/updated_at. Новая нормализованная сущность - старую `clusters` не трогаем.
- `articles`: + `silo_id`, `site_cluster_id`, + `url_path` (постоянный canonical path), + `slug`. Все nullable, значения по умолчанию отсутствуют - legacy-статьи не меняются.
- `projects`: + `url_scheme text default 'legacy'`.
- `internal_links`: project_id, from_article_id, to_article_id/to_path, anchor, type (silo_hub | silo_child | related | contextual | cross_silo | breadcrumb), is_silo_internal.
- RLS + GRANT на каждую новую таблицу по образцу существующих (владелец по user_id проекта, service_role полный доступ).
- Триггер/чек: silo и cluster статьи обязаны принадлежать тому же project_id.

## P1. Постоянный URL + резолвер

- Новый общий модуль `supabase/functions/_shared/siloUrl.ts`: `getPageUrl`, `getSiloUrl`, `getClusterUrl`, `getCanonicalUrl`, `resolveInternalUrl`.
- Legacy-ветка резолвера возвращает ровно `/posts/{slug}.html` и текущий алгоритм слага - байт-в-байт то же поведение.
- SILO-ветка: `/{silo}/`, `/{silo}/{cluster}/`, `/{silo}/{cluster}/{slug}.html`.
- `url_path` пишется в БД один раз при создании страницы и при явной смене slug из UI; деплой его только читает.
- `normalizeInternalLinks` переводится на резолвер (для legacy поведение не меняется).

## P2. Hub и Cluster страницы

- Рендер hub/cluster в отдельном модуле `siloPages.ts` внутри `deploy-cloudflare-direct`, с переиспользованием `seoChrome.ts` (title/description/canonical/OG/Schema).
- Hub: H1, описание, список кластеров и дочерних страниц, BreadcrumbList, CollectionPage Schema.
- Cluster: описание, дочерние страницы, ссылка вверх на hub, breadcrumbs.
- Файлы кладутся в тот же bundle: `{silo}/index.html`, `{silo}/{cluster}/index.html`.

## P3. SILO-aware перелинковка

- `smart-interlinking` получает приоритет кандидатов: тот же cluster > тот же silo > семантика по embedding > cross-silo (жёсткий лимит).
- Обязательная ссылка article -> hub кластера/силоса.
- Каждая проставленная ссылка записывается в `internal_links` (upsert по паре from/to).
- Лимиты на исходящие ссылки и анкорный профиль 50/30/20 сохраняются как есть.

## P4. Sitemap, breadcrumbs, Schema

- В `seoChrome.ts` добавляется `sitemapXmlSilo` (hubs 0.9, clusters 0.8, статьи 0.6) - существующие функции не меняются.
- BreadcrumbList строится из иерархии в БД, не из URL.
- Валидации sitemap/robots в `index.ts` остаются нетронутыми.

## P5. UI «Структура сайта»

- Новая вкладка в `SiteFactoryPage.tsx` (отдельный компонент `src/features/site-silo/`, страница не раздувается).
- Дерево SILO -> Cluster -> Pages: создание, переименование, смена slug и parent, назначение hub, привязка статей, drag-порядок, архивирование.
- Удаление силоса/кластера только отвязывает статьи, не удаляет их.

## P6. AI-предложение SILO

- Edge Function `suggest-silo`: на входе keywords, topical_maps, content_topics, embeddings проекта; на выходе черновик дерева.
- Результат сохраняется как `status = 'draft'`, публикуется только после подтверждения пользователем.

## P7. Визуал

Минимальная стилизация hub/cluster в рамках текущих шаблонов, без редизайна Фабрики.

## Проверка

Тестовый проект «Минитракторы» с url_scheme = silo: проверяю дерево файлов bundle, canonical, breadcrumbs, sitemap, robots, отсутствие битых внутренних ссылок, деплой Cloudflare и Vercel. Отдельно - регресс на существующем legacy-проекте: URL и sitemap должны остаться идентичными.

## Затрагиваемый код

- `supabase/functions/deploy-cloudflare-direct/`: `index.ts`, `seoChrome.ts`, `templates.ts`, новый `siloPages.ts`, новый общий `_shared/siloUrl.ts`
- `supabase/functions/deploy-vercel-direct/`, `deploy-github-pages`
- `supabase/functions/smart-interlinking/index.ts`
- новая `supabase/functions/suggest-silo/`
- `src/pages/SiteFactoryPage.tsx` + новая папка `src/features/site-silo/`
- миграции Supabase

## Что не трогаю

Существующий паттерн `/posts/{slug}.html`, валидации sitemap/robots, инъекции IndexNow и GSC-файлов, таблицу `clusters`, механику деплоя Cloudflare/Vercel, данные существующих проектов.
