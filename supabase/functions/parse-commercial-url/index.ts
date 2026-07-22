// Parse a commercial landing page URL: fetch HTML, strip to text, ask an LLM
// to extract structured company/page data, return JSON for brief auto-fill.
// Auth: admin/staff only. Rate-limited. Free (no credit deduction).

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { fetchWithTimeout, withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface ReqBody {
  url: string;
  page_type?: string;
}

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^169\.254\./,
  /\.local$/i,
  /^metadata\./i,
];

function validateUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "string") return { ok: false, reason: "URL обязателен" };
  if (raw.length > 500) return { ok: false, reason: "URL слишком длинный (макс 500)" };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: "Некорректный URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Поддерживаются только http(s) URL" };
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOST_PATTERNS.some((r) => r.test(host))) {
    return { ok: false, reason: "Недопустимый URL (приватная сеть)" };
  }
  return { ok: true, url: u };
}

/** Strip HTML to clean text, preserving headings hierarchy. */
function htmlToCleanText(html: string): { text: string; titles: string[]; h1: string[]; h2: string[]; metaDesc: string } {
  // Remove DOCTYPE, comments, scripts/styles/nav/footer/header/aside/svg/noscript.
  let s = html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).trim() : "";

  const metaMatch = s.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || s.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const metaDesc = metaMatch ? metaMatch[1].trim().slice(0, 300) : "";

  const h1List = collectTags(s, "h1");
  const h2List = collectTags(s, "h2");

  // Preserve document order: walk block tags in the order they appear in the HTML.
  const ordered: string[] = [];
  const blockRe = /<(h1|h2|h3|h4|p|li|td|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = blockRe.exec(s)) !== null && count < 400) {
    const tag = m[1].toLowerCase();
    const txt = stripTags(m[2]);
    if (!txt || txt.length < 2 || txt.length > 800) continue;
    if (tag === "h1") ordered.push(`H1: ${txt}`);
    else if (tag === "h2") ordered.push(`H2: ${txt}`);
    else if (tag === "h3") ordered.push(`H3: ${txt}`);
    else if (tag === "h4") ordered.push(`H4: ${txt}`);
    else if (tag === "li") ordered.push(`- ${txt}`);
    else ordered.push(txt);
    count++;
  }

  const parts: string[] = [];
  if (title) parts.push(`TITLE: ${title}`);
  if (metaDesc) parts.push(`META: ${metaDesc}`);
  parts.push(...ordered);

  let text = parts.join("\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  if (text.length > 20000) text = text.slice(0, 20000) + "…";

  return { text, titles: [title].filter(Boolean), h1: h1List, h2: h2List, metaDesc };
}

function firstUsefulTitlePart(title: string): string | null {
  const part = title.split("|")[0]?.trim() || title.trim();
  return part && part.length > 1 ? part : null;
}

function companyFromTitle(title: string): string | null {
  const parts = title.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const candidate = parts[parts.length - 1];
  return candidate && candidate.length >= 3 && candidate.length <= 80 ? candidate : null;
}

function findPhone(text: string): string | null {
  const m = text.match(/(?:\+7|8)[\s(\-]*\d{3}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/);
  return m ? m[0].trim() : null;
}

function findCity(text: string): string | null {
  const cityMatch = text.match(/(?:г\.|город|в городе)\s*([А-ЯA-Z][А-Яа-яA-Za-z\- ]{2,40})/i);
  if (cityMatch?.[1]) return cityMatch[1].trim().replace(/[,.].*$/, "");
  const common = ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Нижний Новгород", "Челябинск", "Самара", "Омск", "Ростов-на-Дону"];
  return common.find((city) => text.includes(city)) || null;
}

function fallbackExtract(args: { url: URL; title: string; h1: string[]; h2: string[]; metaDesc: string; text: string }) {
  const mainTitle = args.h1[0] || firstUsefulTitlePart(args.title) || null;
  return stripYo({
    company_name: companyFromTitle(args.title),
    niche: mainTitle,
    city: findCity(args.text),
    keyword: mainTitle,
    utp: args.metaDesc || null,
    benefits: [],
    services: [],
    prices: null,
    guarantees: null,
    phone: findPhone(args.text),
    address: null,
    work_hours: null,
    existing_h2: args.h2.slice(0, 15),
    existing_blocks: args.h2.slice(0, 10),
    tone: null,
    meta_description: args.metaDesc || null,
    source_url: args.url.toString(),
    partial: true,
  });
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function collectTags(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const txt = stripTags(m[1]);
    if (txt && txt.length > 1 && txt.length < 600) out.push(txt);
    if (out.length > 60) break;
  }
  return out;
}

async function readTextWithLimit(response: Response, maxBytes: number, timeoutMs: number, label: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Пустой ответ: ${label}`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const started = Date.now();
  try {
    while (true) {
      const remaining = Math.max(1, timeoutMs - (Date.now() - started));
      const { done, value } = await withTimeout(reader.read(), remaining, `${label} body timeout`);
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(concatChunks(chunks, total));
}

function tryParseJson(text: string): any | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function stripYo(v: any): any {
  if (typeof v === "string") return v.replace(/ё/g, "е").replace(/Ё/g, "Е");
  if (Array.isArray(v)) return v.map(stripYo);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = stripYo(v[k]);
    return out;
  }
  return v;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdminOrStaff(auth);
    if (forbidden) return forbidden;
    const userId = auth.userId;

    let body: ReqBody;
    try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }

    const v = validateUrl(body?.url);
    if (!v.ok) return errorResponse(v.reason, 400);

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action: "parse_commercial_url",
      p_max_requests: 20,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте через минуту.", 429);

    // Fetch HTML with 10s timeout. Manual redirect cap via fetch default (max 20).
    let html = "";
    try {
      const upstream = await fetchWithTimeout(
        v.url.toString(), {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SEOModule/1.0; +https://seo-modul.pro)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5",
          },
          redirect: "follow",
          timeoutMs: 6_000,
        },
      );
      if (!upstream.ok) {
        return errorResponse(`Сайт недоступен (HTTP ${upstream.status})`, 502, { unreachable: true });
      }
      const ctype = upstream.headers.get("content-type") || "";
      if (!/text\/html|xhtml/i.test(ctype)) {
        return errorResponse("URL не возвращает HTML-страницу", 400);
      }
      html = await readTextWithLimit(upstream, 2_000_000, 6_000, "page fetch");
    } catch (e) {
      return errorResponse(`Сайт недоступен: ${e instanceof Error ? e.message : "fetch failed"}`, 502, { unreachable: true });
    }

    const { text, titles, h1, h2, metaDesc } = htmlToCleanText(html);
    if (!text || text.length < 80) {
      return errorResponse("Страница требует JavaScript - данные извлечь не удалось", 422, { js_only: true });
    }

    const fallback = fallbackExtract({ url: v.url, title: titles[0] || "", h1, h2, metaDesc, text });

    if (html.length > 250_000 || h2.length >= 8) {
      return jsonResponse(fallback);
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return jsonResponse(fallback);

    const system = `Ты извлекаешь структурированные данные из текста коммерческой страницы. Верни ТОЛЬКО валидный JSON без пояснений. БЕЗ буквы "е с двумя точками" (всегда заменяй на "е").

КРИТИЧЕСКИ ВАЖНО:
- НЕ выдумывай данные. Если поле не встречается в тексте буквально - ставь null или [].
- niche/keyword бери из H1/TITLE/META, а не угадывай по общей теме.
- company_name - только если явно указано (в шапке, футере, тексте). Домен и слоган не считаются названием.
- city - только если явно упомянут в тексте.
- phone/address/hours - только если буквально найдены в тексте.
- benefits/services - только реально перечисленные на странице, дословно (можно сократить).
- existing_h2 - точные H2, скопированные из текста (строки, начинающиеся с "H2:").
- Если сомневаешься - ставь null.

Извлеки следующие поля:
{
  "company_name": "название компании или null",
  "niche": "ниша или тип услуги/товара или null",
  "city": "город или регион или null",
  "keyword": "главный коммерческий запрос страницы или null",
  "utp": "уникальное торговое предложение или null",
  "benefits": ["преимущество 1", "..."],
  "services": ["услуга 1", "..."],
  "prices": "описание цен или null",
  "guarantees": "гарантии или null",
  "phone": "телефон или null",
  "address": "адрес или null",
  "work_hours": "режим работы или null",
  "existing_h2": ["H2 заголовок 1", "..."],
  "existing_blocks": ["краткое описание блока 1", "..."],
  "tone": "официальный | дружелюбный | экспертный | продающий",
  "meta_description": "мета-описание или null"
}

Ограничения:
- benefits: максимум 8 пунктов
- services: максимум 12 пунктов
- existing_h2: максимум 15 пунктов
- existing_blocks: максимум 10 пунктов`;

    const textForLlm = text.length > 12000 ? text.slice(0, 12000) : text;
    const userMsg = `Текст страницы (тип: ${body.page_type || "не указан"}):\n\n${textForLlm}`;

    let parsed: any = null;
    try {
      const r = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://seo-modul.pro",
            "X-Title": "SEO-Module URL Parser",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            max_tokens: 2000,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMsg },
            ],
          }),
          timeoutMs: 6_000,
        },
      );
      if (!r.ok) {
        parsed = fallback;
      } else {
        const raw = await withTimeout(r.text(), 2_000, "parser LLM body timeout");
        const j = JSON.parse(raw);
        try { logLLM({ functionName: "parse-commercial-url", model: ((j as any)?.model) as string, tokensIn: Number((j as any)?.usage?.prompt_tokens || 0), tokensOut: Number((j as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
        const txt = (j?.choices?.[0]?.message?.content || "").trim();
        parsed = tryParseJson(txt) || fallback;
      }
    } catch (e) {
      parsed = fallback;
    }

    if (!parsed) {
      return errorResponse("Не удалось распознать структуру страницы", 422, { unparseable: true });
    }

    // Normalize: defaults, dedupe with directly-parsed lists, strip ё.
    const out = stripYo({
      company_name: parsed.company_name || null,
      niche: parsed.niche || null,
      city: parsed.city || null,
      keyword: parsed.keyword || null,
      utp: parsed.utp || null,
      benefits: Array.isArray(parsed.benefits) ? parsed.benefits.slice(0, 8).map(String) : [],
      services: Array.isArray(parsed.services) ? parsed.services.slice(0, 12).map(String) : [],
      prices: parsed.prices || null,
      guarantees: parsed.guarantees || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
      work_hours: parsed.work_hours || null,
      existing_h2: Array.isArray(parsed.existing_h2) && parsed.existing_h2.length
        ? parsed.existing_h2.slice(0, 15).map(String)
        : h2.slice(0, 15),
      existing_blocks: Array.isArray(parsed.existing_blocks) ? parsed.existing_blocks.slice(0, 10).map(String) : [],
      tone: typeof parsed.tone === "string" ? parsed.tone : null,
      meta_description: parsed.meta_description || metaDesc || null,
      source_url: v.url.toString(),
    });

    return jsonResponse(out);
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}