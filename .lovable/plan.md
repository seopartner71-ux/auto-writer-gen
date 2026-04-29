## Цель

Уйти от единого Astro-шаблона (плохой Anti-Footprint). Каждый сайт в сетке получает случайный шаблон, цвет, шрифты и структуру тегов. Деплой - прямая загрузка готовых HTML-файлов в Cloudflare Pages, без GitHub.

## Изменения

### 1. Новый Edge Function `deploy-cloudflare-direct`
Полная замена связки `bootstrap-astro -> deploy-cloudflare` для сетки.

Логика:
1. Принимает: `project_id`, `template` (`minimal|magazine|news|landing`), `accent_color`, `font_pair`, `site_name`, `site_about`, `topic`.
2. Генерирует in-memory набор файлов (`index.html`, `about.html`, `style.css`, `_headers`, `robots.txt`, `sitemap.xml`) на основе выбранного шаблона.
3. Создаёт Cloudflare Pages проект через `POST /accounts/{id}/pages/projects` с `production_branch: "main"` без `source` (Direct Upload mode). Автосуффикс при 409 (как сейчас).
4. Деплоит через Cloudflare Direct Upload API:
   - `POST /accounts/{id}/pages/projects/{name}/deployments`
   - `multipart/form-data` с полем `manifest` (JSON: `{filename: sha256hash}`) и файлами под их хешами.
   - Использует встроенный crypto.subtle для SHA-256.
5. Сохраняет в `projects`: `domain = {name}.pages.dev`, `hosting_platform = "cloudflare"`, новые поля `template_type`, `accent_color`, `font_pair`.

### 2. Миграция БД
Добавить в `projects`:
- `template_type text` (nullable)
- `accent_color text` (nullable)
- `font_pair text` (nullable)

### 3. HTML-шаблоны (внутри edge function, как TS-модули)

Файл `supabase/functions/deploy-cloudflare-direct/templates.ts` экспортирует 4 функции `renderMinimal/Magazine/News/Landing(ctx) -> { "index.html": string, "about.html": string, "style.css": string, ... }`.

Различия по структуре HTML:
- **Минимал**: `<article>` + `<section>`, 1 колонка max-width 680px, serif (Lora/Merriweather/Playfair).
- **Журнал**: `<main><div class="grid">`, 2 колонки, sans (Inter/DM Sans), карточки с тенью.
- **Новости**: `<ul class="news-list"><li>`, плотный grid 3 колонки, компактный (Roboto/IBM Plex).
- **Лендинг**: `<header class="hero">` + `<section class="posts">`, hero с большим заголовком (Outfit/Sora).

В каждом - случайные:
- Порядок мета-тегов
- Разные имена CSS-классов (`.post` vs `.entry` vs `.item` vs `.card`)
- Заголовки nav: "Главная/Дом/Старт", "О нас/О сайте/Контакты"

### 4. Палитры и шрифты (`supabase/functions/deploy-cloudflare-direct/styles.ts`)

```ts
export const ACCENT_COLORS = ["#e11d48","#0ea5e9","#10b981","#f59e0b","#8b5cf6","#ef4444","#14b8a6","#f97316"];
export const FONT_PAIRS = {
  minimal:  [["Lora","Inter"],["Merriweather","Lato"],["Playfair Display","Source Sans 3"]],
  magazine: [["Inter","Inter"],["DM Sans","DM Sans"],["Manrope","Manrope"]],
  news:     [["Roboto","Roboto"],["IBM Plex Sans","IBM Plex Sans"],["Open Sans","Open Sans"]],
  landing:  [["Outfit","Inter"],["Sora","Manrope"],["Space Grotesk","DM Sans"]],
};
```

CSS использует `var(--accent)` и подключает Google Fonts через `<link>`.

### 5. Обновление `SiteGridCreator.tsx`

Удалить:
- Pre-flight поиск GitHub Token и `ghOwner` (больше не нужен).
- Шаги "bootstrapping" и вызов `bootstrap-astro`.
- Установку `github_token`/`github_repo`.

Добавить:
- Случайный выбор `template`, `accent_color`, `font_pair` для каждого сайта.
- Один шаг: вызов `deploy-cloudflare-direct` со всеми параметрами.
- Новая колонка в таблице "Шаблон" (минимал/журнал/новости/лендинг).

Статусы упрощаются: `pending -> creating -> deploying -> done`.

### 6. Технические детали Direct Upload

```ts
// 1. SHA-256 каждого файла
const buf = new TextEncoder().encode(content);
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))]
  .map(b => b.toString(16).padStart(2, "0")).join("");

// 2. manifest
const manifest = { "/index.html": hashIndex, "/style.css": hashCss, ... };

// 3. multipart body
const fd = new FormData();
fd.append("manifest", JSON.stringify(manifest));
for (const [path, content] of Object.entries(files)) {
  fd.append(manifest[path], new Blob([content], { type: mime(path) }), manifest[path]);
}

// 4. POST
await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${name}/deployments`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiToken}` },
  body: fd,
});
```

Cloudflare Pages Direct Upload не требует GitHub - проект создаётся в режиме `production_branch: "main"` без `source`.

### 7. Что остаётся без изменений

- `deploy-cloudflare` (старая, GitHub-based) - оставляем для уже существующих проектов в разделе "Управление".
- `bootstrap-astro` - не вызывается из сетки, но остаётся для одиночных проектов.
- AdminPanel, ключи Cloudflare - используются как есть (`cloudflare_account_id`, `cloudflare_api_token`).

## Файлы

- new: `supabase/functions/deploy-cloudflare-direct/index.ts`
- new: `supabase/functions/deploy-cloudflare-direct/templates.ts`
- new: `supabase/functions/deploy-cloudflare-direct/styles.ts`
- new migration: добавить `template_type`, `accent_color`, `font_pair` в `projects`
- edit: `src/components/site-factory/SiteGridCreator.tsx`

## Риски

- Cloudflare Direct Upload лимит ~25 МБ на деплой - для статичных HTML с лихвой хватает.
- Имена файлов в manifest должны начинаться со `/` - учтено.
- Cloudflare кэширует пустой проект ~10 сек после создания - добавим retry первого деплоя при 404.
