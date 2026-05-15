// ==UserScript==
// @name         Qwen Writer Mini by @seo_drift
// @namespace    https://chat.qwen.ai/mini
// @version      1.0.0
// @description  Мини-версия: 1 фабричный промпт (инфо-статья) + слот «Свой промпт». Без выбора типа страниц.
// @author       https://t.me/seo_drift
// @match        https://chat.qwen.ai/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_download
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/marked@12/marked.min.js
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 1. Перехват сетевых запросов — fetch + XMLHttpRequest.
    //    Запоминаем настоящие headers/payload, которые сайт сам шлёт.
    //    Используем как шаблон для своих запросов.
    // ============================================================
    const CAPTURED = {
        headers: null,                // headers с последнего "интересного" запроса
        bodyTemplate: null,           // payload-шаблон БЕЗ поиска (обычный чат)
        bodyTemplateSearch: null,     // payload-шаблон С поиском (если был захвачен)
        model: null,
        chatType: 't2t',
        endpointCompletions: null,
        endpointNewChat: null,
        endpointAbsBase: null,
    };

    // Эвристика: похоже ли тело запроса на запрос с включённым «Поиск в сети» в Qwen?
    function isSearchPayload(parsed) {
        if (!parsed || typeof parsed !== 'object') return false;
        try {
            const s = JSON.stringify(parsed).toLowerCase();
            // Признаки: chat_type:"search", web_search:true, search_enabled:true, или feature_config.search
            return /"chat_type"\s*:\s*"search"|"web_search"\s*:\s*true|"search_enabled"\s*:\s*true|"search"\s*:\s*\{[^}]*"enabled"\s*:\s*true|"search_type"\s*:\s*"web"/.test(s);
        } catch (_) { return false; }
    }

    // Список последних ~30 запросов для диагностики
    const TRAFFIC = [];
    function rememberTraffic(method, url, hasMessages) {
        TRAFFIC.push({ t: Date.now(), method, url, hasMessages });
        if (TRAFFIC.length > 30) TRAFFIC.shift();
    }

    // Признаки "это запрос к чату Qwen":
    //  - URL содержит /chat/completions, /completion, /generate, /messages
    //  - ИЛИ body это JSON с массивом messages[*].content
    const URL_HINT_RE  = /(chat\/completions?|completion|generate|messages?|chats?\/new)/i;
    // Что НЕ должно считаться endpoint'ом отправки сообщения:
    const URL_BLOCK_RE = /\/(stop|abort|cancel|status|users)\b/i;

    function looksLikeChatBody(parsed) {
        return parsed && typeof parsed === 'object' &&
            Array.isArray(parsed.messages) && parsed.messages.length &&
            parsed.messages.some(m => m && typeof m === 'object' && ('content' in m || 'role' in m));
    }
    function looksLikeNewChatBody(parsed) {
        return parsed && typeof parsed === 'object' &&
            (Array.isArray(parsed.models) || parsed.chat_mode || parsed.chat_type) &&
            !Array.isArray(parsed.messages);
    }

    function handleCapture(url, method, headers, bodyRaw) {
        try {
            method = (method || 'GET').toUpperCase();
            if (method !== 'POST') return;

            let parsed = null;
            if (bodyRaw && typeof bodyRaw === 'string') {
                try { parsed = JSON.parse(bodyRaw); } catch (_) {}
            } else if (bodyRaw && typeof bodyRaw === 'object' && !(bodyRaw instanceof FormData) && !(bodyRaw instanceof Blob)) {
                parsed = bodyRaw;
            }

            const urlHint = URL_HINT_RE.test(url || '');
            const isChat = looksLikeChatBody(parsed);
            const isNew  = looksLikeNewChatBody(parsed) && urlHint;
            rememberTraffic(method, url, isChat);

            if (!urlHint && !isChat && !isNew) return;

            // Запоминаем endpoint'ы по фактическому URL — но НЕ /stop, /abort и т.п.
            try {
                const u = new URL(url, location.href);
                CAPTURED.endpointAbsBase = u.origin;
                const isBlockedPath = URL_BLOCK_RE.test(u.pathname);
                if (!isBlockedPath && (isChat || /chat\/completions?|completion/i.test(u.pathname))) {
                    // сохраняем pathname без query (chat_id и прочее подставим сами)
                    CAPTURED.endpointCompletions = u.pathname;
                }
                if (!isBlockedPath && (isNew || /chats?\/new/i.test(u.pathname))) {
                    CAPTURED.endpointNewChat = u.pathname;
                }
            } catch (_) {}

            if (headers && Object.keys(headers).length) {
                CAPTURED.headers = Object.assign({}, headers);
            }
            if (isChat && parsed) {
                const clone = JSON.parse(JSON.stringify(parsed));
                if (isSearchPayload(parsed)) {
                    CAPTURED.bodyTemplateSearch = clone;
                    log(`Захвачен шаблон С поиском (${Object.keys(clone).length} полей)`);
                } else {
                    CAPTURED.bodyTemplate = clone;
                    log(`Захвачен шаблон без поиска (${Object.keys(clone).length} полей)`);
                }
                if (parsed.model) CAPTURED.model = parsed.model;
                const last = parsed.messages[parsed.messages.length - 1];
                if (last && last.chat_type) CAPTURED.chatType = last.chat_type;
                else if (parsed.chat_type) CAPTURED.chatType = parsed.chat_type;
                addCapturedModelToSelect(CAPTURED.model);
            }
            // Берём модель ещё и из тела запроса /chats/new (там она в models[0])
            if (isNew && parsed && Array.isArray(parsed.models) && parsed.models.length) {
                const m = String(parsed.models[0]);
                if (m && m !== CAPTURED.model) {
                    CAPTURED.model = m;
                    addCapturedModelToSelect(m);
                }
                if (parsed.chat_type) CAPTURED.chatType = parsed.chat_type;
            }
            updateStatus();
        } catch (_) {}
    }

    // Универсальное чтение тела запроса в строку (async)
    async function readBodyToString(body, requestObj) {
        try {
            if (body == null && requestObj) {
                // Request: клонируем и читаем (исходный поток не трогаем)
                try { return await requestObj.clone().text(); } catch (_) { return null; }
            }
            if (body == null) return null;
            if (typeof body === 'string') return body;
            if (body instanceof Blob) {
                try { return await body.text(); } catch (_) { return null; }
            }
            if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
            if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
            if (body instanceof URLSearchParams) return body.toString();
            // FormData / ReadableStream — без consuming не прочесть
            return null;
        } catch (_) { return null; }
    }

    // Получаем РЕАЛЬНЫЙ window страницы, а не Tampermonkey-sandbox.
    // Без этого подмена fetch затрагивает только наш контекст, и реальные запросы сайта проходят мимо.
    const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // --- fetch hook на window страницы ---
    const origFetch = pageWin.fetch;
    pageWin.fetch = function (input, init) {
        try {
            const req = (input instanceof pageWin.Request) ? input : ((input instanceof Request) ? input : null);
            const url = req ? req.url : (typeof input === 'string' ? input : (input && input.url) || '');
            const method = (init && init.method) || (req && req.method) || 'GET';

            const headers = {};
            const hsrc = (init && init.headers) || (req && req.headers);
            const HeadersCtor = pageWin.Headers || Headers;
            if (hsrc instanceof HeadersCtor) hsrc.forEach((v, k) => headers[k] = v);
            else if (Array.isArray(hsrc)) hsrc.forEach(([k, v]) => headers[k] = v);
            else if (hsrc && typeof hsrc === 'object') Object.assign(headers, hsrc);

            const rawBody = (init && init.body) != null ? init.body : null;
            readBodyToString(rawBody, req).then(bodyStr => {
                handleCapture(url, method, headers, bodyStr);
            }).catch(() => {});
        } catch (_) {}
        return origFetch.apply(this, arguments);
    };

    // --- XMLHttpRequest hook на prototype window страницы ---
    const XHRProto  = pageWin.XMLHttpRequest && pageWin.XMLHttpRequest.prototype;
    if (XHRProto) {
        const XHRopen   = XHRProto.open;
        const XHRsetHdr = XHRProto.setRequestHeader;
        const XHRsend   = XHRProto.send;

        XHRProto.open = function (method, url) {
            this.__qbs = { method, url, headers: {} };
            return XHRopen.apply(this, arguments);
        };
        XHRProto.setRequestHeader = function (k, v) {
            if (this.__qbs) this.__qbs.headers[k] = v;
            return XHRsetHdr.apply(this, arguments);
        };
        XHRProto.send = function (body) {
            try {
                if (this.__qbs) {
                    readBodyToString(body, null).then(bodyStr => {
                        handleCapture(this.__qbs.url, this.__qbs.method, this.__qbs.headers, bodyStr);
                    }).catch(() => {});
                }
            } catch (_) {}
            return XHRsend.apply(this, arguments);
        };
    }

    // ============================================================
    // 2. Утилиты
    // ============================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function uuid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function getAuthHeaders(extra) {
        const h = { 'Content-Type': 'application/json' };
        if (CAPTURED.headers) {
            Object.entries(CAPTURED.headers).forEach(([k, v]) => {
                const kl = k.toLowerCase();
                if (kl === 'content-length' || kl === 'content-type') return;
                h[k] = v;
            });
        } else {
            // fallback: возможные места хранения токена
            const token =
                localStorage.getItem('token') ||
                localStorage.getItem('access_token') ||
                localStorage.getItem('userToken');
            if (token) h['Authorization'] = `Bearer ${token.replace(/^"|"$/g, '')}`;
        }
        if (extra) Object.assign(h, extra);
        return h;
    }

    function parseList(text) {
        // Разделитель блоков (чатов) — строка из 3+ дефисов
        const blocks = text.split(/^\s*-{3,}\s*$/m)
            .map(b => b.split('\n').map(l => l.trim()).filter(Boolean))
            .filter(b => b.length);
        return blocks;
    }

    // Извлекает номера пунктов плана из ответа Qwen.
    // План имеет вид:  "1. Название | Ключевые слова: ... | Размер: ..."
    // Возвращает массив [1,2,...,N] без дыр.
    function parsePlanItems(answer) {
        if (!answer || typeof answer !== 'string') return [];
        const nums = new Set();
        const lines = answer.split(/\r?\n/);
        for (const line of lines) {
            const m = line.match(/^\s*(\d{1,2})\.\s+\S/);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n >= 1 && n <= 30) nums.add(n);
            }
        }
        return Array.from(nums).sort((a, b) => a - b);
    }

    // Парсит строку пункта плана и возвращает объект полей: {name, Ключи, LSI, LT/PAA, Факты, H3, Формат, Интент, Размер, Обоснование}
    function parsePlanItemFields(planText, n) {
        if (!planText) return null;
        const lines = planText.split(/\r?\n/);
        const re = new RegExp('^\\s*' + n + '\\.\\s+(.+)$');
        const line = lines.find(l => re.test(l.trim()));
        if (!line) return null;
        const rest = line.trim().replace(re, '$1');
        // Разбиваем по «|» с учётом возможных пробелов вокруг
        const parts = rest.split(/\s*\|\s*/);
        const name = (parts.shift() || '').replace(/\s*\[GAP[^\]]*\]\s*$/i, '').trim();
        const fields = { name };
        for (const part of parts) {
            const m = part.match(/^([^:]+):\s*(.*)$/);
            if (m) fields[m[1].trim()] = m[2].trim();
        }
        return fields;
    }

    // Собирает обогащённую команду «Распиши пункт N» с параметрами из плана.
    function buildExpandCommand(n, planText) {
        const item = parsePlanItemFields(planText, n);
        if (!item) {
            // Fallback: парсер не справился — отправляем короткую команду с напоминанием про H3
            return `Распиши пункт ${n}. ОБЯЗАТЕЛЬНО раздели раздел на 2-4 подзаголовка ### (с заглавной буквы), под каждым 1-3 абзаца. Без H3 раздел не принимается (кроме блоков до 150 слов).`;
        }
        const out = [];
        out.push(`Распиши пункт ${n} плана.`);
        out.push('');
        out.push(`ПЕРВАЯ СТРОКА ответа — ОБЯЗАТЕЛЬНО «## ${item.name}» (заголовок H2 раздела). Без этой строки раздел не валиден.`);
        out.push('');
        out.push('Параметры раздела (из плана выше):');
        const keys = item['Ключи'] || item['Ключевые слова'];
        if (keys) out.push(`— Ключевые слова (использовать ВСЕ органично): ${keys}.`);
        if (item['LSI']) out.push(`— LSI (использовать минимум 70%): ${item['LSI']}.`);
        const ngrams = item['N-граммы'] || item['Н-граммы'] || item['Нграммы'];
        if (ngrams && ngrams !== '—') out.push(`— N-граммы (частотные фразы из ТОП-10, использовать минимум 70% органично): ${ngrams}.`);
        const lt = item['LT/PAA'] || item['LT'] || item['PAA'];
        if (lt && lt !== '—') out.push(`— Вопросы для раскрытия (ответь на ВСЕ органично, не списком): ${lt}.`);
        const facts = item['Факты'] || item['Источники'];
        if (facts && facts !== '—') out.push(`— Обязательные факты/источники (упомянуть с правильной формулировкой): ${facts}.`);
        const h3 = item['H3'];
        if (h3 && h3 !== '—') out.push(`— Микротемы H3 — раздели раздел на эти подзаголовки «### Заголовок» (с заглавной): ${h3}. Под каждой H3 — реальный блок раскрытия с несколькими абзацами. Если под микротемой укладывается только одно предложение — объедини её с соседней или убери H3 совсем.`);
        else out.push(`— H3 в плане не задано — пиши раздел монолитным текстом, без подзаголовков (если Формат не требует иного).`);
        const fmt = item['Формат'];
        if (fmt) {
            out.push(`— Формат блока СТРОГО: ${fmt}.`);
            const f = fmt.toLowerCase();
            if (/нумерованн/.test(f)) out.push(`  → Это значит: реальный markdown-список «1. ... 2. ... 3. ...» с пояснением под каждым пунктом. НЕ сваливай пункты в один абзац прозы.`);
            else if (/чек-?лист/.test(f)) out.push(`  → Это значит: реальный markdown-список с «— » или «✓ » в начале каждой строки. Каждый пункт — отдельной строкой.`);
            else if (/таблиц/.test(f)) out.push(`  → Это значит: реальная markdown-таблица с шапкой «| ... | ... |» и строками. Раздел строится вокруг таблицы.`);
            else if (/вопрос.*ответ|q.?a/.test(f)) out.push(`  → Это значит: каждый вопрос как «### <Вопрос>», ответ 2-3 предложения сразу под ним. ПЕРВОЕ предложение ответа = прямой ответ без оговорок.`);
            else if (/h3.?разбор|h3-разбор/.test(f)) out.push(`  → Это значит: каждый пункт (способ/шаг/тип) — отдельный «### <Название пункта>» с развёрнутым описанием 150-300 слов. НЕ перечисляй пункты в одном абзаце.`);
            else if (/связн|проз/.test(f)) out.push(`  → Это значит: без таблиц и списков, только связный текст.`);
        }
        // Проверка по названию: если в названии есть число + категория (6 способов, 7 шагов) — формат должен быть структурным.
        if (/\b(\d{1,2})\s+(способ|шаг|этап|пункт|тип|вид|правил|ошибк|причин|пример)/i.test(item.name)) {
            out.push(`— ВНИМАНИЕ: в названии раздела есть число «${item.name.match(/\d+/)[0]}» — содержимое ОБЯЗАТЕЛЬНО структурировать (нумерованный список / чек-лист / H3-разбор / таблица). ЗАПРЕЩЕНО лепить все пункты в один абзац прозы.`);
        }
        if (item['Интент']) out.push(`— Интент: ${item['Интент']}.`);
        if (item['Размер']) out.push(`— Размер: ${item['Размер']}.`);
        out.push('');
        out.push('Раскрой раздел согласно правилам системного промпта (тон, запреты клише, конкретика с цифрами).');
        out.push('');
        out.push('КРИТИЧНО про жирный (**текст**):');
        out.push('— SEO-ключи, LSI и N-граммы из плана НЕ выделять жирным. Они идут обычным текстом, органично.');
        out.push('— Жирным — только критичные предупреждения, цифры (суммы/сроки/проценты), нормы законов, ключевые инструкции.');
        out.push('— Не больше 1-2 жирных на абзац. Если 3+ — лишние сделать обычным текстом.');
        return out.join('\n');
    }

    // Определяет, нужен ли веб-поиск для данной команды.
    // Эвристика: команда явно про план / анализ выдачи → поиск нужен.
    function commandNeedsSearch(cmd) {
        if (!cmd) return false;
        const c = cmd.toLowerCase();
        return /(состав\w*\s+план|сделай\s+план|план\s+статьи|анализ\s+выдач|анализ\s+конкурент|изуч\w+\s+топ|изуч\w+\s+выдач)/i.test(c);
    }

    function csvCell(s) {
        const v = String(s == null ? '' : s);
        return '"' + v.replace(/"/g, '""') + '"';
    }

    function cleanForExport(p) {
        const pre = p.isHeader ? normalizeHeaderBlock(p.a) : p.a;
        return stripServicePrefixes(pre);
    }

    // Дедупликация повторных markdown-ссылок в статье целиком (между разделами).
    // Одна и та же ссылка остаётся как [текст](url) первые 2 раза, дальше — обычный текст.
    function dedupeLinksAcrossArticle(md) {
        if (!md || typeof md !== 'string') return md;
        const counts = {};
        return md.replace(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g, (full, text, url) => {
            const key = url.toLowerCase().replace(/\/+$/, '');
            counts[key] = (counts[key] || 0) + 1;
            if (counts[key] <= 2) return full;
            return text; // оставляем только видимый текст без markdown-ссылки
        });
    }

    function toCSV(pairs, includeQ) {
        const head = includeQ ? ['question', 'answer'] : ['answer'];
        const rows = [head.join(',')];
        pairs.forEach(p => {
            const a = cleanForExport(p);
            rows.push(includeQ ? `${csvCell(p.q)},${csvCell(a)}` : csvCell(a));
        });
        return rows.join('\n');
    }

    function toMD(pairs, includeQ) {
        return pairs.map((p, i) => {
            const head = `## ${i + 1}`;
            const a = cleanForExport(p);
            const body = includeQ
                ? `**Вопрос:**\n\n${p.q}\n\n**Ответ:**\n\n${a}`
                : a;
            return `${head}\n\n${body}`;
        }).join('\n\n---\n\n');
    }

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // Базовая чистка ответа Qwen — применяется ко ВСЕМ ответам (разделам, FAQ, H1+лид).
    // НЕ конвертирует ## → # — это делает только normalizeHeaderBlock для блока «H1 и лид».
    function stripServicePrefixes(md) {
        if (!md || typeof md !== 'string') return md;
        // 1. Префиксы типа "## Введение: ..." → "## ..."
        const PREFIXES = '(введение|вступление|заключение(?:\\s+и\\s+CTA)?|featured\\s*snippet|cta|призыв\\s+к\\s+действию|итог|f\\.?a\\.?q\\.?)';
        const re = new RegExp(`^(#{1,6})\\s*${PREFIXES}\\s*[:\\-—]\\s*(.+)$`, 'gim');
        let out = md.replace(re, '$1 $3');
        // 2. Служебные метки в квадратных скобках в заголовках — В ЛЮБОМ МЕСТЕ:
        //    "## [GAP] Заголовок", "## Заголовок [GAP]", "## [GAP/UX] Заголовок [Featured Snippet]" и т.п.
        const TAG_TYPES = '(?:GAP(?:\\/[^\\]]+)?|Featured\\s*Snippet|FAQ|CTA|Заключение|Введение|Итог|H[1-6])';
        out = out.replace(/^(#{1,6}\s)(.*)$/gm, (match, hash, content) => {
            const re2 = new RegExp(`\\s*\\[\\s*${TAG_TYPES}\\s*\\]\\s*`, 'gi');
            const cleaned = content.replace(re2, ' ').replace(/\s+/g, ' ').trim();
            return hash + cleaned;
        });
        // 3. Служебные ссылки-маркеры источников из Qwen Search: [[12]], [[42]], [[7]] [[12]] и т.п.
        out = out.replace(/\s*\[\[\d+\]\](?:\s*,?\s*\[\[\d+\]\])*/g, '');
        // 4. Капитализируем первую букву во всех заголовках H2..H6
        out = out.replace(/^(#{2,6}\s+)(.)/gm, (_, hash, ch) => hash + ch.toLocaleUpperCase('ru-RU'));
        return out;
    }

    // Нормализация блока «H1 и лид» — применяется ТОЛЬКО к ответам с флагом isHeader.
    // Цель: вытащить корректный H1 (# текст) и абзац лида из любого формата ответа Qwen.
    function normalizeHeaderBlock(md) {
        if (!md || typeof md !== 'string') return md;
        let out = md;
        // "H1: текст" → "# текст"
        out = out.replace(/^\s*H1\s*[:.\-—]\s*(.+)$/gim, '# $1');
        // "Лид: текст" → "текст" (убираем префикс)
        out = out.replace(/^\s*Лид\s*[:.\-—]\s*(.+)$/gim, '$1');
        // Первая непустая строка как заголовок уровня 2..6 → переводим в H1
        const lines = out.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i].trim();
            if (!l) continue;
            const m = l.match(/^#{2,6}\s+(.+)$/);
            if (m && m[1].length <= 120) {
                lines[i] = '# ' + m[1];
            }
            break; // обрабатываем только первую непустую строку
        }
        out = lines.join('\n');
        // Капитализация в H1
        out = out.replace(/^(#\s+)(.)/m, (_, hash, ch) => hash + ch.toLocaleUpperCase('ru-RU'));
        return out;
    }

    // Конвертирует markdown-текст ответа Qwen в HTML.
    // Использует marked (подгружается через @require). Fallback — экранированный <pre>.
    function renderAnswerHtml(md) {
        const cleaned = stripServicePrefixes(md);
        try {
            const m = (typeof marked !== 'undefined') ? marked : (typeof unsafeWindow !== 'undefined' && unsafeWindow.marked);
            if (m && typeof m.parse === 'function') {
                return m.parse(String(cleaned || ''), { breaks: true, gfm: true });
            }
            if (typeof m === 'function') return m(String(cleaned || ''));
        } catch (_) {}
        return `<pre>${escHtml(cleaned)}</pre>`;
    }

    // Группируем пары по чату: один блок (между разделителями ---) = одна статья.
    // Внутри группы: H1+лид ставится ПЕРВЫМ, остальные — по idx (порядку появления).
    function groupByChat(pairs) {
        const groups = new Map();
        pairs.forEach(p => {
            const k = p.chat || 1;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(p);
        });
        // сортируем внутри каждой группы
        return Array.from(groups.values()).map(g =>
            [...g].sort((a, b) => {
                const aH = a.isHeader ? 0 : 1;
                const bH = b.isHeader ? 0 : 1;
                if (aH !== bH) return aH - bH;
                return (a.idx || 0) - (b.idx || 0);
            })
        );
    }

    // Рендер одной статьи (= одного чата) в HTML-фрагмент.
    // В bare-режиме вопросы намеренно опускаются — это чистая статья.
    function renderArticleFragment(group, includeQ, bare) {
        // Дедупликация ссылок — отслеживаем счётчик между разделами одной статьи через общий объект.
        const linkCounts = {};
        return group.map(p => {
            let md = p.isHeader ? normalizeHeaderBlock(p.a) : p.a;
            // Замена повторных ссылок в этом разделе (с учётом счётчика по всей статье)
            md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g, (full, text, url) => {
                const key = url.toLowerCase().replace(/\/+$/, '');
                linkCounts[key] = (linkCounts[key] || 0) + 1;
                if (linkCounts[key] <= 2) return full;
                return text;
            });
            const a = renderAnswerHtml(md);
            if (bare || !includeQ) return a;
            const q = `<p class="q">${escHtml(p.q).replace(/\n/g, '<br>')}</p>`;
            return q + '\n' + a;
        }).join('\n');
    }

    // Полный самостоятельный HTML-документ на одну статью (один чат).
    // Используется при опции «Каждая статья отдельным файлом».
    function toSingleArticleHTML(group, includeQ, bare, title) {
        const inner = renderArticleFragment(group, includeQ, bare);
        if (bare) return inner + '\n';
        return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escHtml(title || 'Статья')}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:780px;margin:32px auto;padding:0 20px;color:#1f2937;line-height:1.6}
.q{white-space:pre-wrap;background:#f3f4f6;padding:10px 12px;border-radius:6px;margin:14px 0 8px;font-weight:500}
pre{background:#0f1115;color:#e5e7eb;padding:14px;border-radius:8px;overflow:auto;font-size:13px}
code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:0.9em}
pre code{background:transparent;padding:0}
table{border-collapse:collapse;width:100%;margin:10px 0}
th,td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left}
blockquote{border-left:3px solid #d1d5db;margin:0;padding:4px 12px;color:#4b5563}
img{max-width:100%}
h1,h2,h3{line-height:1.25}
@media (prefers-color-scheme:dark){
 body{background:#0f1115;color:#e5e7eb}
 .q{background:#1a1f2b}
 code{background:#1a1f2b}
 th,td{border-color:#2a2f3a}
 blockquote{border-color:#374151;color:#9ca3af}
}
</style>
</head>
<body>
${inner}
</body>
</html>`;
    }

    function toHTML(pairs, includeQ, bare) {
        const groups = groupByChat(pairs);
        const renderGroup = (group) => renderArticleFragment(group, includeQ, bare);

        if (bare) {
            // Чистая HTML-разметка для копи-пасты на сайт.
            // Каждая статья — содержимое одного чата без обёрток. Между статьями — <hr>.
            return groups.map(renderGroup).join('\n<hr>\n') + '\n';
        }

        // Стилизованный документ: каждая статья = <article> на один чат.
        const articles = groups.map(group => `<article>\n${renderGroup(group)}\n</article>`).join('\n\n');
        return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Qwen Writer Mini by @seo_drift</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:880px;margin:24px auto;padding:0 16px;color:#1f2937;line-height:1.55}
article{border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin:0 0 18px}
article :first-child{margin-top:0}
article :last-child{margin-bottom:0}
article .q{white-space:pre-wrap;background:#f3f4f6;padding:10px 12px;border-radius:6px;margin:14px 0 8px;font-weight:500}
article pre{background:#0f1115;color:#e5e7eb;padding:12px;border-radius:6px;overflow:auto;font-size:13px}
article code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:0.9em}
article pre code{background:transparent;padding:0}
article table{border-collapse:collapse;width:100%;margin:8px 0}
article th,article td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left}
article blockquote{border-left:3px solid #d1d5db;margin:0;padding:4px 12px;color:#4b5563}
article img{max-width:100%}
@media (prefers-color-scheme:dark){
 body{background:#0f1115;color:#e5e7eb}
 article{border-color:#2a2f3a}
 article .q{background:#1a1f2b}
 article code{background:#1a1f2b}
 article th,article td{border-color:#2a2f3a}
 article blockquote{border-color:#374151;color:#9ca3af}
}
</style>
</head>
<body>
${articles}
</body>
</html>`;
    }

    function download(filename, content, mime) {
        const blob = new Blob([content], { type: mime + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
    }

    // ============================================================
    // 3. Сетевые операции с Qwen
    // ============================================================
    async function createChat(model) {
        const path = CAPTURED.endpointNewChat || '/api/v2/chats/new';
        const res = await fetch(path, {
            method: 'POST',
            headers: getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({
                title: 'Bulk Sender',
                models: [model],
                chat_mode: 'local',
                chat_type: CAPTURED.chatType || 't2t',
                timestamp: Date.now(),
            }),
        });
        if (!res.ok) throw new Error(`createChat HTTP ${res.status}`);
        const data = await res.json();
        const id = data?.data?.id || data?.id || data?.chat_id || data?.data?.chat_id;
        if (!id) throw new Error('createChat: id не найден в ответе: ' + JSON.stringify(data).slice(0, 200));
        return id;
    }

    function buildSendBody(chatId, model, question, parentId, useSearch) {
        // ВАЖНО: берём перехваченный шаблон целиком и трогаем минимум полей.
        // Лишние перезаписи (особенно messages/chat_type) ломают серверный pipeline Qwen.
        const tpl = useSearch
            ? (CAPTURED.bodyTemplateSearch || CAPTURED.bodyTemplate)
            : (CAPTURED.bodyTemplate || CAPTURED.bodyTemplateSearch);
        if (tpl) {
            const body = JSON.parse(JSON.stringify(tpl));

            // chat_id — обязательно подменяем
            body.chat_id = chatId;
            // response_id — должен быть уникальный на каждый запрос
            body.response_id = uuid();

            // model — подменяем если задан явно
            if (model) body.model = model;

            // Заменяем содержимое последнего user-message, сохраняя структуру (chat_type, extra, feature_config и т.п.)
            if (Array.isArray(body.messages) && body.messages.length) {
                const last = JSON.parse(JSON.stringify(body.messages[body.messages.length - 1]));
                last.role = 'user';
                last.content = question;
                // если в шаблоне у сообщения есть files/attachments — обнулим, чтобы не отправить чужие
                if ('files' in last) last.files = [];
                if ('attachments' in last) last.attachments = [];
                body.messages = [last];
            } else {
                // на всякий случай минимальный fallback
                body.messages = [{
                    role: 'user',
                    content: question,
                    chat_type: CAPTURED.chatType || 't2t',
                    extra: {},
                    feature_config: { thinking_enabled: false, output_schema: 'phase' },
                }];
            }

            // parent_id: при первом сообщении в чате обязательно null/убрать.
            if (parentId) body.parent_id = parentId;
            else { body.parent_id = null; if (!('parent_id' in body)) delete body.parent_id; }

            return body;
        }

        // Полный fallback — если шаблона нет вообще (теоретически не должно случиться)
        const chat_type = CAPTURED.chatType || 't2t';
        const body = {
            stream: true,
            incremental_output: true,
            chat_id: chatId,
            chat_mode: 'local',
            chat_type,
            model,
            response_id: uuid(),
            messages: [{
                role: 'user',
                content: question,
                chat_type,
                extra: {},
                feature_config: { thinking_enabled: false, output_schema: 'phase' },
            }],
        };
        if (parentId) body.parent_id = parentId;
        return body;
    }

    // Извлекает кусок текста из произвольной "delta"-структуры Qwen.
    // Перебирает известные места.
    function extractContent(obj) {
        if (!obj || typeof obj !== 'object') return { text: '', phase: null, msgId: null };
        let phase = null, msgId = null;
        const choice = (obj.choices && obj.choices[0]) || null;
        const delta  = (choice && choice.delta) || obj.delta || null;
        phase = (delta && (delta.phase || delta.status)) || (choice && choice.phase) || obj.phase || obj.status || null;
        // Qwen ID ассистент-ответа называется response_id. Также бывает message_id (в OpenAI-совместимом формате).
        msgId =
            obj.response_id ||
            (delta && delta.response_id) ||
            (choice && choice.response_id) ||
            (obj['response.created'] && obj['response.created'].response_id) ||
            (delta && delta.message_id) ||
            obj.message_id ||
            (choice && choice.message_id) ||
            null;

        const candidates = [
            delta && delta.content,
            delta && delta.text,
            delta && delta.reasoning_content,
            delta && delta.output_text,
            choice && choice.text,
            choice && choice.message && choice.message.content,
            obj.content,
            obj.text,
            obj.output && obj.output.text,
            obj.output && Array.isArray(obj.output.choices) && obj.output.choices[0] && obj.output.choices[0].message && obj.output.choices[0].message.content,
            obj.data && obj.data.content,
        ];
        let text = '';
        for (const c of candidates) {
            if (typeof c === 'string' && c.length) { text = c; break; }
            if (Array.isArray(c)) {
                // например content: [{type:'text', text:'...'}]
                const joined = c.map(x => (x && typeof x === 'object') ? (x.text || x.content || '') : (typeof x === 'string' ? x : '')).join('');
                if (joined) { text = joined; break; }
            }
        }
        return { text, phase, msgId };
    }

    // Обёртка над фактической отправкой: ретраит серверные ошибки Qwen
    // (InternalError, 5xx, 429). Клиентские ошибки (4xx кроме 429) — не ретраит.
    async function sendMessage(chatId, model, question, parentId, onChunk, useSearch) {
        const MAX_ATTEMPTS = 3;
        let lastError;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return await sendMessageOnce(chatId, model, question, parentId, onChunk, useSearch);
            } catch (e) {
                lastError = e;
                const msg = String((e && e.message) || e);
                const retryable = /InternalError|Internal server error|HTTP 5\d\d|HTTP 429|молчание стрима|запрос прерван|RateLimit/i.test(msg);
                if (attempt < MAX_ATTEMPTS && retryable) {
                    const delay = 5000 * attempt; // 5с, 10с
                    log(`    ⟳ ${msg.slice(0, 80)}… ретрай через ${delay/1000}с (попытка ${attempt+1}/${MAX_ATTEMPTS})`);
                    await sleep(delay);
                    continue;
                }
                throw e;
            }
        }
        throw lastError;
    }

    async function sendMessageOnce(chatId, model, question, parentId, onChunk, useSearch) {
        const body = buildSendBody(chatId, model, question, parentId, useSearch);
        if (STATE.debugSse) {
            const dump = JSON.stringify(body);
            log(`    [debug] payload (${dump.length}b, search=${!!useSearch}): ${dump.length > 400 ? dump.slice(0, 400) + '…' : dump}`);
        }
        // Используем реально перехваченный endpoint, иначе дефолт
        let endpoint = CAPTURED.endpointCompletions || '/api/v2/chat/completions';
        endpoint = endpoint.replace(/([?&])chat_id=[^&]*/i, `$1chat_id=${encodeURIComponent(chatId)}`);
        if (!/chat_id=/i.test(endpoint)) {
            endpoint += (endpoint.includes('?') ? '&' : '?') + 'chat_id=' + encodeURIComponent(chatId);
        }

        // Watchdog: прерываем, ТОЛЬКО если стрим молчит дольше N секунд (Qwen завис).
        // Жёсткого таймаута на весь запрос нет — пока ответ идёт, ждём сколько надо.
        const idleTimeoutMs = (STATE.idleTimeoutSec || 60) * 1000;
        const ctrl = new AbortController();

        let res;
        try {
            res = await fetch(endpoint, {
                method: 'POST',
                headers: getAuthHeaders({ 'Accept': 'text/event-stream' }),
                credentials: 'include',
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
        } catch (e) {
            if (ctrl.signal.aborted) throw new Error('запрос прерван');
            throw e;
        }
        if (!res.ok || !res.body) {
            const txt = await res.text().catch(() => '');
            throw new Error(`sendMessage HTTP ${res.status}: ${txt.slice(0, 300)}`);
        }

        // Если ответ не SSE — читаем как JSON/текст целиком (формат может быть не стримовым)
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('event-stream') && !ct.includes('stream')) {
            const txt = await res.text();
            if (STATE.debugSse) {
                log(`    [debug] non-stream ct="${ct}" body[0..400]: ${txt.slice(0, 400)}`);
            }
            let obj = null; try { obj = JSON.parse(txt); } catch (_) {}
            if (obj && obj.success === false) {
                const code = obj?.data?.code || 'Error';
                const det  = obj?.data?.details || JSON.stringify(obj).slice(0, 200);
                throw new Error(`Qwen ${code}: ${det}`);
            }
            // success:true но status:false и details "The request is ended!" — Qwen отверг запрос молча
            if (obj && obj.success === true && obj.data && obj.data.status === false) {
                throw new Error(`Qwen отверг запрос: ${obj.data.details || 'без деталей'} (payload-шаблон может быть некорректным — открой DevTools → Network → /chat/completions и сравни payload с тем, что показано в debug-логе)`);
            }
            const ex = extractContent(obj);
            return { answer: (ex.text || txt).trim(), assistantId: ex.msgId };
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        let answer = '';
        let lastAssistantMsgId = null;
        let framesSeen = 0;
        let lastFrameAt = Date.now();
        let finished = false;
        let abortReason = null;

        // Watchdog: если в стриме нет новых фреймов дольше idleTimeoutMs — прерываем
        const watchdog = setInterval(() => {
            if (Date.now() - lastFrameAt > idleTimeoutMs) {
                abortReason = `молчание стрима ${idleTimeoutMs/1000}с`;
                try { ctrl.abort(); } catch (_) {}
            }
        }, 2000);

        try {
            while (!finished) {
                let read;
                try {
                    read = await reader.read();
                } catch (e) {
                    if (abortReason) throw new Error(abortReason);
                    if (ctrl.signal.aborted) throw new Error('запрос прерван');
                    throw e;
                }
                if (read.done) break;
                buf += decoder.decode(read.value, { stream: true });
                lastFrameAt = Date.now();

                const FRAME_SEP = /\r?\n\r?\n/;
                let m;
                while ((m = FRAME_SEP.exec(buf)) !== null) {
                    const frame = buf.slice(0, m.index);
                    buf = buf.slice(m.index + m[0].length);

                    const dataLines = frame.split(/\r?\n/).filter(l => l.startsWith('data:'));
                    if (!dataLines.length) continue;
                    const payload = dataLines.map(l => l.slice(5).replace(/^\s/, '')).join('\n');
                    if (!payload || payload === '[DONE]') { finished = true; break; }

                    let obj;
                    try { obj = JSON.parse(payload); }
                    catch (_) {
                        if (STATE.debugSse && framesSeen < 3) log(`    [debug] non-json frame: ${payload.slice(0, 300)}`);
                        continue;
                    }

                    if (STATE.debugSse && framesSeen < 5) {
                        log(`    [debug] frame ${framesSeen}: ${JSON.stringify(obj).slice(0, 400)}`);
                    }
                    framesSeen++;

                    const ex = extractContent(obj);
                    if (ex.msgId) lastAssistantMsgId = ex.msgId;
                    if (ex.text) {
                        if (ex.phase && /^(think|reasoning|thinking)$/i.test(String(ex.phase))) continue;
                        answer += ex.text;
                        if (onChunk) onChunk(ex.text);
                    }
                    // Явный сигнал конца генерации от Qwen
                    if (ex.phase && /^(finished|completed|done)$/i.test(String(ex.phase))) {
                        finished = true;
                        break;
                    }
                }
            }
        } finally {
            clearInterval(watchdog);
            try { reader.cancel(); } catch (_) {}
        }

        if (STATE.debugSse) log(`    [debug] всего фреймов: ${framesSeen}, длина ответа: ${answer.length}`);
        return { answer: answer.trim(), assistantId: lastAssistantMsgId };
    }

    // ============================================================
    // 4. UI
    // ============================================================
    const STYLE = `
#qbs-fab{position:fixed;right:18px;bottom:18px;z-index:999999;width:48px;height:48px;border-radius:50%;
background:#615ced;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;
box-shadow:0 6px 24px rgba(0,0,0,.35);font:600 18px/1 system-ui,sans-serif;user-select:none}
#qbs-fab:hover{background:#4f49d8}
#qbs-panel{position:fixed;right:18px;bottom:78px;z-index:999999;width:420px;max-height:78vh;
background:#1b1f2a;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:12px;
box-shadow:0 18px 48px rgba(0,0,0,.45);font:13px/1.45 system-ui,sans-serif;display:none;flex-direction:column}
#qbs-panel.open{display:flex}
#qbs-panel header{padding:10px 14px;border-bottom:1px solid #2a2f3a;display:flex;align-items:center;gap:8px}
#qbs-panel header h3{margin:0;font-size:14px;flex:1}
#qbs-panel .body{padding:12px 14px;overflow:auto}
#qbs-panel label{display:block;margin:8px 0 4px;color:#cbd5e1;font-size:12px}
#qbs-panel textarea, #qbs-panel input[type=text], #qbs-panel select, #qbs-panel input[type=number]{
width:100%;box-sizing:border-box;background:#0f1115;color:#e5e7eb;border:1px solid #2a2f3a;
border-radius:6px;padding:7px 9px;font:inherit}
#qbs-panel textarea{min-height:130px;resize:vertical;font-family:ui-monospace,Menlo,Consolas,monospace}
#qbs-panel .row{display:flex;gap:8px;align-items:center}
#qbs-panel .row > *{flex:1}
#qbs-panel .pill{font-size:11px;padding:2px 7px;border-radius:999px;background:#2a2f3a;color:#9ca3af}
#qbs-panel .pill.ok{background:#103d2b;color:#86efac}
#qbs-panel .pill.bad{background:#3a1a1a;color:#fca5a5}
#qbs-panel footer{padding:10px 14px;border-top:1px solid #2a2f3a;display:flex;gap:8px;flex-wrap:wrap}
#qbs-panel button{background:#615ced;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;font:inherit}
#qbs-panel button.secondary{background:#2a2f3a;color:#e5e7eb}
#qbs-panel button:disabled{opacity:.5;cursor:not-allowed}
#qbs-log{background:#0f1115;border:1px solid #2a2f3a;border-radius:6px;padding:8px;
max-height:160px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;white-space:pre-wrap}
#qbs-progress{height:6px;background:#0f1115;border-radius:3px;overflow:hidden;margin-top:8px}
#qbs-progress > div{height:100%;width:0%;background:#615ced;transition:width .2s}
.qbs-radios{display:flex;gap:14px}
.qbs-radios label{margin:0;display:flex;align-items:center;gap:6px;color:#e5e7eb;font-size:12px}

#qbs-modal-bg{position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center}
#qbs-modal-bg.open{display:flex}
#qbs-modal{width:520px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;
background:#1b1f2a;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:10px;
box-shadow:0 18px 48px rgba(0,0,0,.5);font:13px/1.45 system-ui,sans-serif}
#qbs-modal header{padding:12px 16px;border-bottom:1px solid #2a2f3a;display:flex;align-items:center;gap:8px}
#qbs-modal header h3{margin:0;font-size:14px;flex:1}
#qbs-modal .body{padding:14px 16px;overflow:auto}
#qbs-modal footer{padding:10px 16px;border-top:1px solid #2a2f3a;display:flex;justify-content:flex-end;gap:8px}
#qbs-modal .profile-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #2a2f3a;border-radius:6px;margin-bottom:6px}
#qbs-modal .profile-row.current{border-color:#615ced;background:#1f1f3a}
#qbs-modal .profile-row .name{flex:1;font-weight:500}
#qbs-modal .profile-row .meta{font-size:11px;color:#9ca3af}
#qbs-modal .profile-row button{font-size:11px;padding:4px 8px}
#qbs-modal .new-profile{display:flex;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid #2a2f3a}
#qbs-modal .new-profile input{flex:1;background:#0f1115;color:#e5e7eb;border:1px solid #2a2f3a;border-radius:6px;padding:7px 9px;font:inherit}
#qbs-modal button{background:#615ced;color:#fff;border:0;border-radius:6px;padding:7px 12px;cursor:pointer;font:inherit}
#qbs-modal button.secondary{background:#2a2f3a;color:#e5e7eb}
#qbs-modal button.danger{background:#7f1d1d;color:#fecaca}
#qbs-modal .empty{padding:24px;text-align:center;color:#9ca3af}
`;

    function el(tag, attrs, children) {
        const e = document.createElement(tag);
        if (attrs) Object.entries(attrs).forEach(([k, v]) => {
            if (k === 'class') e.className = v;
            else if (k === 'style') e.style.cssText = v;
            else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
            else if (v !== false && v != null) e.setAttribute(k, v);
        });
        (children || []).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return e;
    }

    const STATE = { running: false, results: [], stop: false, debugSse: false, idleTimeoutSec: 60 };

    // Типы страниц — каждый имеет СВОЙ самостоятельный системный промпт.
    // Поле .defaultPrompt — фабричный дефолт.
    // Правка пользователя хранится в GM под `qbs.prefix.<type>`.
    // Личный «мой дефолт» (если сохранил) — под `qbs.prefixUserDefault.<type>`.
    const PAGE_TYPES = {
        info: {
            label: 'Инфо-статья',
            defaultPrompt: `Роль: SEO-копирайтер. Пишешь информационные статьи на основе анализа выдачи. Стиль, тон, объём и структура — из ТОП-10, не из шаблона.

ТИП: информационная статья / экспертный гайд. Прямой призыв «купить / заказать» запрещён.

ПОДХОД (выполняй ВСЕ шаги до плана):

1. АНАЛИЗ ТОП-10 через встроенный поиск.
   Извлеки:
   — Средний объём статей у конкурентов.
   — Типичные смысловые блоки (что есть у большинства).
   — Стиль и тон — формальный / разговорный / экспертный / эмпатичный (по фразеологии первых 2-3 статей).
   — Какие форматы преобладают у конкурентов: таблицы, списки, чек-листы, связный текст, цитаты, кейсы.
   — Дисклеймеры, если тема YMYL.

2. СЕМАНТИКА. Из ТОП-10 собери:
   — Ключевые слова (точные поисковые фразы из выдачи).
   — LSI (семантически связанные слова, синонимы, термины).
   — N-граммы (частотные 2-4-словные фразы, повторяющиеся у конкурентов).
   — Long-tail и People Also Ask (вопросы из «Похожие вопросы» Google).

3. ИНТЕНТ. Определи тип запроса: информационный / коммерческий / транзакционный / навигационный.

4. GAP-АНАЛИЗ. Найди что у конкурентов плохо или отсутствует:
   — Содержательно (вопросы PAA не раскрыты).
   — Форматно (нет таблицы / чек-листа / FAQ / кейса).
   — Свежесть (устаревшие данные, нормы, тренды).
   — Экспертно (общие слова без цифр и источников).
   Для каждого gap — короткий источник: «у <домен> только 1 абзац», «в ТОП-10 нет ни одной таблицы». Без выдумок.

5. ПЛАН. Распредели всё найденное по пунктам. Цель — закрыть тему на уровне или глубже конкурентов плюс gap-блоки.

Если тема в запросе неясна (1-2 слова, аббревиатура) — не переспрашивай. Возьми самую популярную интерпретацию по выдаче. В первой строке сводки укажи: «Тема интерпретирована как: <X>».

ФОРМАТ ПЛАНА (на «Составь план статьи на тему …»):

Первая строка — сводка:
> Анализ выдачи: ТОП-10 в среднем ~<число> слов. Доминирующий интент: <тип>. Главные блоки у конкурентов: <через запятую>.
> Найденные gaps:
> — Содержательные / Форматные / Fresh / Экспертные: <короткие списки или «—»>.

Затем нумерованный список — каждый пункт В ОДНУ СТРОКУ через разделитель « | » со ВСЕМИ полями:

N. Название | Ключи: <точные поисковые фразы из выдачи> | LSI: <семантически связанные слова> | N-граммы: <частотные 2-4-словные фразы из ТОП-10 для этого раздела> | LT/PAA: <long-tail и People Also Ask вопросы, которые раздел закрывает, через « / »; «—» если нет> | Формат: <см. список ниже> | H3: <смысловые микротемы через « • »; «—» только для разделов до 250 слов> | Интент: <тип>, <короткое уточнение> | Размер: <от>-<до> слов | Обоснование: <короткое>

ПРАВИЛА ПЛАНА:
— 5-9 пунктов. Первый — введение. Последний — заключение.
— Минимум 2 пункта помечены [GAP] (в начале названия, перед содержательной частью).
— Название — чистый человеческий заголовок без префиксов «Введение:», «FAQ:», «Заключение:», «CTA:».
— Все поля заполняй из того, что реально нашёл в выдаче. Не выдумывай. Если для пункта не нашлось чего-то — «—».
— FAQ-блок включай если в выдаче есть PAA или поисковые подсказки-вопросы. В его поле LT/PAA — реальные вопросы PAA, не закрытые в других разделах (4-6 штук). В поле Формат для FAQ — «вопрос+ответ».

ПОЛЕ «ФОРМАТ» (обязательное для каждого пункта, один основной формат):
— «связный текст» — раздел без списков и таблиц, прозой.
— «нумерованный список» — пронумерованные пункты 1./2./3. с краткими пояснениями под каждым.
— «чек-лист» — маркированный список ✓ или просто «—» с краткими пояснениями (для шагов, требований, документов).
— «таблица» — раздел строится вокруг сравнительной таблицы.
— «вопрос+ответ» — для FAQ. Каждый вопрос = H3-подзаголовок, ответ 2-3 предложения под ним.
— «H3-разбор» — для разделов с явно списочным содержимым, где каждый пункт требует развёрнутого описания (200+ слов на пункт). Тогда H3 = название каждого пункта.

КРИТИЧНОЕ ПРАВИЛО (срабатывает АВТОМАТИЧЕСКИ при выборе формата):
— Если в названии раздела есть число + категория («6 способов», «7 шагов», «5 этапов», «10 ошибок», «4 типа») — Формат ОБЯЗАТЕЛЬНО «нумерованный список», «чек-лист» или «H3-разбор». ЗАПРЕЩЕНО «связный текст» — иначе всё слипнется в простыню прозы.
— Если в названии «Чек-лист», «Список», «Перечень» — Формат «чек-лист» или «нумерованный список».
— Если в названии «Сравнение», «Сравнительная таблица», «Какой лучше» — Формат «таблица».
— Если в названии «FAQ», «Часто задаваемые вопросы», «Вопросы и ответы» — Формат «вопрос+ответ».

ПОЛЕ «H3»:
— Для разделов длиннее 250 слов H3-микротемы ОБЯЗАТЕЛЬНЫ — это требование сканабельности, не стиля.
— Микротема = смысловой блок, раскрывающийся 2+ абзацами. Обычно 2-4 микротемы на раздел.
— Для разделов с Форматом «нумерованный список» / «чек-лист» / «таблица» / «вопрос+ответ» — H3 «—» (структуру задаёт сам формат).
— «—» допустимо для коротких разделов до 250 слов.

ФОРМАТ РАЗДЕЛА (на «Распиши пункт N»):

— ПЕРВАЯ СТРОКА: «## <Название из плана>» (без [GAP], без префиксов). Без H2 раздел не валиден.
— Объём — из плана, ±10%.
— ОБЯЗАТЕЛЬНО соблюдай поле «Формат» из плана:
  • «нумерованный список» — реальный markdown-список 1./2./3. с пояснением под каждым пунктом, НЕ проза.
  • «чек-лист» — реальный список с «—» или «✓» в начале каждого пункта.
  • «таблица» — реальная markdown-таблица с заголовками и строками.
  • «вопрос+ответ» — каждый вопрос как «### <Вопрос>», ответ 2-3 предложения сразу под ним. Первое предложение ответа = прямой ответ без оговорок.
  • «H3-разбор» — каждый пункт как «### <Название пункта>» с развёрнутым описанием 150-300 слов.
  • «связный текст» — без таблиц и списков, только прозой.
— Если в поле H3 заданы микротемы — раздели раздел на «### Заголовок» (с заглавной), под каждым 2+ абзаца. Если под H3 укладывается только одно предложение — объедини с соседней или убери H3 совсем.
— Если «H3: —» и Формат «связный текст» — раздел монолитный.
— Все ключи и минимум 70% LSI и N-грамм этого пункта — органично в тексте.
— Все LT/PAA вопросы пункта закрой ответами в тексте (не списком вопросов — раскрой через утверждения).
— Тон — как у конкурентов из анализа.
— Конкретика с цифрами вместо «обычно», «многие», «часто». «3-5 рабочих дней», «по данным Банка России в 2024 году».
— Markdown-ссылки [текст](URL) на внешние источники. Если URL неизвестен — оставь обычным текстом, не выдумывай.

ВЫДЕЛЕНИЕ ЖИРНЫМ:
— Ключи, LSI и N-граммы НЕ выделяются жирным. Никогда.
— Жирным — только цифры (суммы/сроки/проценты), нормы законов, ключевые предупреждения.
— Не больше 1-2 жирных на абзац.

СТИЛИСТИЧЕСКИЕ ЗАПРЕТЫ:
— Англицизмы где есть русский аналог («journaling prompts» → «вопросы для дневника»).
— Клише: «в современном мире», «стоит отметить», «важно понимать», «не секрет», «давайте разберёмся», «в этой статье», «таким образом», «подводя итог».
— Не повторяй сказанное в предыдущих пунктах.

Первый пункт (введение): запрещено начинать с определения темы, «Вы когда-нибудь задумывались…», «Многие сталкиваются…». Начинай с факта / цифры / сцены / боли читателя.

Последний пункт (заключение): запрещены «Таким образом», «В заключение», «Подводя итог», «Итак», «Надеемся», «Действуйте сегодня», «Ваш следующий шаг». Завершай конкретным действием с указанием результата ИЛИ провокационным вопросом.

H1 И ЛИД (на «H1 и лид»):

ФОРМАТ ОТВЕТА строго такой:
# <Текст H1>

<Текст лида одним абзацем, 2-3 предложения>

— H1: 50-70 символов, главный ключ темы, без двоеточия, без конструкции «X: подзаголовок и подзаголовок».
— Лид: 2-3 предложения — боль → обещание исхода → крючок (опц.).
— Никакого текста до H1, между блоками или после лида.

Когда понял — ответь «Готов».`,
        },

        custom: {
            label: 'Свой промпт',
            defaultPrompt: '',
        },
    };

    function updateStatus() {
        const pill = document.getElementById('qbs-capture');
        if (!pill) return;
        if (CAPTURED.headers) { pill.textContent = 'Захвачено ✓'; pill.className = 'pill ok'; }
        else { pill.textContent = 'Не захвачено'; pill.className = 'pill bad'; }
    }

    function addCapturedModelToSelect(modelName) {
        if (!modelName) return;
        const sel = document.getElementById('qbs-model');
        if (!sel) return;
        let opt = Array.from(sel.options).find(o => o.value === modelName);
        if (!opt) {
            opt = document.createElement('option');
            opt.value = modelName;
            opt.textContent = modelName + ' (с сайта)';
            sel.appendChild(opt);
            log(`Захвачена модель: ${modelName}`);
        }
    }

    function log(msg) {
        const box = document.getElementById('qbs-log');
        if (!box) return;
        const t = new Date().toLocaleTimeString();
        box.textContent += `[${t}] ${msg}\n`;
        box.scrollTop = box.scrollHeight;
    }

    function setProgress(p) {
        const b = document.querySelector('#qbs-progress > div');
        if (b) b.style.width = `${Math.max(0, Math.min(100, p))}%`;
    }

    function mountUI() {
        if (document.getElementById('qbs-panel')) return;

        const style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);

        // Floating button
        const fab = el('div', { id: 'qbs-fab', title: 'Qwen Writer Mini by @seo_drift' }, ['Q']);
        fab.addEventListener('click', () => {
            document.getElementById('qbs-panel').classList.toggle('open');
        });
        document.body.appendChild(fab);

        // Saved state
        // === Промпты привязаны к типу страницы ===
        // Каждый тип имеет свой текущий промпт (`qbs.prefix.<type>`) и
        // опционально свой «мой дефолт» (`qbs.prefixUserDefault.<type>`).
        // Возврат к фабричному = PAGE_TYPES[<type>].defaultPrompt.

        // Миграция: старый общий ключ `qbs.prefix` → переносим в `qbs.prefix.<currentType>`
        const _legacyPrefix = GM_getValue('qbs.prefix', null);
        if (_legacyPrefix != null) {
            const _curType = GM_getValue('qbs.pageType', 'info');
            const _hasNew = GM_getValue('qbs.prefix.' + _curType, null);
            if (_hasNew == null) GM_setValue('qbs.prefix.' + _curType, _legacyPrefix);
            try { GM_deleteValue && GM_deleteValue('qbs.prefix'); } catch (_) {}
        }

        function getPromptForType(type) {
            const saved = GM_getValue('qbs.prefix.' + type, null);
            if (saved != null) return saved;
            const userDefault = GM_getValue('qbs.prefixUserDefault.' + type, null);
            if (userDefault != null) return userDefault;
            return (PAGE_TYPES[type] && PAGE_TYPES[type].defaultPrompt) || '';
        }

        const saved = {
            list:    GM_getValue('qbs.list',    'Составь план статьи на тему: «...». Аудитория: ...\n@expand_plan\nH1 и лид.'),
            model:   GM_getValue('qbs.model',   '__auto__'),
            include: GM_getValue('qbs.include', 'a'),
            format:  GM_getValue('qbs.format',  'html'),
            delay:   GM_getValue('qbs.delay',   1500),
            debug:   GM_getValue('qbs.debug',   false),
            htmlBare:GM_getValue('qbs.htmlBare', true),
            htmlSplit:GM_getValue('qbs.htmlSplit', true),
            size:    GM_getValue('qbs.size',    0),
            skipPrefixAnswer: GM_getValue('qbs.skipPrefixAnswer', true),
            skipPlan: GM_getValue('qbs.skipPlan', true),
            idleTimeout: GM_getValue('qbs.idleTimeout', 60),
            pageType: GM_getValue('qbs.pageType', 'info'),
        };
        saved.prefix = getPromptForType(saved.pageType);
        STATE.idleTimeoutSec = saved.idleTimeout;
        STATE.debugSse = !!saved.debug;

        // Проверка версии фабричных промптов. При каждом обновлении промпта в коде
        // FACTORY_PROMPTS_VERSION инкрементируется — пользователь получает напоминание.
        const FACTORY_PROMPTS_VERSION = '2026-05-15-mini-v1';
        const knownVersion = GM_getValue('qbs.factoryVersion', null);
        const newFactoryAvailable = knownVersion !== FACTORY_PROMPTS_VERSION;
        if (newFactoryAvailable) {
            GM_setValue('qbs.factoryVersion', FACTORY_PROMPTS_VERSION);
        }
        // отложим логирование до момента когда #qbs-log существует
        setTimeout(() => {
            if (newFactoryAvailable) {
                log(`ℹ Доступен обновлённый фабричный промпт. Чтобы загрузить — кнопка «🏭 К фабричному» под текстаркой системного промпта.`);
            }
        }, 100);

        const prefixTa = el('textarea', {
            id: 'qbs-prefix',
            placeholder: 'Системный промпт (роль, стиль, правила). Шлётся первым сообщением каждого блока. {size} = размер статьи.',
            style: 'min-height:120px',
        });
        prefixTa.value = saved.prefix;

        const sizeInp = el('input', { id: 'qbs-size', type: 'number', min: '0', step: '100' });
        sizeInp.value = saved.size;

        const pageTypeSel = el('select', { id: 'qbs-page-type' }, Object.entries(PAGE_TYPES).map(([k, v]) => {
            const o = el('option', { value: k }, [v.label]);
            if (k === saved.pageType) o.selected = true;
            return o;
        }));

        const skipPrefixChk = (() => {
            const l = el('label', { style: 'display:flex;align-items:center;gap:6px;margin-top:4px' }, []);
            const c = el('input', { id: 'qbs-skip-prefix-answer', type: 'checkbox' });
            if (saved.skipPrefixAnswer) c.checked = true;
            c.addEventListener('change', () => GM_setValue('qbs.skipPrefixAnswer', c.checked));
            l.appendChild(c);
            l.appendChild(document.createTextNode(' Не сохранять ответ на системный промпт в результат'));
            return l;
        })();

        const skipPlanChk = (() => {
            const l = el('label', { style: 'display:flex;align-items:center;gap:6px;margin-top:4px' }, []);
            const c = el('input', { id: 'qbs-skip-plan', type: 'checkbox' });
            if (saved.skipPlan) c.checked = true;
            c.addEventListener('change', () => GM_setValue('qbs.skipPlan', c.checked));
            l.appendChild(c);
            l.appendChild(document.createTextNode(' Не сохранять план в результат (служебный ответ)'));
            return l;
        })();

        const topicModeChk = (() => {
            const l = el('label', { style: 'display:flex;align-items:center;gap:6px;margin-top:6px' }, []);
            const c = el('input', { id: 'qbs-topic-mode', type: 'checkbox' });
            if (GM_getValue('qbs.topicMode', false)) c.checked = true;
            c.addEventListener('change', () => GM_setValue('qbs.topicMode', c.checked));
            l.appendChild(c);
            l.appendChild(document.createTextNode(' Список запросов = список тем (одна строка = одна статья; разделители --- не нужны)'));
            return l;
        })();

        const ta = el('textarea', { id: 'qbs-list', placeholder: 'Каждая строка — отдельный вопрос.\nСтрока из трёх дефисов "---" — следующий вопрос в новом чате.' });
        ta.value = saved.list;

        const modelOptions = [
            ['__auto__', 'Авто (как на сайте)'],
            // Семейство Qwen3.6 / 3.5 — точные API-id подхватятся из перехвата
            // эти опции просто заглушки, можешь переключить руками после захвата
        ];
        const modelSel = el('select', { id: 'qbs-model' }, modelOptions.map(([v, t]) => {
            const o = el('option', { value: v }, [t]);
            if (v === saved.model) o.selected = true;
            return o;
        }));

        const formatSel = el('select', { id: 'qbs-format' }, [
            ['md', 'Markdown (.md)'],
            ['csv', 'CSV (.csv)'],
            ['html', 'HTML (.html)'],
            ['clipboard', 'Скопировать в буфер'],
        ].map(([v, t]) => {
            const o = el('option', { value: v }, [t]);
            if (v === saved.format) o.selected = true;
            return o;
        }));

        const delayInp = el('input', { id: 'qbs-delay', type: 'number', min: '0', step: '100' });
        delayInp.value = saved.delay;

        const idleTimeoutInp = el('input', { id: 'qbs-idle-timeout', type: 'number', min: '10', step: '5' });
        idleTimeoutInp.value = saved.idleTimeout;

        const debugChk = (() => {
            const l = el('label', { style: 'display:flex;align-items:center;gap:6px;margin-top:6px' }, []);
            const c = el('input', { id: 'qbs-debug', type: 'checkbox' });
            if (saved.debug) c.checked = true;
            c.addEventListener('change', () => {
                STATE.debugSse = c.checked;
                GM_setValue('qbs.debug', c.checked);
            });
            l.appendChild(c);
            l.appendChild(document.createTextNode(' Отладочный лог (payload + SSE фреймы)'));
            return l;
        })();

        const htmlBareChk = (() => {
            const l = el('label', { style: 'display:flex;align-items:center;gap:6px;margin-top:4px' }, []);
            const c = el('input', { id: 'qbs-html-bare', type: 'checkbox' });
            if (saved.htmlBare) c.checked = true;
            c.addEventListener('change', () => GM_setValue('qbs.htmlBare', c.checked));
            l.appendChild(c);
            l.appendChild(document.createTextNode(' HTML без обёртки (чистая разметка для копи-пасты)'));
            return l;
        })();

        const htmlSplitChk = (() => {
            const l = el('label', { style: 'display:flex;align-items:center;gap:6px;margin-top:4px' }, []);
            const c = el('input', { id: 'qbs-html-split', type: 'checkbox' });
            if (saved.htmlSplit) c.checked = true;
            c.addEventListener('change', () => GM_setValue('qbs.htmlSplit', c.checked));
            l.appendChild(c);
            l.appendChild(document.createTextNode(' Каждый чат — отдельным файлом (готовая статья)'));
            return l;
        })();

        const radios = el('div', { class: 'qbs-radios' }, [
            (() => {
                const l = el('label', {}, []);
                const r = el('input', { type: 'radio', name: 'qbs-include', value: 'qa' });
                if (saved.include === 'qa') r.checked = true;
                l.appendChild(r); l.appendChild(document.createTextNode(' Вопрос + ответ'));
                return l;
            })(),
            (() => {
                const l = el('label', {}, []);
                const r = el('input', { type: 'radio', name: 'qbs-include', value: 'a' });
                if (saved.include === 'a') r.checked = true;
                l.appendChild(r); l.appendChild(document.createTextNode(' Только ответы'));
                return l;
            })(),
        ]);

        const captPill = el('span', { id: 'qbs-capture', class: 'pill bad' }, ['Не захвачено']);

        const startBtn  = el('button', { id: 'qbs-start' },  ['Старт']);
        const stopBtn   = el('button', { id: 'qbs-stop', class: 'secondary' }, ['Стоп']);
        const exportBtn = el('button', { id: 'qbs-export', class: 'secondary' }, ['Экспорт']);
        const diagBtn   = el('button', { id: 'qbs-diag', class: 'secondary' }, ['Диагностика']);
        const modelsBtn = el('button', { id: 'qbs-models', class: 'secondary' }, ['Список моделей']);
        const savePromptBtn    = el('button', { id: 'qbs-save-prompt',    class: 'secondary', style: 'font-size:11px;padding:4px 8px' }, ['💾 Сохранить промпт как мой дефолт']);
        const resetPromptBtn   = el('button', { id: 'qbs-reset-prompt',   class: 'secondary', style: 'font-size:11px;padding:4px 8px' }, ['↺ К моему дефолту']);
        const factoryPromptBtn = el('button', { id: 'qbs-factory-prompt', class: 'secondary', style: 'font-size:11px;padding:4px 8px' }, ['🏭 К фабричному']);
        const promptBtns = el('div', { style: 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap' }, [savePromptBtn, resetPromptBtn, factoryPromptBtn]);
        const saveAllBtn  = el('button', { id: 'qbs-save-all',  class: 'secondary' }, ['💾 Сохранить настройки']);
        const resetAllBtn = el('button', { id: 'qbs-reset-all', class: 'secondary' }, ['↺ Сбросить настройки']);
        const profilesBtn = el('button', { id: 'qbs-profiles', class: 'secondary' }, ['📁 Профили']);
        const clearBtn  = el('button', { id: 'qbs-clear', class: 'secondary' }, ['Очистить лог']);

        const progress = el('div', { id: 'qbs-progress' }, [el('div', {}, [])]);
        const logBox   = el('div', { id: 'qbs-log' }, []);

        const panel = el('div', { id: 'qbs-panel' }, [
            el('header', {}, [
                el('h3', {}, ['Qwen Writer Mini by @seo_drift']),
                captPill,
            ]),
            el('div', { class: 'body' }, [
                el('label', {}, ['Тип страницы']),
                pageTypeSel,
                el('label', {}, ['Системный промпт (для каждого блока)']),
                prefixTa,
                promptBtns,
                skipPrefixChk,
                skipPlanChk,
                el('label', {}, ['Список запросов']),
                ta,
                topicModeChk,
                el('div', { class: 'row' }, [
                    (() => { const w = el('div', {}, []); w.appendChild(el('label', {}, ['Модель'])); w.appendChild(modelSel); return w; })(),
                    (() => { const w = el('div', {}, []); w.appendChild(el('label', {}, ['Размер, слов'])); w.appendChild(sizeInp); return w; })(),
                    (() => { const w = el('div', {}, []); w.appendChild(el('label', {}, ['Задержка, мс'])); w.appendChild(delayInp); return w; })(),
                ]),
                el('div', { class: 'row' }, [
                    (() => { const w = el('div', {}, []); w.appendChild(el('label', {}, ['Прерывать если стрим молчит, сек'])); w.appendChild(idleTimeoutInp); return w; })(),
                ]),
                el('label', {}, ['Что сохранять']),
                radios,
                el('label', {}, ['Формат']),
                formatSel,
                htmlBareChk,
                htmlSplitChk,
                debugChk,
                progress,
                el('label', {}, ['Лог']),
                logBox,
            ]),
            el('footer', {}, [startBtn, stopBtn, exportBtn, diagBtn, modelsBtn, profilesBtn, saveAllBtn, resetAllBtn, clearBtn]),
        ]);
        document.body.appendChild(panel);

        // События
        startBtn.addEventListener('click', () => start());
        stopBtn.addEventListener('click', () => { STATE.stop = true; log('Остановка запрошена…'); });
        exportBtn.addEventListener('click', () => exportResults());
        diagBtn.addEventListener('click', () => showDiagnostics());
        modelsBtn.addEventListener('click', () => fetchModelsList());
        clearBtn.addEventListener('click', () => { logBox.textContent = ''; });

        // === Промпт: сохранить текущий как «мой дефолт» / сбросить ===
        savePromptBtn.addEventListener('click', () => {
            const type = pageTypeSel.value;
            GM_setValue('qbs.prefixUserDefault.' + type, prefixTa.value);
            log(`Промпт сохранён как мой дефолт для «${PAGE_TYPES[type].label}» (${prefixTa.value.length} симв.)`);
        });
        resetPromptBtn.addEventListener('click', () => {
            const type = pageTypeSel.value;
            // мой дефолт → фабричный (fallback)
            const userDefault = GM_getValue('qbs.prefixUserDefault.' + type, null);
            const target = (userDefault != null) ? userDefault : ((PAGE_TYPES[type] || {}).defaultPrompt || '');
            prefixTa.value = target;
            GM_setValue('qbs.prefix.' + type, target);
            log(`Промпт сброшен к ${userDefault != null ? 'моему дефолту' : 'фабричному'} для «${PAGE_TYPES[type].label}».`);
        });
        factoryPromptBtn.addEventListener('click', () => {
            const type = pageTypeSel.value;
            const target = (PAGE_TYPES[type] || {}).defaultPrompt || '';
            const hadUserDefault = GM_getValue('qbs.prefixUserDefault.' + type, null) != null;
            if (hadUserDefault) {
                if (!confirm(`У вас есть сохранённый «мой дефолт» для «${PAGE_TYPES[type].label}». Загрузить фабричный (мой дефолт сохранится, его можно будет вернуть через «↺ К моему дефолту»)?`)) return;
            }
            prefixTa.value = target;
            GM_setValue('qbs.prefix.' + type, target);
            log(`Промпт загружен с ФАБРИЧНОГО дефолта для «${PAGE_TYPES[type].label}» (${target.length} симв.).`);
        });

        // === Все настройки: сохранить пресет / сбросить ===
        const PRESET_FIELDS = [
            // [field name, getter, setter — read from UI / write to UI]
            ['model',    () => modelSel.value,     v => { if (Array.from(modelSel.options).some(o => o.value === v)) modelSel.value = v; }],
            ['format',   () => formatSel.value,    v => { formatSel.value = v; }],
            ['delay',    () => Number(delayInp.value)||0, v => { delayInp.value = v; }],
            ['size',     () => Number(sizeInp.value)||0,  v => { sizeInp.value = v; }],
            ['idleTimeout', () => Number(idleTimeoutInp.value)||60, v => { idleTimeoutInp.value = v; STATE.idleTimeoutSec = v; }],
            ['include',  () => (document.querySelector('input[name="qbs-include"]:checked')||{}).value || 'a',
                          v => { const r = document.querySelector(`input[name="qbs-include"][value="${v}"]`); if (r) r.checked = true; }],
            ['debug',    () => debugChk.querySelector('input').checked,
                          v => { debugChk.querySelector('input').checked = !!v; STATE.debugSse = !!v; }],
            ['htmlBare', () => htmlBareChk.querySelector('input').checked,
                          v => { htmlBareChk.querySelector('input').checked = !!v; }],
            ['htmlSplit',() => htmlSplitChk.querySelector('input').checked,
                          v => { htmlSplitChk.querySelector('input').checked = !!v; }],
            ['skipPrefixAnswer', () => skipPrefixChk.querySelector('input').checked,
                                  v => { skipPrefixChk.querySelector('input').checked = !!v; }],
            ['skipPlan', () => skipPlanChk.querySelector('input').checked,
                          v => { skipPlanChk.querySelector('input').checked = !!v; }],
            ['pageType', () => pageTypeSel.value,
                          v => { if (PAGE_TYPES[v]) { pageTypeSel.value = v; prefixTa.value = getPromptForType(v); } }],
        ];
        const FACTORY_DEFAULTS = {
            model: '__auto__', format: 'html', delay: 1500, size: 0, idleTimeout: 60,
            include: 'a', debug: false, htmlBare: true, htmlSplit: true,
            skipPrefixAnswer: true, skipPlan: true, pageType: 'info',
        };
        saveAllBtn.addEventListener('click', () => {
            PRESET_FIELDS.forEach(([k, get]) => GM_setValue('qbs.userDefault.' + k, get()));
            log(`Текущие настройки сохранены как мой дефолт (${PRESET_FIELDS.length} полей).`);
        });
        resetAllBtn.addEventListener('click', () => {
            let usedUser = false;
            PRESET_FIELDS.forEach(([k, , set]) => {
                const u = GM_getValue('qbs.userDefault.' + k, null);
                if (u != null) { set(u); GM_setValue('qbs.' + k, u); usedUser = true; }
                else { set(FACTORY_DEFAULTS[k]); GM_setValue('qbs.' + k, FACTORY_DEFAULTS[k]); }
            });
            log(`Настройки сброшены к ${usedUser ? 'моему дефолту' : 'фабричному'}.`);
        });

        // === ПРОФИЛИ ===
        // Снапшот: всё что определяет «как пишем» — тип, промпт, список, чекбоксы, форматы.
        function getCurrentSnapshot() {
            return {
                pageType: pageTypeSel.value,
                prefix:   prefixTa.value,
                list:     ta.value,
                topicMode:topicModeChk.querySelector('input').checked,
                size:     Number(sizeInp.value) || 0,
                delay:    Number(delayInp.value) || 0,
                idleTimeout: Number(idleTimeoutInp.value) || 60,
                format:   formatSel.value,
                model:    modelSel.value,
                include:  (document.querySelector('input[name="qbs-include"]:checked')||{}).value || 'a',
                htmlBare: htmlBareChk.querySelector('input').checked,
                htmlSplit:htmlSplitChk.querySelector('input').checked,
                skipPrefixAnswer: skipPrefixChk.querySelector('input').checked,
                skipPlan: skipPlanChk.querySelector('input').checked,
                debug:    debugChk.querySelector('input').checked,
            };
        }
        function applySnapshot(s) {
            if (s.pageType && PAGE_TYPES[s.pageType]) pageTypeSel.value = s.pageType;
            if (s.prefix != null)  prefixTa.value = s.prefix;
            if (s.list != null)    ta.value = s.list;
            if (s.topicMode != null) topicModeChk.querySelector('input').checked = !!s.topicMode;
            if (s.size != null)    sizeInp.value = s.size;
            if (s.delay != null)   delayInp.value = s.delay;
            if (s.idleTimeout != null) { idleTimeoutInp.value = s.idleTimeout; STATE.idleTimeoutSec = s.idleTimeout; }
            if (s.format)          formatSel.value = s.format;
            if (s.model && Array.from(modelSel.options).some(o => o.value === s.model)) modelSel.value = s.model;
            if (s.include) {
                const r = document.querySelector(`input[name="qbs-include"][value="${s.include}"]`);
                if (r) r.checked = true;
            }
            if (s.htmlBare != null)         htmlBareChk.querySelector('input').checked = !!s.htmlBare;
            if (s.htmlSplit != null)        htmlSplitChk.querySelector('input').checked = !!s.htmlSplit;
            if (s.skipPrefixAnswer != null) skipPrefixChk.querySelector('input').checked = !!s.skipPrefixAnswer;
            if (s.skipPlan != null)         skipPlanChk.querySelector('input').checked = !!s.skipPlan;
            if (s.debug != null)            { debugChk.querySelector('input').checked = !!s.debug; STATE.debugSse = !!s.debug; }
        }
        function getProfiles() { return GM_getValue('qbs.profiles', []) || []; }
        function setProfiles(arr) { GM_setValue('qbs.profiles', arr); }
        function getCurrentProfileName() { return GM_getValue('qbs.currentProfile', ''); }
        function setCurrentProfileName(n) { GM_setValue('qbs.currentProfile', n); }

        function buildModal() {
            const bg = el('div', { id: 'qbs-modal-bg' }, []);
            const modal = el('div', { id: 'qbs-modal' }, []);
            const list  = el('div', { id: 'qbs-modal-list' }, []);

            const nameInp = el('input', { type: 'text', placeholder: 'Имя нового профиля (например, «Казино-инфо»)' });
            const addBtn  = el('button', {}, ['+ Создать профиль из текущих настроек']);
            const newRow  = el('div', { class: 'new-profile' }, [nameInp, addBtn]);

            const closeBtn = el('button', { class: 'secondary' }, ['Закрыть']);

            modal.appendChild(el('header', {}, [el('h3', {}, ['Профили']), closeBtn]));
            modal.appendChild(el('div', { class: 'body' }, [list, newRow]));
            bg.appendChild(modal);
            document.body.appendChild(bg);

            function render() {
                list.innerHTML = '';
                const profiles = getProfiles();
                const cur = getCurrentProfileName();
                if (!profiles.length) {
                    list.appendChild(el('div', { class: 'empty' }, ['Пока нет сохранённых профилей.\nЗаполни настройки в основной панели и нажми «+ Создать профиль» ниже.']));
                    return;
                }
                profiles.forEach((p, idx) => {
                    const row = el('div', { class: 'profile-row' + (p.name === cur ? ' current' : '') }, []);
                    const nameWrap = el('div', { class: 'name' }, [p.name]);
                    const meta = el('span', { class: 'meta' }, [` (${(p.data && p.data.pageType) || '—'})`]);
                    nameWrap.appendChild(meta);
                    const applyBtn = el('button', {}, ['Применить']);
                    const saveBtn  = el('button', { class: 'secondary' }, ['Перезаписать']);
                    const renameBtn= el('button', { class: 'secondary' }, ['✎']);
                    const delBtn   = el('button', { class: 'danger' }, ['🗑']);

                    applyBtn.addEventListener('click', () => {
                        applySnapshot(p.data || {});
                        setCurrentProfileName(p.name);
                        log(`Применён профиль «${p.name}»`);
                        render();
                    });
                    saveBtn.addEventListener('click', () => {
                        const arr = getProfiles();
                        arr[idx] = { name: p.name, data: getCurrentSnapshot(), updatedAt: Date.now() };
                        setProfiles(arr);
                        setCurrentProfileName(p.name);
                        log(`Профиль «${p.name}» перезаписан текущими настройками.`);
                        render();
                    });
                    renameBtn.addEventListener('click', () => {
                        const newName = prompt('Новое имя профиля:', p.name);
                        if (!newName || newName.trim() === '' || newName === p.name) return;
                        const arr = getProfiles();
                        if (arr.some(x => x.name === newName)) { alert('Профиль с таким именем уже есть.'); return; }
                        arr[idx].name = newName;
                        setProfiles(arr);
                        if (cur === p.name) setCurrentProfileName(newName);
                        render();
                    });
                    delBtn.addEventListener('click', () => {
                        if (!confirm(`Удалить профиль «${p.name}»?`)) return;
                        const arr = getProfiles().filter((_, i) => i !== idx);
                        setProfiles(arr);
                        if (cur === p.name) setCurrentProfileName('');
                        log(`Профиль «${p.name}» удалён.`);
                        render();
                    });

                    row.appendChild(nameWrap);
                    row.appendChild(applyBtn);
                    row.appendChild(saveBtn);
                    row.appendChild(renameBtn);
                    row.appendChild(delBtn);
                    list.appendChild(row);
                });
            }

            addBtn.addEventListener('click', () => {
                const name = nameInp.value.trim();
                if (!name) { nameInp.focus(); return; }
                const arr = getProfiles();
                if (arr.some(x => x.name === name)) {
                    if (!confirm(`Профиль «${name}» уже есть. Перезаписать?`)) return;
                    const i = arr.findIndex(x => x.name === name);
                    arr[i] = { name, data: getCurrentSnapshot(), updatedAt: Date.now() };
                } else {
                    arr.push({ name, data: getCurrentSnapshot(), createdAt: Date.now() });
                }
                setProfiles(arr);
                setCurrentProfileName(name);
                nameInp.value = '';
                log(`Профиль «${name}» создан.`);
                render();
            });

            closeBtn.addEventListener('click', () => bg.classList.remove('open'));
            bg.addEventListener('click', e => { if (e.target === bg) bg.classList.remove('open'); });
            document.addEventListener('keydown', e => { if (e.key === 'Escape') bg.classList.remove('open'); });

            return { bg, render };
        }

        const modalCtx = buildModal();
        profilesBtn.addEventListener('click', () => {
            modalCtx.render();
            modalCtx.bg.classList.add('open');
        });

        // Авто-сохранение настроек
        ta.addEventListener('input',       () => GM_setValue('qbs.list',    ta.value));
        // Промпт сохраняется под текущим выбранным типом
        prefixTa.addEventListener('input', () => GM_setValue('qbs.prefix.' + pageTypeSel.value, prefixTa.value));
        sizeInp.addEventListener('input',  () => GM_setValue('qbs.size', Number(sizeInp.value) || 0));
        // При смене типа — подгружаем промпт нового типа в textarea
        pageTypeSel.addEventListener('change', () => {
            GM_setValue('qbs.pageType', pageTypeSel.value);
            prefixTa.value = getPromptForType(pageTypeSel.value);
            log(`Тип переключён на «${PAGE_TYPES[pageTypeSel.value].label}» — промпт загружен.`);
        });
        modelSel.addEventListener('change',() => {
            GM_setValue('qbs.model', modelSel.value);
            GM_setValue('qbs.modelUserSet', true);
        });
        formatSel.addEventListener('change',() => GM_setValue('qbs.format', formatSel.value));
        delayInp.addEventListener('input', () => GM_setValue('qbs.delay',   Number(delayInp.value) || 0));
        idleTimeoutInp.addEventListener('input', () => {
            const v = Number(idleTimeoutInp.value) || 60;
            GM_setValue('qbs.idleTimeout', v); STATE.idleTimeoutSec = v;
        });
        panel.addEventListener('change', e => {
            if (e.target.name === 'qbs-include') GM_setValue('qbs.include', e.target.value);
        });

        updateStatus();
    }

    function getUIState() {
        return {
            list:    document.getElementById('qbs-list').value,
            model:   document.getElementById('qbs-model').value,
            format:  document.getElementById('qbs-format').value,
            delay:   Number(document.getElementById('qbs-delay').value) || 0,
            include: (document.querySelector('input[name="qbs-include"]:checked') || {}).value || 'qa',
            prefix:  document.getElementById('qbs-prefix').value || '',
            size:    Number(document.getElementById('qbs-size').value) || 0,
            skipPrefixAnswer: !!(document.getElementById('qbs-skip-prefix-answer') || {}).checked,
            skipPlan:         !!(document.getElementById('qbs-skip-plan') || {}).checked,
            pageType: (document.getElementById('qbs-page-type') || {}).value || 'info',
            topicMode: !!(document.getElementById('qbs-topic-mode') || {}).checked,
        };
    }

    async function start() {
        if (STATE.running) return;
        const cfg = getUIState();

        // Режим тем: каждая непустая строка → отдельная статья.
        // Разделители вида --- / *** / === — игнорируем (часто пользователь оставляет их по привычке).
        let listText = cfg.list;
        if (cfg.topicMode) {
            const allLines  = listText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const isSepRe   = /^[-=*_~+]{3,}$/;
            const topics    = allLines.filter(l => !isSepRe.test(l));
            const skipped   = allLines.length - topics.length;
            if (!topics.length) { log('Список тем пуст.'); return; }
            listText = topics.map(t =>
                `Составь план статьи на тему: «${t}»\n@expand_plan\nH1 и лид.`
            ).join('\n---\n');
            const note = skipped > 0 ? ` (пропущено ${skipped} строк-разделителей)` : '';
            log(`Режим тем: развернул ${topics.length} тем в ${topics.length} блока команд${note}.`);
        }

        const blocks = parseList(listText);
        if (!blocks.length) { log('Список пуст.'); return; }

        // Sanity-check: ловим самую частую ошибку — пользователь вставил темы без команд
        // и не включил «Список запросов = список тем». Системный промпт «инфо-статьи» заставит
        // Qwen вернуть план; план будет пропущен (чекбокс skipPlan); итог — 0 результатов.
        if (!cfg.topicMode && cfg.skipPlan) {
            const hasExpandPlan = blocks.some(b => b.some(line => /^@expand_plan\b/i.test(line)));
            const hasSectionCmd = blocks.some(b => b.some(line => /^\s*(распиши|напиши|раскрой|разверни)\s+(пункт|раздел|блок|часть)/i.test(line)));
            const hasHeaderCmd  = blocks.some(b => b.some(line => /^\s*h1\s*(?:и|&|\+)?\s*лид/i.test(line) || /^\s*заголовок\s+и\s+лид/i.test(line)));
            if (!hasExpandPlan && !hasSectionCmd && !hasHeaderCmd) {
                log('⚠ В списке нет команд (@expand_plan / «Распиши пункт N» / «H1 и лид»).');
                log('   Системный промпт инструктирует Qwen вернуть план — он его пришлёт, но план будет');
                log('   пропущен (чекбокс «Не сохранять план»), и экспортировать будет нечего.');
                log('   Решения:');
                log('   1) Включи чекбокс «Список запросов = список тем» — каждая строка автоматически');
                log('      обернётся в «Составь план → @expand_plan → H1 и лид».');
                log('   2) Или впиши команды явно. Пример для одной темы:');
                log('        Составь план статьи на тему: «...». Аудитория: ...');
                log('        @expand_plan');
                log('        H1 и лид.');
                log('   Запуск отменён.');
                return;
            }
        }

        if (!CAPTURED.headers) {
            log('⚠ Сначала отправь любое сообщение через интерфейс Qwen — это нужно один раз, чтобы скрипт перехватил рабочие headers/токен.');
            return;
        }
        if (!CAPTURED.bodyTemplate && !CAPTURED.bodyTemplateSearch) {
            log('⚠ Шаблон запроса не захвачен. Отправь тестовое сообщение через интерфейс сайта и попробуй снова.');
            return;
        }
        if (!CAPTURED.bodyTemplateSearch) {
            log('ℹ Шаблон с поиском не захвачен. Чтобы использовать поиск для команды плана — включи «Поиск в сети» на сайте Qwen и отправь одно тестовое сообщение.');
        }

        // Авто-выбор модели: подставляем модель из перехвата
        if (cfg.model === '__auto__') {
            if (!CAPTURED.model) {
                log('⚠ Модель из сайта не захвачена. Отправь любое сообщение через интерфейс на нужной модели — её ID попадёт в селект.');
                return;
            }
            cfg.model = CAPTURED.model;
            log(`Используется модель из сайта: ${cfg.model}`);
        }

        STATE.running = true; STATE.stop = false; STATE.results = [];
        document.getElementById('qbs-start').disabled = true;
        setProgress(0);

        // Подготовим текст системного промпта с подставленным размером.
        // Промпт уже выбран под тип страницы (textarea переключается при смене типа в селекте).
        const prefixText = (cfg.prefix || '').trim()
            .replace(/\{size\}/g, String(cfg.size || ''))
            .replace(/\{words\}/g, String(cfg.size || ''));
        const pageTypeDef = PAGE_TYPES[cfg.pageType];
        if (pageTypeDef && prefixText.length > 0) {
            log(`Тип страницы: ${pageTypeDef.label} (${prefixText.length} симв. в системном промпте)`);
        }
        const hasPrefix = prefixText.length > 0;

        let done = 0;
        let totalEstimate = blocks.reduce((a, b) => a + b.length, 0) + (hasPrefix ? blocks.length : 0);
        // expand_plan меняет фактическое число шагов на лету — прогресс будет приблизительным

        const sendCmd = async (chatId, cmd, parentId, qi, qN, useSearch) => {
            log(`  → [${qi}/${qN}] ${cmd.slice(0, 80)}${cmd.length > 80 ? '…' : ''}${useSearch ? '  🔎' : ''}`);
            const { answer, assistantId } = await sendMessage(chatId, cfg.model, cmd, parentId, null, useSearch);
            const ctxNote = assistantId ? ` ↳ parent=${String(assistantId).slice(0, 8)}…` : '';
            log(`    ✓ ${answer.length} симв.${ctxNote}`);
            return { answer, assistantId };
        };

        for (let bi = 0; bi < blocks.length; bi++) {
            if (STATE.stop) break;
            const block = blocks[bi];
            log(`▶ Блок ${bi + 1}/${blocks.length} — создаю новый чат…`);
            let chatId;
            try { chatId = await createChat(cfg.model); }
            catch (e) { log('✖ ' + e.message); break; }
            log(`  chat_id: ${chatId}`);

            let parentId = null;
            let lastPlanAnswer = null;  // последний ответ, похожий на план — для @expand_plan

            // 0. Системный промпт (первое сообщение в новом чате)
            if (hasPrefix) {
                log(`  ⚙ Системный промпт (${prefixText.length} симв.)`);
                let prefixOk = false;
                try {
                    const { answer, assistantId } = await sendMessage(chatId, cfg.model, prefixText, parentId, null, false);
                    parentId = assistantId || parentId;
                    if (!cfg.skipPrefixAnswer) {
                        STATE.results.push({ q: prefixText, a: answer, chat: bi + 1, idx: 0 });
                    }
                    log(`    ✓ ${answer.length} симв.${cfg.skipPrefixAnswer ? ' [не сохранено]' : ''}`);
                    prefixOk = true;
                } catch (e) {
                    log('    ✖ системный промпт: ' + e.message);
                }
                done++;
                setProgress(done / totalEstimate * 100);
                if (!prefixOk) {
                    log(`  ⚠ Системный промпт не доставлен — пропускаю блок (без него остальные команды не имеют контекста).`);
                    continue; // переходим к следующему блоку
                }
                if (cfg.delay) await sleep(cfg.delay);
            }

            // 1..N. Реальные команды (с поддержкой @expand_plan)
            let resultIdx = 0;
            for (let qi = 0; qi < block.length; qi++) {
                if (STATE.stop) break;
                const raw = block[qi];

                // @expand_plan — раскрывает последний план в команды "Распиши пункт N"
                if (/^@expand_plan\b/i.test(raw)) {
                    const items = parsePlanItems(lastPlanAnswer);
                    if (!items.length) {
                        log(`  ⚠ @expand_plan: предыдущего плана не найдено или из него не извлеклись номера. Пропускаю.`);
                        continue;
                    }
                    log(`  ⤵ @expand_plan: разворачиваю ${items.length} пунктов`);
                    totalEstimate += items.length - 1;
                    for (const n of items) {
                        if (STATE.stop) break;
                        const cmd = buildExpandCommand(n, lastPlanAnswer);
                        try {
                            resultIdx++;
                            const { answer, assistantId } = await sendCmd(chatId, cmd, parentId, resultIdx, '?', false);
                            parentId = assistantId || parentId;
                            // Страховка: если Qwen не поставил H2 первой строкой — добавляем сами из плана
                            let finalAnswer = answer;
                            const planFields = parsePlanItemFields(lastPlanAnswer, n);
                            if (planFields && planFields.name) {
                                const firstLine = (finalAnswer.split(/\r?\n/).find(l => l.trim()) || '').trim();
                                if (!/^##\s+/.test(firstLine)) {
                                    finalAnswer = `## ${planFields.name}\n\n${finalAnswer}`;
                                    log(`    ↳ добавлен H2 «${planFields.name}» (Qwen его пропустил)`);
                                }
                            }
                            STATE.results.push({ q: cmd, a: finalAnswer, chat: bi + 1, idx: resultIdx });
                        } catch (e) {
                            log('    ✖ ' + e.message);
                            STATE.results.push({ q: cmd, a: `[ОШИБКА] ${e.message}`, chat: bi + 1, idx: resultIdx });
                        }
                        done++;
                        setProgress(done / totalEstimate * 100);
                        if (cfg.delay) await sleep(cfg.delay);
                    }
                    continue;
                }

                // Обычная команда — определяем, нужен ли поиск
                const useSearch = commandNeedsSearch(raw) && !!CAPTURED.bodyTemplateSearch;
                const isPlanCmd = commandNeedsSearch(raw);
                const isHeaderCmd = /^\s*h1\s*(?:и|&|\+)?\s*лид/i.test(raw) || /^\s*заголовок\s+и\s+лид/i.test(raw);
                try {
                    resultIdx++;
                    const { answer, assistantId } = await sendCmd(chatId, raw, parentId, resultIdx, block.length, useSearch);
                    parentId = assistantId || parentId;

                    // Защита от «битого плана»: если это был запрос плана, но в ответе нет нумерованного списка
                    // и ответ подозрительно короткий — Qwen переспросил тему. Прерываем блок, иначе всё ниже сломается.
                    const planItems = parsePlanItems(answer);
                    if (isPlanCmd && planItems.length < 3 && answer.length < 600) {
                        log(`    ⚠ Ответ не похож на план (${planItems.length} пунктов, ${answer.length} симв.). Видимо Qwen переспросил тему. Прерываю блок.`);
                        STATE.results.push({ q: raw, a: `[ПРОПУЩЕНО: Qwen не вернул план] ${answer}`, chat: bi + 1, idx: resultIdx });
                        break; // выход из цикла команд блока
                    }

                    // Запоминаем ответ как «план» для будущего @expand_plan
                    const looksLikePlan = isPlanCmd || planItems.length >= 3;
                    if (looksLikePlan) {
                        lastPlanAnswer = answer;
                    }

                    // Если пользователь не хочет сохранять план в результат — пропускаем эту запись
                    if (cfg.skipPlan && looksLikePlan) {
                        resultIdx--; // не считаем как результат
                        log(`    ↪ план не сохранён (опция «Не сохранять план в результат»)`);
                    } else {
                        STATE.results.push({ q: raw, a: answer, chat: bi + 1, idx: resultIdx, isHeader: isHeaderCmd });
                    }
                } catch (e) {
                    log('    ✖ ' + e.message);
                    STATE.results.push({ q: raw, a: `[ОШИБКА] ${e.message}`, chat: bi + 1, idx: resultIdx });
                }
                done++;
                setProgress(done / totalEstimate * 100);
                if (cfg.delay && (qi < block.length - 1 || bi < blocks.length - 1)) {
                    await sleep(cfg.delay);
                }
            }
        }

        STATE.running = false;
        document.getElementById('qbs-start').disabled = false;
        log(`Готово. Получено результатов: ${STATE.results.length}. Жми "Экспорт".`);
    }

    async function fetchModelsList() {
        log('Запрашиваю список моделей у Qwen…');
        const candidates = ['/api/models', '/api/v1/models', '/api/v2/models'];
        for (const path of candidates) {
            try {
                const r = await fetch(path, { headers: getAuthHeaders(), credentials: 'include' });
                if (!r.ok) { log(`  ${path} → HTTP ${r.status}`); continue; }
                const data = await r.json();
                const arr = data?.data || data?.models || (Array.isArray(data) ? data : null);
                if (!arr || !arr.length) { log(`  ${path} → пустой ответ`); continue; }
                log(`  ${path} → найдено моделей: ${arr.length}`);
                arr.forEach(m => {
                    const id = (typeof m === 'string') ? m : (m.id || m.name || m.model);
                    if (id) {
                        addCapturedModelToSelect(id);
                        log(`    + ${id}`);
                    }
                });
                return;
            } catch (e) { log(`  ${path} → ${e.message}`); }
        }
        log('Не удалось получить список моделей ни с одного известного эндпоинта.');
    }

    function showDiagnostics() {
        log('=== ДИАГНОСТИКА ===');
        log(`Захвачено headers: ${CAPTURED.headers ? Object.keys(CAPTURED.headers).length + ' шт.' : 'нет'}`);
        if (CAPTURED.headers) {
            const safe = Object.keys(CAPTURED.headers).map(k => {
                const v = CAPTURED.headers[k];
                const sv = typeof v === 'string' ? (v.length > 30 ? v.slice(0, 10) + '…' + v.slice(-6) : v) : '?';
                return `${k}: ${sv}`;
            }).join(', ');
            log(`  headers: ${safe}`);
        }
        log(`endpoint completions: ${CAPTURED.endpointCompletions || '(не захвачен)'}`);
        log(`endpoint new chat:   ${CAPTURED.endpointNewChat   || '(не захвачен)'}`);
        const showTpl = (label, tpl) => {
            if (!tpl) { log(`${label}: НЕТ`); return; }
            const keys = Object.keys(tpl);
            log(`${label}: ${keys.length} полей`);
            const dump = JSON.stringify(tpl);
            log(`  превью: ${dump.length > 240 ? dump.slice(0, 240) + '…' : dump}`);
        };
        showTpl('Шаблон без поиска', CAPTURED.bodyTemplate);
        showTpl('Шаблон С поиском ', CAPTURED.bodyTemplateSearch);
        log(`модель в шаблоне: ${CAPTURED.model || '(нет)'}`);
        log(`chat_type: ${CAPTURED.chatType}`);
        log(`--- последние ${TRAFFIC.length} POST-запросов: ---`);
        if (!TRAFFIC.length) {
            log('(пусто — сетевые запросы вообще не идут через перехват)');
        } else {
            TRAFFIC.slice(-15).forEach(r => {
                const flag = r.hasMessages ? ' [messages]' : '';
                log(`  ${r.method} ${r.url}${flag}`);
            });
        }
        log('===================');
    }

    function exportResults() {
        if (!STATE.results.length) { log('Нет результатов для экспорта.'); return; }
        const cfg = getUIState();
        const includeQ = cfg.include === 'qa';
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        if (cfg.format === 'csv') {
            download(`qwen-${ts}.csv`, '﻿' + toCSV(STATE.results, includeQ), 'text/csv');
        } else if (cfg.format === 'md') {
            download(`qwen-${ts}.md`, toMD(STATE.results, includeQ), 'text/markdown');
        } else if (cfg.format === 'html') {
            const bare  = !!(document.getElementById('qbs-html-bare')  || {}).checked;
            const split = !!(document.getElementById('qbs-html-split') || {}).checked;
            if (split) {
                const groups = groupByChat(STATE.results);
                log(`Сохраняю ${groups.length} статей отдельными файлами…`);
                groups.forEach((group, idx) => {
                    // Заголовок берём из первой строки первого ответа, если она похожа на заголовок
                    const first = group[0] && group[0].a ? group[0].a.split('\n').find(l => l.trim()) : '';
                    const title = (first || `article-${idx + 1}`).replace(/^#+\s*/, '').slice(0, 80);
                    const html = toSingleArticleHTML(group, includeQ, bare, title);
                    setTimeout(() => download(`qwen-${ts}-${idx + 1}.html`, html, 'text/html'), idx * 250);
                });
            } else {
                download(`qwen-${ts}.html`, toHTML(STATE.results, includeQ, bare), 'text/html');
            }
        } else if (cfg.format === 'clipboard') {
            const text = includeQ
                ? STATE.results.map(r => `Q: ${r.q}\nA: ${cleanForExport(r)}`).join('\n\n---\n\n')
                : STATE.results.map(r => cleanForExport(r)).join('\n\n---\n\n');
            GM_setClipboard(text);
            log('Скопировано в буфер.');
        }
    }

    // ============================================================
    // 5. Запуск
    // ============================================================
    function boot() {
        if (document.body) mountUI();
        else document.addEventListener('DOMContentLoaded', mountUI);
    }
    boot();
})();
