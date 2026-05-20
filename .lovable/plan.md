# Деплой Фабрики на GitHub Pages

## Что делаем
Добавляем GitHub Pages как полноценную платформу хостинга наряду с Cloudflare. Каждый сайт = новый отдельный публичный репозиторий в аккаунте пользователя (через персональный GitHub-токен). Статический HTML собирается тем же движком, что и Cloudflare Direct, и пушится в ветку `gh-pages`. Сайт доступен по `https://<username>.github.io/<repo>/`. Кастомный домен на этом этапе не подключаем.

## Архитектура

```text
SiteFactoryPage (UI)
    │
    ├─ hostingPlatform = "cloudflare" ──► deploy-cloudflare-direct
    │
    └─ hostingPlatform = "github_pages" ─► deploy-github-pages  (новая)
                                              │
                                              ├─ _shared/buildSiteFiles.ts  (новый общий модуль)
                                              │     └── рендер всех страниц + style.css + 404 + IndexNow
                                              │
                                              └─ GitHub REST API
                                                    1. создать repo (если нет)
                                                    2. PUT content base64  в ветку gh-pages
                                                    3. POST pages с source: gh-pages
```

## Шаги

### 1. Рефакторинг — общий модуль рендеринга
- Извлечь из `deploy-cloudflare-direct/index.ts` логику сборки `files: Record<string, string>` (шаблоны DB/dark/local/expert/minimal/news/magazine, anti-fingerprint, WP-emulation, cookie-баннер, 404, heading-QA, IndexNow) в `supabase/functions/_shared/buildSiteFiles.ts`. На вход — проект, посты, опции; на выход — карта файлов и метаданные. Cloudflare-функция начинает использовать этот модуль.

### 2. Новая edge-функция `deploy-github-pages`
- Авторизация: тот же base64url-decode JWT, что в остальных функциях.
- Берет `github_token` пользователя из `user_github_tokens` (PAT с `repo` scope) — уже существующая таблица.
- Имя репо: транслитерация `project.name` + короткий хэш id, валидируется по правилам GitHub.
- Алгоритм:
  1. `GET /user` чтобы узнать `login`.
  2. `GET /repos/{login}/{repo}` — если 404, создаем `POST /user/repos { name, private:false, auto_init:true }`.
  3. Собираем `files` через `buildSiteFiles`.
  4. Получаем SHA текущего корня `gh-pages` (если ветка есть) или базу `main`.
  5. Создаем blobs (`POST /git/blobs`, base64), tree (`POST /git/trees`), commit (`POST /git/commits`), обновляем ref `heads/gh-pages` (`PATCH /git/refs/...`, force при первом коммите).
  6. `POST /repos/{login}/{repo}/pages { source: { branch: "gh-pages", path: "/" } }` (если еще не включено).
- Возврат: `{ success, url: "https://<login>.github.io/<repo>/", repo_full_name }`.
- Сохраняем `domain` проекта = `https://<login>.github.io/<repo>/blog` чтобы UI отобразил ссылку.

### 3. UI на `SiteFactoryPage`
- Обработчик кнопки публикации/деплоя: если `hostingPlatform === "github_pages"`, вызывать `deploy-github-pages` (вместо `deploy-cloudflare-*`).
- Блок «Кастомный домен» скрывать для `github_pages` (в этой итерации не поддерживаем).
- В логах деплоя сообщения "Запуск деплоя на GitHub Pages..." / "Сайт: https://...".
- Сообщения об ошибках (нет токена → подсказка добавить PAT в Настройках → GitHub).

### 4. Тестирование
- Деплоим обе edge-функции.
- `curl_edge_functions` `deploy-github-pages` тестовым `project_id` под залогиненным юзером.
- Проверяем что Cloudflare-деплой не сломан после рефакторинга (выборочный smoke-тест).

## Технические детали

- GitHub REST API: `https://api.github.com`, Bearer PAT, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
- Все файлы кодируются `btoa(unescape(encodeURIComponent(content)))` для UTF-8 → base64.
- Лимит размера blob через contents API — 100MB; используем git/blobs для надежности.
- Имя репо: `[a-z0-9-]{1,80}`, не начинается с `-`. Конфликт имени → добавляем 6 hex символов из project_id.
- Pages API возвращает 409 если страница уже включена — обрабатываем как успех.
- При повторном деплое ветка `gh-pages` пересоздается одним новым коммитом (force-update ref) — никакой истории не накапливаем, как в Cloudflare Direct.

## Что НЕ делаем в этой итерации
- Кастомные домены (CNAME + DNS-инструкции) — добавим следующим шагом, когда базовый деплой стабилен.
- GitHub Actions / Vite-сборка на стороне GH — публикуем готовый HTML.
- Удаление репо при удалении проекта в `delete-cloudflare-site` (можно добавить отдельной задачей).
