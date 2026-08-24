# Загрузка HTML-шаблона в шаге "1. Основные данные"

## READ-ONLY аудит

### Где сейчас создаётся проект
`src/features/site-commerce/wizard/SiteFactoryWizard.tsx`
- `form` state: name, niche, region, language, domain (строка 51)
- `saveBasics()` (строки 138-169): insert/update в `projects` (name, domain, language, region, site_positioning, url_scheme='silo'), затем `load()` и переход на шаг профиля
- `load()` (строка 82) читает список проектов: `id, name, domain, language, region, site_positioning, url_scheme` - полей шаблона в выборке нет
- Шаг 0 рендерится в `body()` (строки 172-215)

### Существующий Template Import V1
- UI: `src/components/site-factory/SiteTemplateImporter.tsx` - подключён только в `src/pages/SiteFactoryPage.tsx:3469` (отдельная вкладка)
- Backend: `supabase/functions/site-template-import/index.ts`, actions: `list`, `validate`, `preview_zip`, `install`, `preview`, `select`, `disable`, `delete`
- `install` -> readZip -> validateTemplateBundle -> Storage `site-templates` -> таблица `site_templates` -> возвращает `{ ok, template: { id, slug, name, version } }`
- `select` -> `projects.template_engine='template'`, `projects.site_template_id=template_id`
- `disable` -> `template_engine='legacy'`, `site_template_id=null`
- Preview: `preview_zip` (по загруженному ZIP) и `preview` (по установленному template_id) - возвращают HTML по 5 типам страниц, рендерятся в iframe

Вывод: backend полностью готов, новых таблиц и функций не нужно.

## Какие файлы будут изменены

1. `src/features/site-commerce/wizard/SiteFactoryWizard.tsx` - добавить блок "Визуальный шаблон" в шаг 0, состояние выбора, чтение/сохранение полей.
2. `src/components/site-factory/wizard/TemplateChoiceCard.tsx` (новый, только UI) - компактный блок выбора: "Стандартный шаблон" / "Загрузить HTML-шаблон", загрузка ZIP, статус, кнопки "Предпросмотр" и "Заменить".

Backend, SEO, SILO, Registry, QA, deploy, renderer - без изменений.

## Как это работает

1. Подключение импортёра: новый компонент вызывает те же actions существующей функции `site-template-import` (`install`, `preview_zip`, `preview`, `select`, `disable`) через `supabase.functions.invoke`. Отдельный importer-экран в SiteFactoryPage остаётся как есть.
2. Сохранение `site_template_id`: после успешного `install` сохраняем `template.id` в локальный state мастера; при `saveBasics()` для существующего проекта вызываем action `select` (project_id + template_id); для нового - сначала insert проекта, потом `select`.
3. Сохранение `template_engine`: полностью через backend actions - `select` ставит `template`, `disable` ставит `legacy`. Клиент не пишет эти поля напрямую.
4. Сохранение выбора между шагами: значение лежит в state мастера (не сбрасывается при смене шага), а после сохранения проекта - уже в БД.
5. Повторное открытие: в `load()` и в эффекте выбора проекта добавляем в select поля `site_template_id, template_engine`, чтобы блок показывал текущий шаблон и его статус.
6. Ничего не ломаем: если пользователь оставил "Стандартный шаблон", поведение `saveBasics()` идентично текущему; `disable` вызывается только если проект ранее был на `template`.
