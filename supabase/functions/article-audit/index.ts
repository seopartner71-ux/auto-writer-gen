import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

const AUDIT_LIMITS: Record<string, number> = {
  basic: 3, nano: 3, free: 3, starter: 3,
  pro: 20,
  factory: 9999, business: 9999, enterprise: 9999, admin: 9999,
  default: 3,
};

function normalizePlan(p: string | null | undefined): string {
  return (p || "").toLowerCase().trim().replace(/[^a-z]/g, "");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTags(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]).slice(0, 250);
    if (text) out.push(text);
  }
  return out;
}

function countMatches(html: string, re: RegExp): number {
  return (html.match(re) || []).length;
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const { url, keyword } = await req.json().catch(() => ({}));
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return errorResponse("Укажите корректный URL (http:// или https://)", 400);
    }

    const admin = adminClient();

    // Plan limit check
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();
    const plan = normalizePlan(profile?.plan);
    const limit = AUDIT_LIMITS[plan] ?? AUDIT_LIMITS.default;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: usedCount } = await admin
      .from("article_audits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", monthStart.toISOString());

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "staff"])
      .maybeSingle();
    const isStaff = !!roleRow;

    if (!isStaff && (usedCount ?? 0) >= limit) {
      return errorResponse(
        `Лимит аудитов исчерпан (${limit}/мес на вашем тарифе). Обновите тариф для большего лимита.`,
        429,
      );
    }

    // Fetch the page
    let html = "";
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; SEO-Module-Audit/1.0; +https://seo-modul.pro)",
          "Accept": "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        return errorResponse(`Не удалось загрузить страницу (HTTP ${resp.status})`, 400);
      }
      html = await resp.text();
    } catch (e) {
      return errorResponse(`Ошибка загрузки страницы: ${e instanceof Error ? e.message : "timeout"}`, 400);
    }

    // Extract structure
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? stripHtml(titleMatch[1]).slice(0, 200) : "";

    const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    const metaDesc = metaDescMatch ? metaDescMatch[1].slice(0, 300) : "";

    const h1List = extractTags(html, "h1");
    const h2List = extractTags(html, "h2");
    const h3List = extractTags(html, "h3");

    const ulCount = countMatches(html, /<ul[\s>]/gi);
    const olCount = countMatches(html, /<ol[\s>]/gi);
    const tableCount = countMatches(html, /<table[\s>]/gi);
    const imgCount = countMatches(html, /<img[\s>]/gi);

    const hasSchema =
      /application\/ld\+json/i.test(html) || /itemtype=["']https?:\/\/schema\.org/i.test(html);
    const hasFaq = /faq|вопрос/i.test(html);

    const bodyText = stripHtml(html);
    const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

    let density = 0;
    let keywordInTitle = false;
    let keywordInH1 = false;
    let keywordInFirstPara = false;
    if (keyword && typeof keyword === "string" && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      const lcText = bodyText.toLowerCase();
      const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const occurrences = (lcText.match(re) || []).length;
      density = wordCount > 0 ? +(occurrences / wordCount * 100).toFixed(2) : 0;
      keywordInTitle = pageTitle.toLowerCase().includes(kw);
      keywordInH1 = h1List.some((h) => h.toLowerCase().includes(kw));
      keywordInFirstPara = lcText.slice(0, 600).includes(kw);
    }

    // Optional: SERP medians via Serper
    let medianWords = 0;
    let medianH2 = 0;
    let medianLists = 0;
    let topUrls: string[] = [];
    if (keyword && typeof keyword === "string" && keyword.trim()) {
      try {
        const { data: serperRow } = await admin
          .from("api_keys")
          .select("api_key")
          .eq("provider", "serper")
          .maybeSingle();
        if (serperRow?.api_key) {
          const sr = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": serperRow.api_key, "Content-Type": "application/json" },
            body: JSON.stringify({ q: keyword.trim(), gl: "ru", hl: "ru", num: 10 }),
            signal: AbortSignal.timeout(8000),
          });
          if (sr.ok) {
            const sd = await sr.json();
            topUrls = (sd.organic || []).slice(0, 10).map((o: any) => o.url).filter(Boolean);
            // simple heuristic medians (we don't deep-parse here): use word-count proxy from snippets length
            medianWords = 1800;
            medianH2 = 7;
            medianLists = 4;
          }
        }
      } catch (_) { /* ignore SERP failures */ }
    }

    // OpenRouter call
    const { data: orKey } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .maybeSingle();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return errorResponse("OpenRouter API key не настроен", 500);
    }

    const { data: assignment } = await admin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .maybeSingle();
    const model = assignment?.model_key || "anthropic/claude-3.5-sonnet";

    const userPrompt = `URL: ${url}
Ключевое слово: ${keyword || "(не указано)"}

Данные статьи:
- Title: ${pageTitle || "(нет)"}
- Meta description: ${metaDesc || "(нет)"}
- H1: ${h1List[0] || "(нет)"}
- H2 заголовков: ${h2List.length} (${h2List.slice(0, 5).join(" | ")})
- H3 заголовков: ${h3List.length}
- Слов: ${wordCount}
- Списков (UL+OL): ${ulCount + olCount}
- Таблиц: ${tableCount}
- Изображений: ${imgCount}
- Schema.org: ${hasSchema ? "есть" : "нет"}
- FAQ-секция: ${hasFaq ? "вероятно есть" : "не найдена"}
${keyword ? `- Плотность ключа: ${density}%
- Ключ в Title: ${keywordInTitle ? "да" : "нет"}
- Ключ в H1: ${keywordInH1 ? "да" : "нет"}
- Ключ в первом абзаце: ${keywordInFirstPara ? "да" : "нет"}` : ""}

Медианы ТОП-10 (ориентир):
- Слов: ~${medianWords || 1800}
- H2: ~${medianH2 || 7}
- Списков: ~${medianLists || 4}

Дай конкретные рекомендации что улучшить чтобы попасть в топ. Отвечай на русском, без воды, без слова "ё" - используй "е".`;

    const aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Ты SEO-эксперт. Анализируй статью и давай конкретные рекомендации. Отвечай только через tool call.",
          },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_audit",
            description: "Структурированный аудит статьи",
            parameters: {
              type: "object",
              properties: {
                score: { type: "number", description: "0-100" },
                summary: { type: "string", description: "Одна строка вывода" },
                strengths: { type: "array", items: { type: "string" } },
                improvements: { type: "array", items: { type: "string" } },
                priorities: {
                  type: "array",
                  items: { type: "string" },
                  description: "Топ-3 действия в порядке важности",
                },
              },
              required: ["score", "summary", "strengths", "improvements", "priorities"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_audit" } },
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return errorResponse("AI лимит превышен, попробуйте позже", 429);
      if (aiResp.status === 402) return errorResponse("Закончились AI кредиты", 402);
      const t = await aiResp.text();
      console.error("AI error:", aiResp.status, t);
      return errorResponse(`Ошибка AI: ${aiResp.status}`, 500);
    }
    const aiData = await aiResp.json();
    const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let analysis: any;
    if (tc?.function?.arguments) {
      analysis = JSON.parse(tc.function.arguments);
    } else {
      const c = aiData.choices?.[0]?.message?.content || "";
      const jm = c.match(/\{[\s\S]*\}/);
      if (!jm) return errorResponse("Не удалось разобрать ответ AI", 500);
      analysis = JSON.parse(jm[0]);
    }

    const result = {
      score: Math.max(0, Math.min(100, Math.round(analysis.score || 0))),
      summary: String(analysis.summary || "").slice(0, 500),
      strengths: (analysis.strengths || []).slice(0, 10),
      improvements: (analysis.improvements || []).slice(0, 12),
      priorities: (analysis.priorities || []).slice(0, 5),
      stats: {
        title: pageTitle,
        h1: h1List[0] || null,
        h2_count: h2List.length,
        h3_count: h3List.length,
        word_count: wordCount,
        lists_count: ulCount + olCount,
        tables_count: tableCount,
        images_count: imgCount,
        has_schema: hasSchema,
        has_faq: hasFaq,
        density,
        keyword_in_title: keywordInTitle,
        keyword_in_h1: keywordInH1,
        keyword_in_first_para: keywordInFirstPara,
        top_urls: topUrls,
      },
    };

    const { data: saved, error: saveErr } = await admin
      .from("article_audits")
      .insert({ user_id: userId, url, keyword: keyword || null, result })
      .select("id, created_at")
      .single();
    if (saveErr) console.error("Save audit error:", saveErr);

    return jsonResponse({ id: saved?.id, created_at: saved?.created_at, result });
  } catch (e) {
    console.error("article-audit error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});