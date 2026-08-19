# P6. Site Factory -> генератор коммерческих SEO-сайтов

## A. Аудит: что уже есть (не трогаю)

- `projects` = сайт. Уже есть: `hosting_platform`, `custom_domain`, `vercel_token`, `github_token`, `indexnow_key`, `last_deploy_at`, `template_key`, `homepage_style`, `site_positioning`, `url_scheme`.
- SILO из прошлого этапа полностью на месте: `site_silos`, `site_clusters` (parent_id, type, hub_article_id), `internal_links`, `articles.slug/url_path/silo_id/site_cluster_id`, `_shared/siloUrl.ts`, `deploy-cloudflare-direct/siloPages.ts`, `SiloStructurePanel.tsx`.
- `articles.page_type` УЖЕ существует и используется коммерческим модулем (service, category, product, local) вместе с `articles.commercial_brief` (jsonb). Значит новую сущность страниц создавать не нужно - расширяю справочник значений.
- Деплой: `deploy-cloudflare-direct` (2049 строк, 8 шаблонов страниц + `seoChrome.ts` с sitemap/robots/canonical/Schema/breadcrumbs), `deploy-vercel-direct`, `deploy-github-pages`, IndexNow, GSC-верификация, `normalizeInternalLinks`, `smart-interlinking`.
- Коммерческие генераторы уже есть: `generate-commercial-block`, `commercial-structure-analyzer`, `parse-commercial-url`, `generate-site-content`.

## B. Чего нет

- Товаров/услуг как данных (нет ни одной таблицы `products`).
- Импорта CSV/XLSX/XML-YML и предпросмотра импорта.
- Семантики уровня проекта: `keywords` привязан к user, без `project_id`, `cluster`, `priority`.
- Автопостроения SILO из семантики.
- Страниц home/category/product/service/faq/contacts/about/delivery/payment/guarantee как рендереров.
- Компонентной design system (сейчас 8 монолитных шаблонов).
- Статусов домена/DNS/SSL, ZIP-экспорта, инкрементального деплоя, pre-deploy QA.

## C. Миграции (аддитивные)

1. `site_products`: project_id, silo_id, site_cluster_id, external_id, sku, name, slug, url_path, price, currency, brand, availability, description, characteristics jsonb, images text[], source_url, status, position, created_at/updated_at. Уникальность (project_id, sku).
2. `site_keywords`: project_id, keyword, frequency, intent, cluster_hint, category_hint, priority, silo_id, site_cluster_id, status. Существующий `keywords` не трогаю.
3. `site_imports`: project_id, kind (products | keywords), filename, format, rows_total, rows_ok, rows_dupe, rows_error, preview jsonb, status. История и превью.
4. `articles.page_type`: расширяю список значений на уровне приложения (home, silo_hub, cluster, category, subcategory, product, service, article, faq, contacts, about, delivery, payment, guarantee). Жёсткого CHECK не ставлю, чтобы не сломать существующие строки.
5. `site_clusters` + `page_type` (category | subcategory | info), `site_silos` + `page_type`.
6. `projects`: + `deployment_url`, `custom_domain_status`, `ssl_status`, `dns_status`, `dns_records jsonb`, `last_qa_report jsonb`, `last_build_hash`.
7. `site_deploy_queue` (инкрементальность): project_id, entity_type, entity_id, reason, status - помечает, какую ветку пересобрать.
8. RLS + GRANT на каждую новую таблицу по образцу `site_silos` (владелец через project_id, полный доступ service_role).

## D. Реализация по этапам

P6.1 Данные и импорт
- Парсер CSV/XLSX/XML-YML на клиенте (xlsx + fast-xml-parser), маппинг колонок, экран предпросмотра: импортировано / распознано / не распознано / дубли / ошибки / предлагаемый SILO. Запись только после подтверждения.
- Новая вкладка «Данные» в `SiteFactoryPage.tsx` (отдельные компоненты в `src/features/site-commerce/`, страницу не раздуваю).

P6.2 Автопостроение SILO
- Edge Function `build-silo-from-semantics`: семантика -> intent -> кластеризация (embeddings + Gemini) -> L1/L2/L3 -> черновик дерева со `status = draft`.
- UI-дерево с редактированием названия, slug, page_type, parent, счётчиком страниц; публикация дерева в `site_silos`/`site_clusters` только по кнопке.

P6.3 Генерация коммерческих страниц
- Edge Function `generate-commercial-pages`: пакетная генерация category/subcategory/product/service/faq/about/contacts/delivery/payment/guarantee поверх существующего `generate-commercial-block`, запись в `articles` с нужным `page_type`.

P6.4 Design system и рендер
- Новый модуль `deploy-cloudflare-direct/commerceComponents.ts`: Header, Mega Menu, Hero, Benefits, Category Grid, Product Grid/Card, Service Card, CTA, Reviews, FAQ, Breadcrumbs, Related, SEO Content, Contacts, Footer - на токенах проекта (accent_color, font_pair).
- `commercePages.ts` рендерит home/category/product/service/служебные страницы, переиспользуя `seoChrome.ts`. Ветка включается только для проектов с коммерческим контентом; блоговые проекты рендерятся прежним кодом.

P6.5 SEO
- Schema по типу страницы: Product+Offer для товара, Organization/LocalBusiness для контактов и главной, Article для статей, BreadcrumbList везде. Никакой Schema там, где она не соответствует странице.
- Sitemap расширяю новыми путями через уже существующий механизм extraPaths, валидации не меняю.

P6.6 Перелинковка
- Расширяю существующий `smart-interlinking` правилами: лист -> hub обязательно, лист -> лист внутри кластера, cluster -> hub, hub -> cluster, cross-silo ограниченно. Всё пишется в `internal_links`. Параллельный механизм не создаю.

P6.7 QA перед деплоем
- Edge Function `site-qa-check`: 404, битые ссылки, дубли title/H1, пустые description, orphan-страницы, canonical, breadcrumbs, Schema, изображения, URL, sitemap/robots consistency. Отчёт CRITICAL / WARNING / OK в `projects.last_qa_report`; CRITICAL блокирует деплой (с явным «деплоить всё равно» для админа).

P6.8 Домены, экспорт, инкрементальность
- Панель домена: технический домен, custom domain, DNS и SSL статус, дата деплоя. Cloudflare - через существующий `cloudflare-bind-domain`; где автоматики нет, показываю точные DNS-записи для ручного добавления.
- «Экспортировать сайт» -> ZIP (index.html, assets/, images/, sitemap.xml, robots.txt, favicon, manifest), работает на любом хостинге.
- Инкрементальный деплой: через `site_deploy_queue` пересобираются только затронутая страница, её related, hub/cluster ветка и sitemap.

P6.9 Сеть сайтов
- `SitesListTable.tsx`: колонки Домен, Hosting, Custom Domain, Pages, SILOs, Articles, Products, Last Deploy, Status и действия Deploy / Export / Update Content / Rebuild SILO / QA / Open Site.
- «Обновить контент»: новые статьи, обновление статей и товаров, добавление категорий, расширение SILO, обновление метаданных.

## E. Что не ломаю

Legacy URL `/posts/{slug}.html`, существующие проекты и статьи, SILO-слой, Cloudflare/Vercel/GitHub деплой, sitemap/robots валидации, IndexNow, GSC-верификацию, `normalizeInternalLinks`, `smart-interlinking`, WordPress-модуль. Все изменения аддитивные.

## F. Объём

Это 9 подэтапов. Предлагаю выполнять последовательно: сначала P6.1-P6.3 (данные, импорт, автоSILO, генерация страниц), затем P6.4-P6.6 (рендер и SEO), затем P6.7-P6.9 (QA, домены, экспорт, сеть сайтов). После каждого блока даю отчёт.
