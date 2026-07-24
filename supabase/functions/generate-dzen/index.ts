// Generates a "Дзен" derivative format for a Content Ecosystem.
// Primary: anthropic/claude-haiku-4.5, fallback: anthropic/claude-opus-4.
// Saves markdown (content) + HTML (content_html) to public.ecosystem_formats.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { logCost, tokensToUsd } from "../_shared/costLogger.ts";

const PRIMARY_MODEL = "anthropic/claude-haiku-4.5";
const FALLBACK_MODEL = "anthropic/claude-opus-4";

interface ReqBody { ecosystem_id?: string; format_id?: string; ecosystem_format_id?: string }

interface DzenAnchor {
  id: string;
  text: string;
  text_variants: string[];
  target_url: string;
  priority: "high" | "medium" | "low";
  archived?: boolean;
}

function parseAnchors(raw: unknown): DzenAnchor[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      id: String((a as any).id || crypto.randomUUID()),
      text: String((a as any).text || "").trim(),
      text_variants: Array.isArray((a as any).text_variants)
        ? ((a as any).text_variants as unknown[])
            .map((v) => String(v || "").trim())
            .filter((v) => v.length > 0)
            .slice(0, 8)
        : [],
      target_url: String((a as any).target_url || "").trim(),
      priority: ((a as any).priority === "high" || (a as any).priority === "low"
        ? (a as any).priority
        : "medium") as DzenAnchor["priority"],
      archived: Boolean((a as any).archived),
    }))
    .filter((a) => a.text && /^https?:\/\//i.test(a.target_url) && !a.archived);
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await req.json()) as ReqBody;
    const formatId = body.format_id || body.ecosystem_format_id;
    if (!formatId) return json({ error: "format_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: fmt } = await admin
      .from("ecosystem_formats")
      .select("id, format_type, status, retry_count, ecosystem_id")
      .eq("id", formatId)
      .single();
    if (!fmt) return json({ error: "format not found" }, 404);
    if ((fmt as any).format_type !== "dzen") return json({ error: "format is not dzen" }, 400);
    if ((fmt as any).status === "generating") return json({ ok: true, note: "already generating" }, 202);

    const ecosystemId = body.ecosystem_id || (fmt as any).ecosystem_id;

    const { data: eco, error: ecoErr } = await admin
      .from("content_ecosystems")
      .select("id, user_id, source_article_id, client_id, articles(title,content,main_keyword,keywords), clients(id,name,description,brand_voice,expert_name,domain,anchors)")
      .eq("id", ecosystemId)
      .single();
    if (ecoErr || !eco) return json({ error: "ecosystem not found" }, 404);
    if ((eco as any).user_id !== userId) return json({ error: "forbidden" }, 403);

    await admin
      .from("ecosystem_formats")
      .update({
        status: "generating",
        progress: 10,
        error_reason: null,
        started_at: new Date().toISOString(),
      })
      .eq("id", (fmt as any).id);

    // analytics: started
    try {
      await admin.from("activation_events").insert({
        user_id: userId,
        event_name: "format_generation_started",
        session_id: "app",
        metadata: { format_type: "dzen", ecosystem_id: ecosystemId },
      });
    } catch (_) { /* ignore */ }

    // deno-lint-ignore no-explicit-any
    const runtime: any = (globalThis as any).EdgeRuntime;
    const task = generateInBackground(admin, {
      formatId: (fmt as any).id,
      ecosystemId,
      userId,
      retryCount: (fmt as any).retry_count ?? 0,
      article: (eco as any).articles,
      client: (eco as any).clients,
      anchors: parseAnchors((eco as any).clients?.anchors),
    });
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else task.catch((e) => console.error("[generate-dzen] bg", e));

    return json({ ok: true, format_id: (fmt as any).id }, 202);
  } catch (e) {
    console.error("[generate-dzen] top", e);
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface BgCtx {
  formatId: string;
  ecosystemId: string;
  userId: string;
  retryCount: number;
  article: { title?: string; content?: string; main_keyword?: string; keywords?: string[] } | null;
  client: {
    id?: string; name?: string; description?: string; brand_voice?: string;
    expert_name?: string; domain?: string;
  } | null;
  anchors: DzenAnchor[];
}

// deno-lint-ignore no-explicit-any
async function generateInBackground(admin: any, ctx: BgCtx) {
  const startedAt = Date.now();
  const setProgress = (progress: number, patch: Record<string, unknown> = {}) =>
    admin.from("ecosystem_formats").update({ progress, ...patch }).eq("id", ctx.formatId);

  try {
    const articleText = stripHtml(ctx.article?.content || "").slice(0, 14000);
    if (!articleText || articleText.length < 300) {
      throw new Error("Исходная статья пуста или слишком короткая");
    }
    await setProgress(30);

    const keyword = ctx.article?.main_keyword || (ctx.article?.keywords || [])[0] || ctx.article?.title || "";

    const { markdown, modelUsed, tokensIn, tokensOut } = await callDzenLlm({
      keyword,
      articleText,
      client: ctx.client,
      anchors: ctx.anchors,
      ecosystemId: ctx.ecosystemId,
    });

    await setProgress(80, { model_used: modelUsed, content: markdown });

    const html = markdownToHtml(markdown);

    try {
      const cost = tokensToUsd(modelUsed, tokensIn, tokensOut);
      await logCost(admin, {
        user_id: ctx.userId,
        operation_type: "llm_call",
        model: modelUsed,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        cost_usd: cost,
        metadata: { function: "generate-dzen", ecosystem_id: ctx.ecosystemId },
      });
    } catch (_) { /* ignore */ }

    await admin
      .from("ecosystem_formats")
      .update({
        status: "completed",
        progress: 100,
        content: markdown,
        content_html: html,
        model_used: modelUsed,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        error_reason: null,
      })
      .eq("id", ctx.formatId);

    // Recompute ecosystem completion
    const { data: sib } = await admin
      .from("ecosystem_formats")
      .select("format_type,status")
      .eq("ecosystem_id", ctx.ecosystemId);
    const completedTypes = (sib || [])
      .filter((r: any) => r.status === "completed" || r.status === "partial")
      .map((r: any) => r.format_type);
    await admin
      .from("content_ecosystems")
      .update({
        formats_completed: completedTypes,
        status: (sib || []).every((r: any) => r.status === "completed" || r.status === "partial")
          ? "completed"
          : "generating",
      })
      .eq("id", ctx.ecosystemId);

    try {
      await admin.from("activation_events").insert({
        user_id: ctx.userId,
        event_name: "format_generation_completed",
        session_id: "app",
        metadata: { format_type: "dzen", ecosystem_id: ctx.ecosystemId, model: modelUsed },
      });
    } catch (_) { /* ignore */ }
  } catch (err) {
    console.error("[generate-dzen] failed", err);
    await admin
      .from("ecosystem_formats")
      .update({
        status: "failed",
        error_reason: (err as Error).message?.slice(0, 500) || "unknown",
        retry_count: ctx.retryCount + 1,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", ctx.formatId);
    try {
      await admin.from("activation_events").insert({
        user_id: ctx.userId,
        event_name: "format_generation_failed",
        session_id: "app",
        metadata: { format_type: "dzen", ecosystem_id: ctx.ecosystemId, error: (err as Error).message },
      });
    } catch (_) { /* ignore */ }
  }
}

async function callDzenLlm(input: {
  keyword: string;
  articleText: string;
  client: BgCtx["client"];
  anchors: DzenAnchor[];
  ecosystemId: string;
}) {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: orKey } = await supabaseAdmin
    .from("api_keys").select("api_key")
    .eq("provider", "openrouter").eq("is_valid", true).single();
  const key = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OpenRouter API key not configured");

  const c = input.client || {};
  const anchors = input.anchors || [];

  const anchorsBlock = anchors.length > 0
    ? "Доступные якоря:\n" + anchors
        .map(a => {
          const forms = [a.text, ...(a.text_variants || [])]
            .filter(Boolean)
            .map(f => `"${f}"`)
            .join(" / ");
          return `- Формы: ${forms} → URL: ${a.target_url} (приоритет: ${a.priority})`;
        })
        .join("\n") + "\n\n" +
      "Правила:\n" +
      "- Ровно 1 ссылка, только в последнем абзаце.\n" +
      "- Используй ЛЮБУЮ из перечисленных форм якоря — выбирай ту, которая грамматически подходит под предложение.\n" +
      "- Не изменяй формы самостоятельно и не придумывай новые склонения — только заранее одобренные.\n" +
      "- Одна ссылка = одна форма якоря + соответствующий URL из той же строки.\n" +
      `- Формат: [Форма](URL?utm_source=dzen&utm_medium=ecosystem&utm_campaign=ecosystem_${input.ecosystemId}&utm_content=final_link)\n` +
      "- Если ни один якорь не подходит по смыслу — не вставляй ссылку вовсе."
    : "У клиента 0 якорей — заверши статью без ссылки, ничего не добавляй.";

  const system =
    "Ты копирайтер, адаптирующий экспертные статьи под площадку Яндекс.Дзен. Твоя задача — переписать статью в формате, оптимизированном для чтения в ленте Дзена.\n\n" +
    "## Контекст клиента\n" +
    `Бренд: ${c.name || "-"}\n` +
    (c.domain ? `Домен: https://${cleanDomain(c.domain)}\n` : "") +
    (c.description ? `Чем занимается: ${c.description}\n` : "") +
    (c.expert_name ? `Эксперт-автор: ${c.expert_name}\n` : "") +
    "\n## Тональность бренда\n" +
    (c.brand_voice || "Экспертно, дружелюбно, без канцелярита.") +
    "\n\n## Правила формата Яндекс.Дзен\n" +
    "Объём: 800-1500 слов.\n\n" +
    "Заголовок:\n" +
    "- До 66 символов.\n" +
    "- Цепляющий, эмоциональный, вызывает любопытство.\n" +
    "- Формат H1 в markdown (# Заголовок).\n\n" +
    "Первый абзац (крючок):\n" +
    "- 2-3 предложения.\n" +
    "- Личная история, вопрос читателю или неожиданный факт.\n" +
    "- НЕ начинай с «В этой статье», «Как известно», «Многие задаются вопросом», «Рассмотрим», «Разберём».\n\n" +
    "Структура:\n" +
    "- Короткие абзацы: 2-4 предложения максимум.\n" +
    "- Между абзацами пустая строка.\n" +
    "- Подзаголовки H2 (## Подзаголовок) через каждые 200-300 слов — минимум 3 штуки.\n" +
    "- Разговорный тон: обращения на «вы», риторические вопросы, живые примеры.\n\n" +
    "Стиль:\n" +
    "- Пиши как эксперт, который делится опытом с другом, а не как автор учебника.\n" +
    "- Используй метафоры и аналогии из повседневной жизни.\n" +
    "- Избегай канцелярита («вышеуказанный», «на основании», «в соответствии с»).\n" +
    "- Соблюдай тональность бренда — но с адаптацией под разговорный формат Дзена.\n\n" +
    "Что НЕ вставлять: списки с чекбоксами, таблицы, множественные ссылки в тексте, формальные заключения типа «Итак, подводя итоги», «В заключение хочется сказать», «Таким образом, мы видим».\n\n" +
    "## Ссылка на клиента\n" +
    "В самом конце статьи (последний абзац) вставь ровно одну ссылку из пула якорей клиента.\n\n" +
    anchorsBlock +
    "\n\n## Орфография\n" +
    "Строго проверяй орфографию и грамматику русского языка. Особенно внимательно с:\n" +
    "- Правильные окончания глаголов (едете, а не едите; поедете, а не поедите; уедете, а не уедите).\n" +
    "- Согласование по родам и числам.\n" +
    "- Правильные падежи в предлогах (о минитракторе, а не о минитрактор).\n" +
    "- Двойные согласные (класс, а не клас; сотрудник, а не сотрудник).\n" +
    "Перед выдачей ответа перечитай текст на предмет опечаток и исправь их.\n\n" +
    "## Фактическая точность\n" +
    "Не выдумывай конкретные названия моделей, брендов, продуктов или технических характеристик, которых нет в исходной статье. Если в исходной статье не упоминается конкретная модель — не приводи её в примере (например, если исходник не называл «Kubota B2601» или «Уралец 220», то и не выдумывай их).\n" +
    "Если хочется дать пример — используй обобщённые формулировки:\n" +
    "- «компакт стартового уровня» вместо конкретной модели.\n" +
    "- «универсал среднего класса с 4WD» вместо бренда.\n" +
    "- «фермерский класс 30-50 л.с.» вместо серии.\n" +
    "Допустимо упоминать конкретные модели ТОЛЬКО если они прямо указаны в исходной статье." +
    "\n\n## Формат ответа\n" +
    "Верни ТОЛЬКО markdown статьи, без объяснений, без обёрток «Вот статья:», без блоков кода. Начинай с H1.";

  const user =
    `Ключевой запрос: ${input.keyword}\n\n` +
    `Исходная экспертная статья:\n${input.articleText}\n\n` +
    "Перепиши в формате Яндекс.Дзен.";

  const attempt = async (model: string, systemPrompt: string) => {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "SEO-Module / generate-dzen",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: user },
        ],
        max_tokens: 4000,
        temperature: 0.7,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`OpenRouter ${model} ${r.status}: ${text.slice(0, 200)}`);
    }
    const j = await r.json();
    let content: string = j?.choices?.[0]?.message?.content || "";
    content = content.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
    return {
      markdown: content,
      modelUsed: model,
      tokensIn: j?.usage?.prompt_tokens || 0,
      tokensOut: j?.usage?.completion_tokens || 0,
    };
  };

  const runWithRetry = async (model: string) => {
    let out = await attempt(model, system);
    let issues = validateDzen(out.markdown, anchors, input.articleText);
    if (issues.length === 0) return out;
    console.warn("[generate-dzen] validation failed, retrying", { model, issues });
    const allowedFormsBlock = anchors.length > 0
      ? "\nРазрешённые формы якорей (используй ТОЛЬКО одну из них):\n" +
        anchors.map(a => {
          const forms = [a.text, ...(a.text_variants || [])].filter(Boolean).map(f => `"${f}"`).join(", ");
          return `- ${forms} → ${a.target_url}`;
        }).join("\n")
      : "";
    const reinforced = system +
      "\n\nПРЕДЫДУЩАЯ ПОПЫТКА НАРУШИЛА ПРАВИЛА:\n- " + issues.join("\n- ") +
      "\nИсправь ВСЕ нарушения и верни полностью новый вариант." +
      allowedFormsBlock;
    const retry = await attempt(model, reinforced);
    return {
      ...retry,
      tokensIn: (out.tokensIn || 0) + (retry.tokensIn || 0),
      tokensOut: (out.tokensOut || 0) + (retry.tokensOut || 0),
    };
  };

  try {
    return await runWithRetry(PRIMARY_MODEL);
  } catch (e) {
    console.warn("[generate-dzen] primary failed, falling back:", (e as Error).message);
    return await runWithRetry(FALLBACK_MODEL);
  }
}

function validateDzen(md: string, anchors: DzenAnchor[], articleText = ""): string[] {
  const issues: string[] = [];
  const trimmed = md.trim();

  // 1. H1
  const h1m = trimmed.match(/^#\s+(.+)$/m);
  if (!trimmed.startsWith("# ") || !h1m) {
    issues.push("Статья должна начинаться с H1 в формате `# Заголовок`.");
  } else if (h1m[1].trim().length > 66) {
    issues.push(`Заголовок H1 длиннее 66 символов (${h1m[1].trim().length}). Сократи.`);
  }

  // 2. length 800-1500 words
  const bodyText = trimmed.replace(/^#\s+.+$/m, "").replace(/[#*`_>\-\[\]()]/g, " ");
  const words = (bodyText.match(/\S+/g) || []).length;
  if (words < 800) issues.push(`Объём ${words} слов, нужно 800-1500. Расширь текст.`);
  if (words > 1500) issues.push(`Объём ${words} слов, максимум 1500. Сократи.`);

  // 3. avg paragraph length <=4 sentences
  const paragraphs = trimmed.split(/\n\s*\n/).filter(p => p.trim() && !/^#/.test(p.trim()));
  if (paragraphs.length) {
    const avg = paragraphs.reduce((s, p) => s + (p.match(/[.!?…]+/g) || []).length, 0) / paragraphs.length;
    if (avg > 4.5) issues.push(`Абзацы слишком длинные (в среднем ${avg.toFixed(1)} предложений). Максимум 2-4.`);
  }

  // 4. minimum 3 H2
  const h2count = (trimmed.match(/^##\s+/gm) || []).length;
  if (h2count < 3) issues.push(`Нужно минимум 3 подзаголовка H2, сейчас ${h2count}.`);

  // 5. forbidden phrases in first paragraph
  const firstParaMatch = trimmed.replace(/^#\s+.+$/m, "").trim().split(/\n\s*\n/)[0] || "";
  const forbiddenOpen = ["в этой статье", "как известно", "многие задаются вопросом", "рассмотрим", "разберём", "разберем"];
  const fpLow = firstParaMatch.toLowerCase();
  for (const f of forbiddenOpen) {
    if (fpLow.includes(f)) {
      issues.push(`Первый абзац содержит запрещённое клише «${f}». Замени на личную историю, вопрос или неожиданный факт.`);
      break;
    }
  }

  // 6. formal clichés anywhere
  const clicheList = ["итак, подводя итоги", "в заключение хочется сказать", "таким образом, мы видим"];
  const low = trimmed.toLowerCase();
  for (const cl of clicheList) {
    if (low.includes(cl)) { issues.push(`Убери формальное клише «${cl}».`); break; }
  }

  // 7. no task lists, no tables
  if (/^-\s*\[[\sx]\]/mi.test(trimmed)) issues.push("Убери чекбоксы (- [ ]) — Дзен их не поддерживает.");
  if (/^\s*\|.*\|\s*$/m.test(trimmed) && /\|\s*[-:]+\s*\|/.test(trimmed)) {
    issues.push("Убери таблицы — они плохо смотрятся в Дзене.");
  }

  // 8. links: 0 or 1, in last paragraph only
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const matches: { text: string; url: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(trimmed)) !== null) {
    matches.push({ text: m[1].trim(), url: m[2], index: m.index });
  }
  if (matches.length > 1) {
    issues.push(`В тексте ${matches.length} ссылок, максимум 1 (в самом конце).`);
  } else if (matches.length === 1) {
    const pos = matches[0].index / trimmed.length;
    if (pos < 0.8) issues.push("Единственная ссылка должна быть в последнем абзаце (позиция > 80% текста).");
    if (anchors.length > 0) {
      const allForms = new Set<string>();
      for (const a of anchors) {
        allForms.add(a.text);
        for (const v of a.text_variants || []) allForms.add(v);
      }
      const anchorBases = new Set(anchors.map(a => a.target_url.split("?")[0].toLowerCase()));
      if (!allForms.has(matches[0].text)) {
        issues.push(`Anchor text должен ТОЧНО совпадать с одной из разрешённых форм: ${[...allForms].map(t => `"${t}"`).join(", ")}.`);
      }
      const base = matches[0].url.split("?")[0].toLowerCase();
      if (!anchorBases.has(base)) {
        issues.push("URL ссылки не совпадает с ни одним target_url из пула якорей.");
      }
    }
  }

  // 9. no invented brands / models — words that look like model names but are absent from source
  if (articleText) {
    const brandIssues = checkNoInventedBrands(trimmed, articleText);
    for (const b of brandIssues) issues.push(b);
  }

  return issues;
}

/**
 * Detect brand / model names in the generated markdown that do not appear in
 * the source article. Focuses on high-signal patterns: latin brand-like words,
 * and model designations with digits (e.g. "Т-25", "Kubota B2601", "МТЗ-82").
 */
function checkNoInventedBrands(md: string, articleText: string): string[] {
  const src = articleText.toLowerCase();
  const found = new Set<string>();

  // Ignore text inside markdown link anchors — validated separately against the anchor pool.
  const stripped = md.replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, " ");

  // Pattern A: Capitalized word (Latin or Cyrillic) + optional space/hyphen + 2+ digits + optional letters
  const modelRe = /\b[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё]{1,}[\s-]?\d{2,}[A-Za-z]{0,3}\b/g;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(stripped)) !== null) {
    found.add(m[0]);
  }
  // Pattern B: Latin capitalized brand-like word (4+ letters)
  const brandRe = /\b[A-Z][a-z]{3,}\b/g;
  while ((m = brandRe.exec(stripped)) !== null) {
    found.add(m[0]);
  }

  const issues: string[] = [];
  for (const term of found) {
    if (!src.includes(term.toLowerCase())) {
      issues.push(`Модель/бренд «${term}» отсутствует в исходной статье — не выдумывай конкретные названия, используй обобщённые формулировки.`);
      if (issues.length >= 3) break;
    }
  }
  return issues;
}

function cleanDomain(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "").split("/")[0];
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_m, t, u) => `<a href="${u}" rel="noopener" target="_blank">${t}</a>`);
  // bold **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic *text*
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return out;
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    const h = t.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const lvl = Math.min(6, h[1].length);
      out.push(`<h${lvl}>${renderInline(h[2].trim())}</h${lvl}>`);
      i++; continue;
    }
    // paragraph — collect until blank line
    const buf: string[] = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s+/.test(lines[i].trim())) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}