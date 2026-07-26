
## Цель
Добавить в Экосистему новый тип документа `expert_pdf` — «Экспертный SEO/GEO Knowledge Asset» согласно ТЗ (10 блоков: обложка → введение → чек-лист → таблицы → «как выбрать» → ошибки → FAQ → эксперт → финальный чек-лист → CTA). Все компоненты вписываются в существующую архитектуру `document_types` + `generate-doc-universal` + `_shared/documentPdf.ts` без дублирования edge-функций.

## Что уже есть (не трогаем)
- Обложка с версией/датой/доменом, TOC, `chapters`, `numbered_steps`, `author_card_full`, `cta_button`, `back_cover`, `footer_pagination` — работают.
- `generate-doc-universal` умеет читать `system_prompt_template`, `post_checks_config`, вставлять `client_pages_block`, ретраить.
- Фото Unsplash/Pexels + Gemini-подбор.

## Что реализуем

### 1. Новые рендер-блоки в `_shared/documentPdf.ts`
Расширяем реестр `renderers`:

| Блок | Что рисует |
|---|---|
| `cover_expert` | Обложка ТЗ: категория (chip), H1, подзаголовок, "польза" 2-3 строки, бренд, автор, дата, версия, QR на домен |
| `audience_box` | Секция «Для кого этот материал»: 3 колонки — Аудитория / Проблемы / Ошибки (парсит `## Для кого`) |
| `checklist_sections` | 8-15 разделов из `##`: заголовок, «Почему важно» / «На что смотреть» / «Типичная ошибка» + мини-чекбоксы ☐ из `- [ ]` |
| `comparison_table` | Таблица из markdown-таблиц (`| a | b |`) — 2 автоопределяемых блока с zebra-фоном и брендовым header |
| `mistakes_list` | «10 типичных ошибок» — карточки с полями Ошибка / Почему / Как избежать |
| `faq_section` | FAQ 10-20 Q/A с acc-стилем (жирный вопрос + ответ), парсит `## FAQ` |
| `final_checklist` | Финальная страница «Проверьте перед покупкой» — 20 квадратных чекбоксов ☐ в 2 колонки |
| `qr_code` | QR-код на `https://{domain}?utm_...` в углу CTA или обложки. Генерация через lightweight импорт `npm:qrcode` → PNG → embed |
| `source_block` | Мелким шрифтом «Источник: {brand} • {domain} • Обновлено: {date}» на CTA-странице |

Плюс расширяем `pdfUtils.ts`:
- `drawTable(page, rows, opts)` — переиспользуемый рендер таблиц с word-wrap.
- `drawCheckbox(page, x, y, size)` — квадратный ☐.
- `renderQrPng(text)` через `npm:qrcode@1.5.4`.

Парсер markdown в `documentPdf.ts` дополняем: собираем markdown-таблицы (`|...|`) как отдельные блоки `{ kind: "table", rows }`.

### 2. Миграция `document_types`
INSERT slug=`expert_pdf`:
- `name`: «Экспертный PDF-гайд»
- `target_pages`: 8-12
- `primary_model` = `google/gemini-2.5-pro`, fallback = `gemini-2.5-flash`
- `system_prompt_template`: жёсткий шаблон под все 10 разделов ТЗ (заголовки `## Для кого`, `## Основные критерии`, `## Сравнение`, `## Как выбрать`, `## Типичные ошибки`, `## FAQ`, `## Об авторе`, `## Финальный чек-лист`), правило E-E-A-T, запрет рекламных клише, требование ≥2 markdown-таблиц и ≥10 FAQ.
- `post_checks_config`: минимум разделов, минимум таблиц (≥2), минимум FAQ (≥10), минимум ошибок (≥10), минимум пунктов финального чек-листа (≥20).
- `pdf_template_config.structure`:
```
cover_expert → table_of_contents → header_with_logo →
audience_box → checklist_sections → comparison_table →
numbered_steps (Как выбрать) → mistakes_list → faq_section →
author_card_full → final_checklist → cta_button → qr_code →
source_block → back_cover → footer_pagination
```
- `html_landing_config`: базовый, повторяет структуру (в `deploy-to-github-pages` пойдёт через `renderUniversalLanding` без изменений).

### 3. Валидаторы `_shared/documentValidators.ts`
Добавляем правила:
- `min_tables` — считает `|...|\n|---|`.
- `min_faq` — считает пары Q/A под `## FAQ`.
- `min_mistakes` — считает элементы под «Типичные ошибки».
- `min_final_checklist_items` — считает `- [ ]` под «Финальный чек-лист».

`generate-doc-universal` уже вшивает валидаторы в промпт через `buildValidationInstructions` — новые правила описываем декларативно, движок сам подставит.

### 4. UI
- `EcosystemDetailPage.tsx` — карточка нового типа автоматически появится из справочника (whitelist уже снят).
- `ClientDetailsDialog.tsx` → таб «Документы» — ссылки на PDF/лендинг подхватываются автоматически.
- Никаких новых кнопок/страниц.

## Технические заметки
- `qrcode` в Deno: `import QRCode from "npm:qrcode@1.5.4"`, режим `toDataURL('image/png')`, обрезаем `data:` → embed через `PDFDocument.embedPng`.
- Таблицы: пока только 2 колонки min → 4 колонки max; шире 4 колонок ужимаем шрифт до 9pt; ячейки wrap через `wrapText`.
- QR ведёт на `https://{domain}/?utm_source=document&utm_medium=ecosystem&utm_campaign=expert_pdf&utm_content=qr`.
- Legacy типы (`checklist`, `dzen`, `memo`, `howto`, `guide`) не затрагиваются — новые блоки живут рядом в реестре.
- Промпт всё пишется на Gemini (согласно core-правилу «все тексты в экосистеме — Gemini»).

## Порядок работ
1. Миграция: INSERT в `document_types` (expert_pdf).
2. `pdfUtils.ts`: `drawTable`, `drawCheckbox`, `renderQrPng`, парсер `| ... |` таблиц.
3. `documentPdf.ts`: 9 новых рендереров + расширенный markdown-парсер.
4. `documentValidators.ts`: 4 новых правила.
5. Прогон end-to-end: сгенерировать документ через `EcosystemDetailPage`, инспекция PDF (страницы 1-10) — все блоки визуально проверены.
