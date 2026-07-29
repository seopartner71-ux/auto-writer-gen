## Проблема

`publication_slug` формируется из `slugify(article.keyword)`, поэтому все документы одного типа для клиента живут по одному URL и перезаписывают друг друга (в GitHub Pages и Storage). Перегенерация также перезаписывает существующую запись `ecosystem_formats`.

## Решение — уникальный slug + версионирование

### 1. Миграция `ecosystem_formats`

Новые колонки:
- `publication_slug text` — уникальный per-format slug
- `generation_version int not null default 1`
- `parent_ecosystem_format_id uuid null references ecosystem_formats(id) on delete set null`
- `archived boolean not null default false`
- `archived_at timestamptz null`

Индекс: `unique (ecosystem_id, publication_slug)` (только для NOT NULL).

Backfill старых записей:
```
publication_slug = coalesce(document_types.slug, format_type) || '/' || slugify(articles.keyword) || '-legacy'
```
чтобы существующие URL в GitHub Pages остались рабочими (deploy-to-github-pages уже писал ровно в такой путь).

### 2. Формирование slug при генерации

В `generate-doc-universal` и `generate-checklist`:

```ts
const short = base32(uuidBytes(ecosystem_format_id)).slice(0, 8).toLowerCase();
const typeSlug = documentType?.slug || format_type;   // memo | howto | expert_pdf | checklist ...
publication_slug = `${typeSlug}/${slugify(article.keyword)}-${short}`;
```

Записываем в `ecosystem_formats.publication_slug` в самом начале генерации (idempotent — не перетираем, если уже стоит).

### 3. Путь в Storage

- `pdf_path = ecosystem-formats/{user_id}/{publication_slug}.pdf`
- `upsert: false`. При коллизии — добавляем `-v2`, `-v3`, … в имя файла (но не в publication_slug: URL остаётся стабильным для формата).

### 4. Регенерация = новая запись

Frontend `DocMetadataDialog` вместо повторного вызова функции по тому же `ecosystem_format_id` дергает новую RPC/edge `regenerate-ecosystem-format`, которая:

1. Проверяет лимит версий тарифа:
   - `nano` → 1 (при перегенерации архивирует старую, создаёт новую)
   - `basic` → до 5 активных версий на `(ecosystem_id, format_type)`; при превышении просит подтверждение архивации самой старой
   - `pro` → без лимита
2. Создаёт новую строку `ecosystem_formats` со статусом `pending`:
   - `parent_ecosystem_format_id = <старая>`
   - `generation_version = max(version)+1` в рамках `(ecosystem_id, format_type)`
   - остальные метаданные (title, doc_meta, format_type, document_type_id) копируем со старой
3. Инвокает существующий `generate-doc-universal` / `generate-checklist` с новым id.

Старая запись остаётся `completed`, её PDF и URL — живы.

### 5. UI карточка формата (`EcosystemDetailPage`)

Группируем `ecosystem_formats` по `(format_type, document_type_id)`:
- Одна карточка на группу
- Внутри — селект «Версия N от DD.MM.YYYY» (по умолчанию последняя не-archived)
- Кнопки «Открыть», «Перегенерировать» работают с выбранной версией
- В модалке версии — «Архивировать» (soft delete, `archived=true`, файлы не удаляем)
- Плашка `generation_version > 1` показывает счётчик

### 6. `deploy-to-github-pages`

- Путь в репо: `docs/{publication_slug}/index.html` + `docs/{publication_slug}.pdf`
- `format_deployments.published_url = ${github_pages_url}/${publication_slug}/`
- `sitemap.xml` для клиента пересобирается: все `ecosystem_formats` где `archived=false` и есть `format_deployments.published_url`
- Удалённые/архивированные формы не чистим из репо сразу — просто выпадают из sitemap

### 7. Тарифные лимиты

Централизованно в `src/features/content-ecosystem/types.ts`:
```ts
versionsPerFormat(plan): 1 | 5 | Infinity
```
Проверяется и на бэке (в `regenerate-ecosystem-format`), и в UI (кнопка «Перегенерировать» показывает подсказку).

### 8. Обратная совместимость

- Существующие `deploy-to-github-pages` записи используют `publication_slug` из backfill (`…-legacy`) → те же URL продолжают работать
- Существующие PDF в Storage остаются на своих местах; `pdf_path` в БД не меняется
- Frontend fallback: если у формата нет `publication_slug`, ведём себя как раньше

## Технические детали

- Миграция + GRANT на новые колонки (наследуются) + новая RLS не нужна (унаследованная)
- `regenerate-ecosystem-format` — новый edge function с `verify_jwt = false` по проектному дефолту, авторизация через `verifyAuth`
- `short_hash`: `crypto.subtle.digest('SHA-1', uuid)` → base32 первые 8 символов
- `slugify` уже есть в `src/features/content-ecosystem/types.ts` — используем на клиенте; на сервере повторим ту же функцию

## Что не трогаем
- `generate-checklist` внутренняя логика PDF/HTML
- `checklistPdf.ts`
- Схема `document_types`, `clients`, `articles`
- UI мастера создания экосистемы
- Логика `anchors`, `client_pages`, `brand_color`

## План внедрения (порядок коммитов)

1. Миграция: колонки + индекс + backfill
2. `generate-doc-universal` + `generate-checklist`: вычисление и запись `publication_slug`, использование в `pdf_path`
3. `deploy-to-github-pages`: путь по `publication_slug`, sitemap по не-archived
4. Новый edge `regenerate-ecosystem-format` + тарифные лимиты
5. UI `EcosystemDetailPage` + `DocMetadataDialog`: версии, селектор, архивация
6. Тесты: перегенерация памятки в существующей экосистеме минитрактора, проверка живого старого URL, sitemap с двумя версиями