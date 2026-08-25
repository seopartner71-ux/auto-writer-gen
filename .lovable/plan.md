# Site Factory 3d - закрытие render gate и приемка 500+

## Что будет исправлено

1. Сохранить вычисление `planRebuild` до любого постраничного рендера и закрепить это тестом порядка вызовов.
2. Сделать `renderPage(path, callback)` единым контрактом для всех HTML-страниц:
   - статьи и главная;
   - system pages: about, contacts, privacy, terms, 404, blog/catalog;
   - SILO hub и category;
   - product/service и catalog category;
   - filter landing и business pages.
3. В incremental-режиме выполнять callback только для `pages_to_rebuild`; глобальные sitemap.xml, robots.txt и llms.txt пересобирать всегда вне счетчика страниц.
4. Устранить несоответствие legacy article path и конечного SILO path, чтобы кешированная SILO-статья не проходила через промежуточный рендер `/posts/...`.
5. Добавить проверяемые метрики: `planned_pages`, `render_invocations`, `rendered_paths`, `skipped_paths`, `duration_ms` в `rebuild_result`.

## Проверки

- Regression: полный рендер fixture через новый контракт, сравнение каждого файла и итоговых хешей с frozen baseline из 3a байт-в-байт.
- Coverage: тест со статьей, товаром, hub, category, system и filter страницами доказывает, что callback вызван ровно N раз.
- Safety: отсутствующая страница кеша принудительно рендерится и отражается как инцидент/дополнительный вызов.
- Acceptance: один и тот же проект с 500+ HTML-страницами - full deploy, затем изменение ровно 1 статьи и 1 товара, incremental deploy. Снять `duration_ms`, HTTP status, `planned_pages`, `render_invocations`, `rendered_pages`, `cached_pages` и дать конкретное сравнение.

## Технические детали

Гейт останется чистым диспетчером: он не генерирует и не меняет HTML, а только решает, запускать ли переданный callback. Построение полного sitemap/link graph допускается без HTML-рендера страниц. Если реальный acceptance deploy недоступен из-за внешнего Cloudflare/API-контура, это будет указано как блокер без выдуманных цифр; локальный benchmark не будет выдан за production `duration_ms`.
