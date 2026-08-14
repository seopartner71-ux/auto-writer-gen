// Persona Engine: анализ сайта -> Site DNA.
// Additive: новая функция, существующие не затрагиваются.

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson } from "../_shared/aiClient.ts";

const MODEL = "google/gemini-2.5-flash";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string, timeoutMs = 15_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SeoModulBot/1.0)" },
    });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

const SYSTEM = `Ты аналитик сайтов. По содержимому страниц ты извлекаешь структурированный профиль бизнеса (Site DNA).

КРИТИЧЕСКОЕ ПРАВИЛО ДОСТОВЕРНОСТИ:
- Если информация не найдена на страницах - ставь null (для строк) или пустой массив.
- Запрещено додумывать стаж, количество клиентов, награды, сертификаты, географию, цифры.
- Лучше null, чем правдоподобная выдумка.

Отвечай на русском языке (кроме терминов и названий брендов).`;

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const rawUrl = String(body?.url || "").trim();
    const force = Boolean(body?.force);
    if (!rawUrl) return jsonResponse({ error: "url required" }, 400);

    let url: URL;
    try {
      url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    } catch {
      return jsonResponse({ error: "Некорректный URL" }, 400);
    }

    const admin = adminClient();

    // Кэш: не анализируем сайт заново без явного запроса.
    const { data: cached } = await admin
      .from("site_dna")
      .select("*")
      .eq("user_id", auth.userId)
      .eq("url", url.origin)
      .maybeSingle();

    if (cached && !force && cached.analyzed_at) {
      return jsonResponse({ site_dna: cached, cached: true });
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return jsonResponse({ error: "AI не настроен" }, 500);

    // Собираем главную + пару типовых внутренних страниц.
    const candidates = [url.origin, `${url.origin}/about`, `${url.origin}/o-kompanii`, `${url.origin}/services`, `${url.origin}/uslugi`];
    const pages: string[] = [];
    for (const c of candidates) {
      const html = await fetchPage(c);
      if (!html) continue;
      const text = stripHtml(html);
      if (text.length > 200) pages.push(`### ${c}\n${text.slice(0, 6000)}`);
      if (pages.length >= 3) break;
    }

    if (!pages.length) {
      return jsonResponse({ error: "Не удалось загрузить содержимое сайта" }, 422);
    }

    const user = `Проанализируй сайт ${url.origin} и верни Site DNA в JSON со следующими ключами:
site_identity, business_type, brand_name, industry, sub_industries (массив), products (массив), services (массив),
categories (массив), audience, positioning, usp (массив), brand_voice, terminology (массив), expertise_areas (массив),
commercial_context, editorial_context, content_patterns (массив), important_entities (массив), trust_signals (массив),
restrictions (массив), competitors_context, language, market.

Для каждого текстового поля, которое не удалось подтвердить содержимым страниц, поставь null. Массивы оставляй пустыми, если данных нет.

Содержимое страниц:
${pages.join("\n\n")}`;

    const { data: dna } = await chatJson<Record<string, unknown>>({
      apiKey,
      model: MODEL,
      system: SYSTEM,
      user,
      temperature: 0.2,
      maxTokens: 3000,
      timeoutMs: 90_000,
      appTitle: "SEO-Modul site-dna-analyze",
      functionName: "site-dna-analyze",
      userId: auth.userId,
    });

    const payload = {
      user_id: auth.userId,
      url: url.origin,
      data: dna,
      analyzed_at: new Date().toISOString(),
    };

    let saved;
    if (cached) {
      const { data, error } = await admin.from("site_dna").update(payload).eq("id", cached.id).select().single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await admin.from("site_dna").insert(payload).select().single();
      if (error) throw error;
      saved = data;
    }

    return jsonResponse({ site_dna: saved, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[site-dna-analyze]", msg);
    return jsonResponse({ error: msg }, 500);
  }
});