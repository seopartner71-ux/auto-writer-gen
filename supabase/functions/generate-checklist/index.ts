// Generates a checklist format for a Content Ecosystem.
// Primary: anthropic/claude-haiku-4.5, fallback: anthropic/claude-opus-4.
// Uploads PDF to private bucket `ecosystem-formats` and signs a URL.
// Client fires-and-forgets; UI subscribes to public.ecosystem_formats via Realtime.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { logCost, tokensToUsd } from "../_shared/costLogger.ts";
import { buildChecklistPdf, uploadChecklistPdf } from "../_shared/checklistPdf.ts";
import { aiTranslateToPhotoQuery } from "../_shared/unsplash.ts";

const PRIMARY_MODEL = "anthropic/claude-haiku-4.5";
const FALLBACK_MODEL = "anthropic/claude-opus-4";

interface ReqBody { ecosystem_id: string; format_id: string }

interface ChecklistAnchor {
  id: string;
  text: string;
  text_variants: string[];
  target_url: string;
  priority: "high" | "medium" | "low";
  archived?: boolean;
}

function parseAnchors(raw: unknown): ChecklistAnchor[] {
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
        : "medium") as ChecklistAnchor["priority"],
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
    if (!body?.ecosystem_id || !body?.format_id) {
      return json({ error: "ecosystem_id and format_id required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: eco, error: ecoErr } = await admin
      .from("content_ecosystems")
      .select("id, user_id, source_article_id, client_id, articles(title,content,main_keyword,keywords,meta_description,lsi_keywords), clients(id,name,brand_color,expert_name,expert_bio,expert_photo_url,contact_email,contact_phone,domain,logo_url,anchors)")
      .eq("id", body.ecosystem_id)
      .single();
    if (ecoErr || !eco) return json({ error: "ecosystem not found" }, 404);
    if ((eco as any).user_id !== userId) return json({ error: "forbidden" }, 403);

    const { data: fmt } = await admin
      .from("ecosystem_formats")
      .select("id, format_type, status, retry_count")
      .eq("id", body.format_id)
      .eq("ecosystem_id", body.ecosystem_id)
      .single();
    if (!fmt) return json({ error: "format not found" }, 404);
    if ((fmt as any).format_type !== "checklist") return json({ error: "format is not checklist" }, 400);
    if ((fmt as any).status === "generating") return json({ ok: true, note: "already generating" }, 202);

    await admin
      .from("ecosystem_formats")
      .update({
        status: "generating",
        progress: 10,
        error_reason: null,
        started_at: new Date().toISOString(),
      })
      .eq("id", (fmt as any).id);

    // deno-lint-ignore no-explicit-any
    const runtime: any = (globalThis as any).EdgeRuntime;
    const task = generateInBackground(admin, {
      formatId: (fmt as any).id,
      ecosystemId: (eco as any).id,
      userId,
      retryCount: (fmt as any).retry_count ?? 0,
      article: (eco as any).articles,
      client: (eco as any).clients,
      anchors: parseAnchors((eco as any).clients?.anchors),
      clientId: (eco as any).clients?.id || null,
    });
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else task.catch((e) => console.error("[generate-checklist] bg", e));

    return json({ ok: true, format_id: (fmt as any).id }, 202);
  } catch (e) {
    console.error("[generate-checklist] top", e);
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
  article: {
    title?: string; content?: string; main_keyword?: string; keywords?: string[];
    meta_description?: string | null; lsi_keywords?: string[] | null;
  } | null;
  client: {
    name?: string; brand_color?: string; expert_name?: string; expert_bio?: string;
    expert_photo_url?: string; contact_email?: string; contact_phone?: string;
    domain?: string; logo_url?: string;
  } | null;
  anchors: ChecklistAnchor[];
  clientId: string | null;
}

// deno-lint-ignore no-explicit-any
async function generateInBackground(admin: any, ctx: BgCtx) {
  const startedAt = Date.now();
  const setProgress = (progress: number, patch: Record<string, unknown> = {}) =>
    admin.from("ecosystem_formats").update({ progress, ...patch }).eq("id", ctx.formatId);

  try {
    const title = (ctx.article?.title || "Материал").slice(0, 200);
    const articleText = stripHtml(ctx.article?.content || "").slice(0, 12000);
    if (!articleText || articleText.length < 300) {
      throw new Error("Исходная статья пуста или слишком короткая");
    }

    await setProgress(25);
    console.log("[CHECKLIST-GEN] Model call started", { formatId: ctx.formatId, model: PRIMARY_MODEL });
    const llmStart = Date.now();
    const { markdown, modelUsed, tokensIn, tokensOut } = await callChecklistLlm({
      title,
      articleText,
      clientName: ctx.client?.name || null,
      clientDomain: cleanDomain(ctx.client?.domain),
      ecosystemId: ctx.ecosystemId,
      anchors: ctx.anchors,
    });
    console.log("[CHECKLIST-GEN] Model returned", {
      formatId: ctx.formatId,
      modelUsed,
      ms: Date.now() - llmStart,
      mdLen: markdown.length,
      tokensIn,
      tokensOut,
    });
    const checks = {
      has_title: /^\s*#\s+/m.test(markdown),
      has_checkboxes: (markdown.match(/^-\s*\[\s?\]/gm) || []).length >= 8,
      has_final_block: /^##\s+Что важно помнить\s*$/m.test(markdown),
      context_links: countContextLinks(markdown, cleanDomain(ctx.client?.domain), ctx.anchors),
    };
    console.log("[CHECKLIST-GEN] Post-checks", { formatId: ctx.formatId, ...checks });

    await setProgress(50, { model_used: modelUsed, content: markdown });

    // Analytics — which anchors did the model actually use?
    try {
      const used = new Set<string>();
      const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(markdown)) !== null) {
        const anchorText = m[1].trim();
        const anchor = ctx.anchors.find(a =>
          a.text === anchorText || (a.text_variants || []).includes(anchorText)
        );
        if (anchor) used.add(anchor.id);
      }
      for (const id of used) {
        await admin.from("activation_events").insert({
          user_id: ctx.userId,
          event_name: "anchor_used_in_generation",
          session_id: "app",
          metadata: {
            client_id: ctx.clientId,
            anchor_id: id,
            format_type: "checklist",
            ecosystem_id: ctx.ecosystemId,
          },
        }).then(() => {}, () => {});
      }
    } catch (_) { /* ignore */ }

    // Fetch Unsplash images (best-effort). Never blocks PDF.
    const imageUrls = await fetchChecklistPhotos(admin, {
      userId: ctx.userId,
      ecosystemId: ctx.ecosystemId,
      query: ctx.article?.main_keyword || (ctx.article?.keywords || [])[0] || title,
    });
    if (imageUrls.length > 0) {
      await admin.from("ecosystem_formats").update({ image_urls: imageUrls }).eq("id", ctx.formatId);
    }
    await setProgress(65);

    let pdfUrl: string | null = null;
    let pdfPath: string | null = null;
    let pdfError: string | null = null;
    try {
      console.log("[CHECKLIST-PDF] PDF generation started", { formatId: ctx.formatId });
      const pdfStart = Date.now();
      const pdfBytes = await buildChecklistPdf({
        title,
        markdown,
        ecosystemId: ctx.ecosystemId,
        client: ctx.client,
        imageUrls,
        article: {
          title: ctx.article?.title || null,
          meta_description: (ctx.article as any)?.meta_description || null,
          lsi_keywords: (ctx.article as any)?.lsi_keywords || null,
          main_keyword: ctx.article?.main_keyword || null,
        },
      });
      console.log("[CHECKLIST-PDF] PDF rendered", { formatId: ctx.formatId, ms: Date.now() - pdfStart, bytes: pdfBytes.byteLength });
      const targetPath = `${ctx.userId}/${ctx.ecosystemId}/checklist/${Date.now()}.pdf`;
      await setProgress(80);
      console.log("[CHECKLIST-PDF] Storage upload started", { formatId: ctx.formatId, path: targetPath });
      const uploaded = await uploadChecklistPdf(admin, targetPath, pdfBytes);
      pdfPath = uploaded.path;
      pdfUrl = uploaded.signedUrl;
      console.log("[CHECKLIST-PDF] Storage upload completed", { formatId: ctx.formatId, path: pdfPath, signed: !!pdfUrl });
      if (!pdfUrl) {
        throw new Error("Не удалось получить подписанную ссылку на PDF");
      }
    } catch (pdfErr) {
      pdfError = (pdfErr as Error).message?.slice(0, 500) || "unknown PDF error";
      pdfUrl = null;
      pdfPath = null;
      console.error("[CHECKLIST-PDF] PDF generation failed", { formatId: ctx.formatId, error: pdfError });
    }

    try {
      const cost = tokensToUsd(modelUsed, tokensIn, tokensOut);
      await logCost(admin, {
        user_id: ctx.userId,
        operation_type: "llm_call",
        model: modelUsed,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        cost_usd: cost,
        metadata: { function: "generate-checklist", ecosystem_id: ctx.ecosystemId },
      });
    } catch (_) { /* ignore */ }

    await admin
      .from("ecosystem_formats")
      .update({
        status: pdfUrl ? "completed" : "partial",
        progress: 100,
        content: markdown,
        model_used: modelUsed,
        pdf_url: pdfUrl,
        pdf_path: pdfPath,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        error_reason: pdfUrl ? null : `PDF generation failed: ${pdfError || "unknown"}`,
      })
      .eq("id", ctx.formatId);

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
  } catch (err) {
    console.error("[generate-checklist] failed", err);
    await admin
      .from("ecosystem_formats")
      .update({
        status: "failed",
        error_reason: (err as Error).message?.slice(0, 500) || "unknown",
        retry_count: ctx.retryCount + 1,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", ctx.formatId);
  }
}

async function callChecklistLlm(input: {
  title: string;
  articleText: string;
  clientName: string | null;
  clientDomain: string;
  ecosystemId: string;
  anchors: ChecklistAnchor[];
}) {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: orKey } = await supabaseAdmin
    .from("api_keys")
    .select("api_key")
    .eq("provider", "openrouter")
    .eq("is_valid", true)
    .single();
  const key = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OpenRouter API key not configured");

  const domain = input.clientDomain;
  const anchors = input.anchors || [];
  const contextLinksBlock = anchors.length > 0
    ? buildAnchorsPromptBlock(anchors, input.ecosystemId)
    : "";
  const spellingBlock =
    "\n\n## Орфография\n" +
    "Строго проверяй орфографию и грамматику русского языка. Особенно внимательно с:\n" +
    "- Правильные окончания глаголов (едете, а не едите; поедете, а не поедите).\n" +
    "- Согласование по родам и числам.\n" +
    "- Правильные падежи в предлогах (о минитракторе, а не о минитрактор).\n" +
    "- Двойные согласные (класс, а не клас).\n" +
    "Перед выдачей ответа перечитай текст на предмет опечаток и исправь их.";

  const baseSystem =
    "Ты редактор-методолог. Из исходной статьи собираешь премиум-чек-лист на 600-900 слов. " +
    "Верни СТРОГО Markdown в такой структуре и без отклонений:\n" +
    "1. Первая строка — заголовок вида `# Чек-лист: [тема]` (обязательно с префиксом «Чек-лист: »).\n" +
    "2. Вводный абзац 3-5 предложений (без списков, без заголовков).\n" +
    "3. 10-14 пунктов подряд, каждый строго в формате:\n" +
    "   `- [ ] Название пункта — краткое описание с обоснованием (2-4 предложения, объясни почему важно и на что смотреть).`\n" +
    "   Тире между названием и описанием — короткое `-` с пробелами вокруг, никаких длинных тире.\n" +
    "4. Финальный блок ОБЯЗАТЕЛЬНО начинается со строки `## Что важно помнить` (ровно так, без вариаций). Далее 2-3 напоминания списком `- ` или короткими абзацами.\n" +
    "Запрещено: эмодзи, длинное тире `—`, буква «ё» (используй «е»), любые H2 кроме `## Что важно помнить`, любые другие финальные заголовки (`Резюме`, `Итог`, `Как пользоваться`, `Совет` и т.п.).\n" +
    "Пиши на русском, если исходник на русском." +
    contextLinksBlock +
    spellingBlock;
  const user =
    `Название материала: ${input.title}\n` +
    (input.clientName ? `Бренд/клиент: ${input.clientName}\n` : "") +
    `\nИсходный материал:\n${input.articleText}\n\n` +
    "Собери чек-лист по описанному формату.";

  const attempt = async (model: string, systemPrompt: string) => {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "SEO-Module / generate-checklist",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: user },
        ],
        max_tokens: 3200,
        temperature: 0.4,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`OpenRouter ${model} ${r.status}: ${text.slice(0, 200)}`);
    }
    const j = await r.json();
    const content: string = j?.choices?.[0]?.message?.content || "";
    return {
      markdown: content.trim(),
      modelUsed: model,
      tokensIn: j?.usage?.prompt_tokens || 0,
      tokensOut: j?.usage?.completion_tokens || 0,
    };
  };

  const isValidFinal = (md: string) => /^##\s+Что важно помнить\s*$/m.test(md);
  const hasEnoughItems = (md: string) => (md.match(/^-\s*\[\s?\]/gm) || []).length >= 8;
  const contextLinksOk = (md: string) => {
    const info = countContextLinks(md, domain, anchors);
    return info.ok;
  };

  const runWithRetry = async (model: string) => {
    let out = await attempt(model, baseSystem);
    if (out.markdown.length < 400) throw new Error(`${model} output too short`);
    const finalOk = isValidFinal(out.markdown);
    const itemsOk = hasEnoughItems(out.markdown);
    const linksOk = contextLinksOk(out.markdown);
    if (finalOk && itemsOk && linksOk) return out;
    console.warn("[generate-checklist] validation failed, retrying", {
      model, finalOk, itemsOk, linksOk, mdLen: out.markdown.length,
    });
    const anchorReinforce = anchors.length > 0
      ? ` Предыдущая попытка использовала anchor text, которого нет в пуле. Используй ТОЛЬКО одну из разрешённых форм якорей: ${anchors.map(a => {
          const forms = [a.text, ...(a.text_variants || [])].filter(Boolean).map(f => `"${f}"`).join(" / ");
          return forms;
        }).join(", ")}. Каждая ссылка - ровно одна из этих форм как anchor text, URL берётся из соответствующего поля. 0, 1 или 2 ссылки, каждая с уникальным utm_content (text_link_1, text_link_2), не в финальном блоке.`
      : "";
    const reinforced = baseSystem +
      "\n\nПРЕДЫДУЩАЯ ПОПЫТКА НАРУШИЛА ФОРМАТ. Строго используй заголовок `## Что важно помнить` для финального блока (не «Как пользоваться», не «Резюме», не «Итог»). Обязательно 10-14 пунктов в формате `- [ ] Название - описание`." +
      (linksOk ? "" : anchorReinforce);
    const retry = await attempt(model, reinforced);
    // Combine token usage from both attempts so cost logging stays truthful.
    return {
      ...retry,
      tokensIn: (out.tokensIn || 0) + (retry.tokensIn || 0),
      tokensOut: (out.tokensOut || 0) + (retry.tokensOut || 0),
    };
  };

  try {
    return await runWithRetry(PRIMARY_MODEL);
  } catch (e) {
    console.warn("[generate-checklist] primary failed, falling back:", (e as Error).message);
    return await runWithRetry(FALLBACK_MODEL);
  }
}

function cleanDomain(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "").split("/")[0];
}

function stripUtm(url: string): string {
  return url.split("?")[0].split("#")[0];
}

function buildAnchorsPromptBlock(anchors: ChecklistAnchor[], ecosystemId: string): string {
  const list = anchors
    .map(a => {
      const forms = [a.text, ...(a.text_variants || [])]
        .filter(Boolean)
        .map(f => `"${f}"`)
        .join(" / ");
      return `- Формы: ${forms} → URL: ${a.target_url} (приоритет: ${a.priority})`;
    })
    .join("\n");
  return "\n\n## Контекстные ссылки на сайт клиента\n" +
    "У клиента есть пул SEO-якорей — заранее одобренных фраз, которые нужно вставлять в текст как ссылки. Твоя задача — выбрать из пула 1-2 наиболее подходящих под тему статьи и естественно вставить их в описания разных пунктов.\n\n" +
    "Доступные якоря:\n" + list + "\n\n" +
    "Правила:\n" +
    "- Используй ЛЮБУЮ из указанных форм якоря — выбирай ту, которая грамматически подходит под конкретное предложение.\n" +
    "- Не изменяй формы самостоятельно, используй только заранее одобренные.\n" +
    "- Одна ссылка = одна форма якоря + соответствующий URL из той же строки.\n" +
    "- Anchor text должен естественно вписываться в предложение. Если фраза звучит неестественно — не вставляй, выбери другой пункт или другой якорь.\n" +
    "- Приоритет high — предпочитай эти якоря при равнозначном контексте.\n" +
    `- Формат вставки: [Текст](URL?utm_source=checklist&utm_medium=ecosystem&utm_campaign=ecosystem_${ecosystemId}&utm_content=text_link_N) где N = 1 или 2, а URL берётся из поля «URL» соответствующего якоря.\n` +
    "- Всего 0, 1 или 2 ссылки на весь чек-лист. Не в финальном блоке «Что важно помнить».\n" +
    "- Если ни один якорь не подходит по смыслу — не вставляй ссылки вообще (лучше 0, чем неестественно).";
}

/**
 * Validate markdown links in the main body (before `## Что важно помнить`).
 * When the client has anchors:
 *   - every domain link must have anchor text and base URL from the anchors pool
 *   - total count 0..2 with unique utm_content
 * When no anchors:
 *   - fall back to legacy check: 0-2 links to client domain with unique utm_content
 */
function countContextLinks(md: string, domain: string, anchors: ChecklistAnchor[] = []): { count: number; ok: boolean; utms: string[] } {
  const finalIdx = md.search(/^##\s+Что важно помнить\s*$/m);
  const body = finalIdx >= 0 ? md.slice(0, finalIdx) : md;
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const utms: string[] = [];
  let count = 0;
  let anchorViolation = false;
  let m: RegExpExecArray | null;
  const allForms = new Set<string>();
  for (const a of anchors) {
    allForms.add(a.text);
    for (const v of a.text_variants || []) allForms.add(v);
  }
  const anchorBases = new Set(anchors.map(a => stripUtm(a.target_url).toLowerCase()));
  const domRe = domain
    ? new RegExp(`^https?://${domain.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(/|$)`, "i")
    : null;
  while ((m = re.exec(body)) !== null) {
    const anchorText = m[1].trim();
    const url = m[2];
    // Link considered "brand link" if it matches an anchor base URL or the client domain.
    const isAnchor = anchorBases.has(stripUtm(url).toLowerCase());
    const isDomainLink = domRe ? domRe.test(url) : false;
    if (!isAnchor && !isDomainLink) continue;
    count++;
    if (anchors.length > 0) {
      if (!allForms.has(anchorText)) anchorViolation = true;
      if (!anchorBases.has(stripUtm(url).toLowerCase())) anchorViolation = true;
    }
    const utmMatch = url.match(/[?&]utm_content=([^&]+)/i);
    utms.push(utmMatch ? decodeURIComponent(utmMatch[1]) : "");
  }
  const unique = new Set(utms.filter(Boolean));
  // 0..2 links, unique utm_content across present links, no anchor-pool violations.
  const utmOk = count === 0 || unique.size === count;
  const ok = count <= 2 && utmOk && !anchorViolation;
  return { count, ok, utms };
}

async function fetchChecklistPhotos(
  // deno-lint-ignore no-explicit-any
  admin: any,
  args: { userId: string; ecosystemId: string; query: string },
): Promise<string[]> {
  const key = (Deno.env.get("UNSPLASH_ACCESS_KEY") || "").trim();
  if (!key) {
    console.warn("[CHECKLIST-UNSPLASH] failed: UNSPLASH_ACCESS_KEY not configured");
    return [];
  }
  const rawQuery = (args.query || "").trim();
  if (!rawQuery) {
    console.warn("[CHECKLIST-UNSPLASH] failed: empty query");
    return [];
  }
  // Step 1 — generate 3-5 English query variants via Haiku 4.5.
  // On any failure we fall back to the single-query pipeline (aiTranslate...).
  let queries: string[] = [];
  try {
    queries = await generatePhotoQueryVariants(rawQuery);
  } catch (e) {
    console.warn("[CHECKLIST-UNSPLASH] variant generation failed:", (e as Error).message);
  }
  if (queries.length === 0) {
    try {
      const fallback = await aiTranslateToPhotoQuery(rawQuery);
      if (fallback) queries = [fallback];
    } catch (_) { /* keep raw */ }
    if (queries.length === 0) queries = [rawQuery];
  }
  console.log("[CHECKLIST-UNSPLASH] queries", { source: rawQuery, variants: queries });

  try {
    // Step 2 — parallel search across all variants.
    const perQuery = 3;
    const searches = await Promise.all(queries.map(async (q) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const url =
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}` +
          `&per_page=${perQuery}&orientation=landscape&client_id=${encodeURIComponent(key)}`;
        const r = await fetch(url, { signal: ctrl.signal, headers: { "Accept-Version": "v1" } });
        clearTimeout(timer);
        if (!r.ok) {
          console.warn(`[CHECKLIST-UNSPLASH] query "${q}" HTTP ${r.status}`);
          return [] as any[];
        }
        const j = await r.json();
        return Array.isArray(j?.results) ? j.results : [];
      } catch (e) {
        console.warn(`[CHECKLIST-UNSPLASH] query "${q}" error: ${(e as Error).message}`);
        return [] as any[];
      }
    }));
    // Step 3 — dedupe by photo.id.
    const byId = new Map<string, any>();
    for (const arr of searches) {
      for (const p of arr) {
        if (p?.id && p?.urls?.regular && !byId.has(p.id)) byId.set(p.id, p);
      }
    }
    console.log("[CHECKLIST-UNSPLASH] fetched", {
      totalRaw: searches.reduce((a, b) => a + b.length, 0),
      unique: byId.size,
    });
    if (byId.size === 0) {
      console.warn("[CHECKLIST-UNSPLASH] failed: no results across variants");
      return [];
    }
    // Step 4 — rank by likes + downloads*2 (downloads weighted heavier).
    const ranked = Array.from(byId.values()).map((p) => ({
      p,
      score: (Number(p?.likes) || 0) + 2 * (Number(p?.downloads) || 0),
    })).sort((a, b) => b.score - a.score);
    // Step 5 — take top 2 distinct.
    const top = ranked.slice(0, 2).map((r) => r.p);
    console.log("[CHECKLIST-UNSPLASH] top", top.map((p, i) => ({
      rank: i + 1, id: p.id, score: (Number(p?.likes) || 0) + 2 * (Number(p?.downloads) || 0),
    })));
    if (top.length === 0) return [];

    const uploaded: string[] = [];
    for (let idx = 0; idx < top.length; idx++) {
      const photo = top[idx];
      try {
        const img = await fetch(photo.urls.regular);
        if (!img.ok) throw new Error(`img HTTP ${img.status}`);
        const bytes = new Uint8Array(await img.arrayBuffer());
        const path = `${args.userId}/${args.ecosystemId}/images/${Date.now()}_${idx + 1}.jpg`;
        const { error: upErr } = await admin.storage
          .from("ecosystem-formats")
          .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (upErr) throw upErr;
        const { data: signed } = await admin.storage
          .from("ecosystem-formats")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) uploaded.push(signed.signedUrl);
      } catch (e) {
        console.warn(`[CHECKLIST-UNSPLASH] failed: image ${idx + 1}: ${(e as Error).message}`);
      }
    }
    return uploaded;
  } catch (e) {
    console.warn(`[CHECKLIST-UNSPLASH] failed: ${(e as Error).message}`);
    return [];
  }
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

/**
 * Ask Haiku 4.5 to produce 3-5 English photo-search queries covering the
 * topic from different angles. Returns [] on any failure so the caller can
 * fall back to the single-query pipeline.
 */
async function generatePhotoQueryVariants(topic: string): Promise<string[]> {
  const trimmed = String(topic || "").trim();
  if (!trimmed) return [];
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: orKey } = await supabaseAdmin
    .from("api_keys").select("api_key")
    .eq("provider", "openrouter").eq("is_valid", true).single();
  const key = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "SEO-Module / generate-checklist / photo-queries",
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4.5",
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "Ты помогаешь подобрать фото на Unsplash. Верни СТРОГО JSON-массив из 5 разных английских поисковых запросов, отражающих тему с разных углов (общий, специфичный, эмоциональный, визуальный, контекстный). Только массив строк, никаких пояснений и markdown.",
          },
          {
            role: "user",
            content: `Тема статьи: "${trimmed.slice(0, 200)}"`,
          },
        ],
      }),
    });
    clearTimeout(timer);
    if (!r.ok) return [];
    const j = await r.json();
    const raw = String(j?.choices?.[0]?.message?.content || "").trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return [];
    const cleaned = arr
      .map((s) => String(s || "").trim().replace(/["'`]+/g, "").replace(/\s{2,}/g, " "))
      .filter((s) => s.length > 0 && s.length <= 80 && !/[\u0400-\u04FF]/.test(s));
    // Dedupe (case-insensitive), keep 3-5.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const q of cleaned) {
      const k = q.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(q);
      if (out.length >= 5) break;
    }
    return out.length >= 3 ? out : out; // if <3, caller still falls back correctly
  } catch (_) {
    clearTimeout(timer);
    return [];
  }
}
