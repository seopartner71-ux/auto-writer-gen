// Универсальный генератор документов Content Ecosystem.
// Читает конфиг из document_types (system_prompt_template, post_checks_config,
// pdf_template_config, html_landing_config, anchors_config, client_pages_config)
// и по слагу собирает документ БЕЗ отдельного edge-функции на каждый тип.
//
// Диспетчер generate-document роутит сюда всё, кроме legacy checklist/dzen.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { logCost, tokensToUsd } from "../_shared/costLogger.ts";
import {
  buildAnchorsBlock, buildClientPagesBlock, parseAnchors, parseClientPages, renderTemplate,
} from "../_shared/promptBlocks.ts";
import { runValidators } from "../_shared/documentValidators.ts";
import { buildDocumentUniversalPdf } from "../_shared/documentPdf.ts";
import { uploadEcosystemPdf } from "../_shared/pdfUtils.ts";
import { fetchDocumentPhotos } from "../_shared/documentPhotos.ts";

interface ReqBody { ecosystem_format_id: string; regenerate_pdf_only?: boolean }

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    if (!body?.ecosystem_format_id) return json({ error: "ecosystem_format_id required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: fmt, error: fErr } = await admin
      .from("ecosystem_formats")
      .select("id, ecosystem_id, format_type, status, retry_count, content, pdf_path, document_type_id, document_types(*), content_ecosystems!inner(id, user_id, client_id, source_article_id, articles(*), clients(*))")
      .eq("id", body.ecosystem_format_id)
      .maybeSingle();
    if (fErr || !fmt) return json({ error: "format not found" }, 404);
    const eco: any = (fmt as any).content_ecosystems;
    if (eco.user_id !== userId) return json({ error: "forbidden" }, 403);
    const dt: any = (fmt as any).document_types;
    if (!dt) return json({ error: "document_type not linked" }, 400);
    if (!dt.is_active) return json({ error: "document_type inactive" }, 400);

    await admin.from("ecosystem_formats").update({
      status: "generating", progress: 10, error_reason: null, started_at: new Date().toISOString(),
    }).eq("id", (fmt as any).id);

    // deno-lint-ignore no-explicit-any
    const runtime: any = (globalThis as any).EdgeRuntime;
    const task = runInBackground(admin, {
      formatId: (fmt as any).id,
      ecosystemId: eco.id,
      userId,
      retryCount: (fmt as any).retry_count ?? 0,
      documentType: dt,
      article: eco.articles,
      client: eco.clients,
      existingContent: body.regenerate_pdf_only ? (fmt as any).content : null,
      regeneratePdfOnly: !!body.regenerate_pdf_only,
    });
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else task.catch((e) => console.error("[generate-doc-universal] bg", e));

    return json({ ok: true, format_id: (fmt as any).id }, 202);
  } catch (e) {
    console.error("[generate-doc-universal] top", e);
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface BgCtx {
  formatId: string; ecosystemId: string; userId: string; retryCount: number;
  documentType: any; article: any; client: any;
  existingContent: string | null; regeneratePdfOnly: boolean;
}

// deno-lint-ignore no-explicit-any
async function runInBackground(admin: any, ctx: BgCtx) {
  const startedAt = Date.now();
  const dt = ctx.documentType;
  const slug: string = dt.slug;
  const setProgress = (progress: number, patch: Record<string, unknown> = {}) =>
    admin.from("ecosystem_formats").update({ progress, ...patch }).eq("id", ctx.formatId);

  await track(admin, ctx.userId, "format_generation_started", {
    ecosystem_id: ctx.ecosystemId, format_id: ctx.formatId,
    document_type_slug: slug, model: dt.primary_model,
  });

  try {
    let markdown = ctx.existingContent || "";
    let modelUsed = dt.primary_model as string;
    let tokensIn = 0, tokensOut = 0, retriesUsed = 0;

    if (!ctx.regeneratePdfOnly || !markdown) {
      const articleText = stripHtml(ctx.article?.content || "").slice(0, 14000);
      if (!articleText || articleText.length < 200) throw new Error("Исходная статья пуста или слишком короткая");

      const anchors = parseAnchors(ctx.client?.anchors);
      const clientPages = parseClientPages(ctx.client?.client_pages);
      const anchorsBlock = buildAnchorsBlock(anchors, dt.anchors_config, ctx.ecosystemId);
      const pagesBlock = buildClientPagesBlock(clientPages, dt.client_pages_config, ctx.ecosystemId);

      const vars = {
        article: {
          content: articleText,
          keyword: ctx.article?.main_keyword || (ctx.article?.keywords || [])[0] || "",
          seo_title: ctx.article?.title || "",
          title: ctx.article?.title || "",
        },
        client: {
          name: ctx.client?.name || "",
          domain: cleanDomain(ctx.client?.domain),
          description: ctx.client?.description || "",
          expert_name: ctx.client?.expert_name || "",
          expert_bio: ctx.client?.expert_bio || "",
          brand_voice: ctx.client?.brand_voice || "нейтральный экспертный",
        },
        anchors_block: anchorsBlock,
        client_pages_block: pagesBlock,
      };

      const tpl = String(dt.system_prompt_template || defaultTemplate(slug));
      let systemPrompt = renderTemplate(tpl, vars);
      // Если в шаблоне нет упоминаний anchors/pages_block — добавим их в конец.
      if (anchorsBlock && !/anchors_block/.test(tpl) && !systemPrompt.includes(anchorsBlock)) systemPrompt += anchorsBlock;
      if (pagesBlock && !/client_pages_block/.test(tpl) && !systemPrompt.includes(pagesBlock)) systemPrompt += pagesBlock;
      systemPrompt +=
        "\n\n## Форматирование\n" +
        "- Только Markdown, никакого HTML.\n" +
        "- Тире везде короткое `-` с пробелами, никаких длинных `—`.\n" +
        "- Не используй букву «ё», всегда «е».\n" +
        "- Не выдумывай названия продуктов/компаний, которых нет в исходной статье.";
      systemPrompt += buildValidationInstructions(dt.post_checks_config, dt.target_length_words);

      const userPrompt =
        `Название материала: ${ctx.article?.title || ""}\n` +
        `Основной ключ: ${vars.article.keyword}\n\n` +
        `Исходный материал:\n${articleText}\n\n` +
        `Собери документ типа "${dt.name}" по описанным требованиям.`;

      await setProgress(25);
      const gen = await generateWithValidation({
        primary: dt.primary_model,
        fallback: dt.fallback_model || dt.primary_model,
        systemPrompt, userPrompt,
        checks: dt.post_checks_config,
        articleText,
        maxTokens: estimateMaxTokens(dt),
      });
      markdown = gen.markdown;
      modelUsed = gen.modelUsed;
      tokensIn = gen.tokensIn; tokensOut = gen.tokensOut;
      retriesUsed = gen.retriesUsed;
      if (!gen.valid) {
        await admin.from("ecosystem_formats").update({
          status: "failed",
          error_reason: `Не пройдены проверки после ${retriesUsed} ретраев: ${gen.failedReasons.slice(0, 3).join("; ")}`.slice(0, 500),
          model_used: modelUsed,
          duration_ms: Date.now() - startedAt,
          retry_count: ctx.retryCount + 1,
        }).eq("id", ctx.formatId);
        await track(admin, ctx.userId, "format_generation_failed", {
          document_type_slug: slug, reason: gen.failedReasons.slice(0, 3).join("; "), retry_count: retriesUsed,
        });
        return;
      }
      await setProgress(60, { model_used: modelUsed, content: markdown });

      try {
        await logCost(admin, {
          user_id: ctx.userId,
          operation_type: "llm_call",
          model: modelUsed,
          tokens_input: tokensIn,
          tokens_output: tokensOut,
          cost_usd: tokensToUsd(modelUsed, tokensIn, tokensOut),
          metadata: { function: "generate-doc-universal", document_type_slug: slug, ecosystem_id: ctx.ecosystemId, retries: retriesUsed },
        });
      } catch { /* ignore */ }
    } else {
      await setProgress(60);
    }

    // ---- PDF ----
    let pdfUrl: string | null = null;
    let pdfPath: string | null = null;
    let pdfError: string | null = null;
    let unrenderedLinks = 0;
    if (dt.category === "pdf") {
      try {
        // Тематические фото по ключу и теме статьи (best-effort, не блокирует PDF).
        let imageUrls: string[] = [];
        try {
          imageUrls = await fetchDocumentPhotos(admin, {
            userId: ctx.userId,
            ecosystemId: ctx.ecosystemId,
            slug,
            query: ctx.article?.main_keyword
              || (ctx.article?.keywords || [])[0]
              || ctx.article?.title
              || "",
            count: 3,
          });
          if (imageUrls.length > 0) {
            await admin.from("ecosystem_formats")
              .update({ image_urls: imageUrls })
              .eq("id", ctx.formatId);
          }
        } catch (e) {
          console.warn("[generate-doc-universal] photos failed:", (e as Error).message);
        }
        const built = await buildDocumentUniversalPdf({
          markdown,
          title: ctx.article?.title || dt.name,
          ecosystemId: ctx.ecosystemId,
          client: ctx.client,
          article: {
            title: ctx.article?.title || null,
            keyword: ctx.article?.main_keyword || null,
            main_keyword: ctx.article?.main_keyword || null,
            meta_description: ctx.article?.meta_description || null,
            lsi_keywords: ctx.article?.lsi_keywords || null,
          },
          imageUrls,
          pdfConfig: dt.pdf_template_config,
          documentTypeName: dt.name,
        });
        unrenderedLinks = built.unrenderedLinks;
        const targetPath = `${ctx.userId}/${ctx.ecosystemId}/${slug}/${Date.now()}.pdf`;
        await setProgress(85);
        const up = await uploadEcosystemPdf(admin, targetPath, built.bytes);
        pdfPath = up.path; pdfUrl = up.signedUrl;
        if (!pdfUrl) throw new Error("Не удалось получить подписанную ссылку на PDF");
      } catch (e) {
        pdfError = (e as Error).message?.slice(0, 500) || "unknown PDF error";
        console.error("[generate-doc-universal] PDF failed", pdfError);
      }
    }

    await admin.from("ecosystem_formats").update({
      status: pdfUrl || dt.category !== "pdf" ? "completed" : "partial",
      progress: 100,
      content: markdown,
      model_used: modelUsed,
      pdf_url: pdfUrl,
      pdf_path: pdfPath,
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      error_reason: pdfUrl
        ? (unrenderedLinks > 0 ? `Unrendered markdown links: ${unrenderedLinks}` : null)
        : (pdfError ? `PDF: ${pdfError}` : null),
    }).eq("id", ctx.formatId);

    // formats_completed
    const { data: sib } = await admin.from("ecosystem_formats").select("format_type,status").eq("ecosystem_id", ctx.ecosystemId);
    const completedTypes = (sib || [])
      .filter((r: any) => r.status === "completed" || r.status === "partial")
      .map((r: any) => r.format_type);
    await admin.from("content_ecosystems").update({
      formats_completed: completedTypes,
      status: (sib || []).every((r: any) => r.status === "completed" || r.status === "partial") ? "completed" : "generating",
    }).eq("id", ctx.ecosystemId);

    await track(admin, ctx.userId, "format_generation_completed", {
      document_type_slug: slug, model_used: modelUsed,
      duration_ms: Date.now() - startedAt, unrendered_links_count: unrenderedLinks,
    });
  } catch (err) {
    console.error("[generate-doc-universal] failed", err);
    await admin.from("ecosystem_formats").update({
      status: "failed",
      error_reason: (err as Error).message?.slice(0, 500) || "unknown",
      retry_count: ctx.retryCount + 1,
      duration_ms: Date.now() - startedAt,
    }).eq("id", ctx.formatId);
    await track(admin, ctx.userId, "format_generation_failed", {
      document_type_slug: dt.slug, reason: (err as Error).message?.slice(0, 200), retry_count: ctx.retryCount + 1,
    });
  }
}

function defaultTemplate(slug: string): string {
  return `Ты профессиональный копирайтер. На основе исходной статьи создай документ типа "${slug}" в Markdown.\n\n` +
    `Контекст клиента: {{client.name}}, {{client.expert_name}}. Тональность: {{client.brand_voice}}.\n\n` +
    `Основной ключ: {{article.keyword}}.\n\n` +
    `Исходная статья доступна в user-сообщении. Возвращай ТОЛЬКО Markdown без пояснений.`;
}

function estimateMaxTokens(dt: any): number {
  const wordsMax = Number(dt?.target_length_words?.max || 1500);
  // ~1.6 токена на русское слово + запас на разметку
  return Math.min(16000, Math.max(2000, Math.round(wordsMax * 2.2) + 500));
}

function buildValidationInstructions(checks: any, targetLength: any): string {
  if (!Array.isArray(checks) || checks.length === 0) return "";
  const lines: string[] = [];
  const wordMin = checks.find((c: any) => c?.type === "min_word_count")?.min ?? targetLength?.min;
  const wordMax = checks.find((c: any) => c?.type === "max_word_count")?.max ?? targetLength?.max;
  const bulletMin = checks.find((c: any) => c?.type === "min_bullet_count")?.min;
  const bulletMax = checks.find((c: any) => c?.type === "max_bullet_count")?.max;
  const h2 = checks.find((c: any) => c?.type === "h2_count");
  const steps = checks.find((c: any) => c?.type === "numbered_steps_present");
  const finalExact = checks.find((c: any) => c?.type === "final_section_exact")?.title;
  const conclusions = checks.find((c: any) => c?.type === "practical_conclusions_present");
  const links = checks.find((c: any) => c?.type === "context_links_count");

  if (wordMin || wordMax) lines.push(`- Объем текста: ${wordMin || 0}-${wordMax || "без лимита"} слов. Не отвечай короче нижнего порога.`);
  if (bulletMin || bulletMax) lines.push(`- Маркированные пункты: ${bulletMin || 0}-${bulletMax || "без лимита"}. Каждый пункт должен начинаться строго с \`- \` в начале строки.`);
  if (h2) lines.push(`- Количество H2: ${Number(h2.min || 0)}-${Number(h2.max || 99)} заголовков вида \`## Название\`.`);
  if (steps) lines.push(`- Шаги: ${Number(steps.min || 1)}-${Number(steps.max || 99)} заголовков вида \`### 1. Название\`, \`### 2. Название\`.`);
  if (finalExact) lines.push(`- Обязательный финальный H2: \`## ${String(finalExact)}\` точно в таком написании.`);
  if (conclusions?.title) lines.push(`- Блок \`## ${String(conclusions.title)}\` должен содержать минимум ${Number(conclusions.min_items || 3)} пунктов \`- \`.`);
  if (links) lines.push(`- Markdown-ссылки: ${Number(links.min || 0)}-${Number(links.max || 99)} штук, если ссылки клиента переданы.`);
  if (checks.some((c: any) => c?.type === "no_tables")) lines.push("- Не используй markdown-таблицы.");
  if (checks.some((c: any) => c?.type === "no_task_list")) lines.push("- Не используй task-list чекбоксы вида `- [ ]`.");

  return lines.length
    ? "\n\n## Автопроверка перед ответом\nПеред отправкой проверь документ по чек-листу:\n" + lines.join("\n")
    : "";
}

interface GenResult {
  markdown: string; modelUsed: string; tokensIn: number; tokensOut: number;
  retriesUsed: number; valid: boolean; failedReasons: string[];
}

async function generateWithValidation(args: {
  primary: string; fallback: string;
  systemPrompt: string; userPrompt: string;
  checks: any; articleText: string; maxTokens: number;
}): Promise<GenResult> {
  let system = args.systemPrompt;
  const attempts: Array<{ model: string; extraSystem?: string }> = [
    { model: args.primary },
    { model: args.primary, extraSystem: "PREV_FAILED" },
    { model: args.fallback, extraSystem: "PREV_FAILED" },
  ];

  let lastMd = "", lastFailures: string[] = [];
  let totalIn = 0, totalOut = 0, modelUsed = args.primary;
  for (let i = 0; i < attempts.length; i++) {
    const { model, extraSystem } = attempts[i];
    let sys = system;
    if (extraSystem === "PREV_FAILED" && lastFailures.length > 0) {
      sys += `\n\n## КРИТИЧНО: предыдущая попытка провалила проверки\n${lastFailures.map((r) => `- ${r}`).join("\n")}\nСтрого соблюдай ВСЕ требования формата в этой попытке.`;
    }
    const r = await callOpenRouter({ model, system: sys, user: args.userPrompt, maxTokens: args.maxTokens });
    totalIn += r.tokensIn; totalOut += r.tokensOut; modelUsed = model;
    lastMd = r.content;
    const val = runValidators(r.content, args.checks, { sourceArticleText: args.articleText });
    if (val.ok) {
      return { markdown: r.content, modelUsed: model, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: i, valid: true, failedReasons: [] };
    }
    lastFailures = val.failedReasons;
    console.warn("[generate-doc-universal] validation failed", { attempt: i, model, failures: lastFailures });
  }
  return { markdown: lastMd, modelUsed, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: attempts.length - 1, valid: false, failedReasons: lastFailures };
}

async function callOpenRouter(opts: { model: string; system: string; user: string; maxTokens: number }): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orKey } = await admin.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
  const key = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OpenRouter API key not configured");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "SEO-Module / generate-doc-universal",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: 0.5,
      max_tokens: opts.maxTokens,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenRouter ${opts.model} ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return {
    content: String(j?.choices?.[0]?.message?.content || "").trim(),
    tokensIn: Number(j?.usage?.prompt_tokens || 0),
    tokensOut: Number(j?.usage?.completion_tokens || 0),
  };
}

function cleanDomain(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "").split("/")[0];
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "-").replace(/&ndash;/g, "-")
    .replace(/\s+/g, " ").trim();
}

// deno-lint-ignore no-explicit-any
async function track(admin: any, userId: string, event_name: string, metadata: Record<string, unknown>) {
  try {
    await admin.from("activation_events").insert({ user_id: userId, event_name, session_id: "app", metadata });
  } catch { /* noop */ }
}