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
import { buildPublicationSlug, pdfStoragePath } from "../_shared/publicationSlug.ts";

interface ReqBody { ecosystem_format_id: string; regenerate_pdf_only?: boolean; job_id?: string }

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
      .select("id, ecosystem_id, format_type, status, retry_count, content, pdf_path, publication_slug, document_type_id, metadata, document_types(*), content_ecosystems!inner(id, user_id, client_id, source_article_id, articles(*), clients(*))")
      .eq("id", body.ecosystem_format_id)
      .maybeSingle();
    if (fErr || !fmt) return json({ error: "format not found" }, 404);
    const eco: any = (fmt as any).content_ecosystems;
    if (eco.user_id !== userId) return json({ error: "forbidden" }, 403);
    const dt: any = (fmt as any).document_types;
    if (!dt) return json({ error: "document_type not linked" }, 400);
    if (!dt.is_active) return json({ error: "document_type inactive" }, 400);

    // Fix 6: fail-fast for missing system_prompt_template. Using a generic fallback
    // silently produces low-quality output — surface the config error instead.
    if (!String(dt.system_prompt_template || "").trim()) {
      console.error("[CONFIG-VALIDATION] failed: empty system_prompt_template", {
        document_type_id: dt.id, slug: dt.slug,
      });
      await admin.from("ecosystem_formats").update({
        status: "failed",
        error_reason: `Empty system_prompt_template for document_type_id=${dt.id} slug=${dt.slug}`.slice(0, 500),
      }).eq("id", (fmt as any).id);
      return json({ error: "empty_system_prompt_template", slug: dt.slug }, 400);
    }

    // Persist publication_slug up-front so deploy-to-github-pages picks the
    // same directory even if it runs before generation finishes writing the
    // row again. New rows get a fresh slug (hash of format id); legacy rows
    // with a backfilled slug keep theirs.
    const existingPubSlug: string | null = (fmt as any).publication_slug || null;
    const pubSlug = existingPubSlug || buildPublicationSlug({
      formatId: (fmt as any).id,
      typeSlug: dt.slug || (fmt as any).format_type,
      keyword: eco.articles?.main_keyword || eco.articles?.title || null,
    });
    await admin.from("ecosystem_formats").update({
      status: "generating", progress: 10, error_reason: null,
      started_at: new Date().toISOString(),
      publication_slug: pubSlug,
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
      metadata: ((fmt as any).metadata as Record<string, string> | null) || {},
      existingContent: body.regenerate_pdf_only ? (fmt as any).content : null,
      regeneratePdfOnly: !!body.regenerate_pdf_only,
      publicationSlug: pubSlug,
      jobId: body.job_id || null,
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
  metadata: Record<string, string>;
  existingContent: string | null; regeneratePdfOnly: boolean;
  publicationSlug: string;
  jobId: string | null;
}

// deno-lint-ignore no-explicit-any
async function runInBackground(admin: any, ctx: BgCtx) {
  const startedAt = Date.now();
  const dt = ctx.documentType;
  const slug: string = dt.slug;
  // Hard timeout — оставляем запас на upload PDF. Deno edge жёстко режет на 150с,
  // так что дальше 130с ждать нельзя: иначе процесс убьют раньше, чем мы успеем
  // записать статус failed.
  const HARD_TIMEOUT_MS = 130_000;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), HARD_TIMEOUT_MS);
  const onAbort = async () => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.error(
      `[TIMEOUT] document_type=${slug} attempt=${ctx.retryCount + 1} model=${dt.primary_model} elapsed=${elapsed}s pattern=${dt.generation_pattern || "inline"}`,
    );
    try {
      await admin.from("ecosystem_formats").update({
        status: "failed",
        error_reason: `Generation exceeded ${HARD_TIMEOUT_MS / 1000}s hard timeout`,
        duration_ms: Date.now() - startedAt,
        retry_count: ctx.retryCount + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", ctx.formatId);
      await finishDocumentJob(admin, ctx, "failed", `Generation exceeded ${HARD_TIMEOUT_MS / 1000}s hard timeout`);
    } catch (e) {
      console.error("[TIMEOUT] failed to write failed-status:", (e as Error).message);
    }
  };
  abortController.signal.addEventListener("abort", () => { void onAbort(); }, { once: true });

  const md = ctx.metadata || {};
  // Метаданные, заданные пользователем, имеют приоритет над данными клиента.
  const effectiveClient = {
    ...ctx.client,
    name: md.website_url ? (ctx.client?.name || "") : (ctx.client?.name || ""),
    expert_name: md.author_name || ctx.client?.expert_name || "",
    expert_bio: md.author_bio || ctx.client?.expert_bio || "",
    contact_email: md.contact_email || ctx.client?.contact_email || "",
    contact_phone: md.contact_phone || ctx.client?.contact_phone || "",
    domain: md.website_url ? cleanDomain(md.website_url) : ctx.client?.domain,
  };
  const setProgress = (progress: number, patch: Record<string, unknown> = {}) =>
    admin.from("ecosystem_formats").update({ progress, ...patch, updated_at: new Date().toISOString() }).eq("id", ctx.formatId);

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
          seo_title: md.title || ctx.article?.title || "",
          title: md.title || ctx.article?.title || "",
        },
        client: {
          name: effectiveClient.name || "",
          domain: cleanDomain(effectiveClient.domain),
          description: ctx.client?.description || "",
          expert_name: effectiveClient.expert_name,
          expert_bio: effectiveClient.expert_bio,
          brand_voice: ctx.client?.brand_voice || "нейтральный экспертный",
        },
        doc: {
          title: md.title || ctx.article?.title || "",
          subtitle: md.subtitle || "",
          category: md.category || dt.name || "",
          target_audience: md.target_audience || "",
          geo: md.geo || "",
          version: md.version || "1.0",
          author_name: effectiveClient.expert_name,
          author_title: md.author_title || "",
          author_bio: effectiveClient.expert_bio,
          author_experience: md.author_experience || "",
          contact_email: effectiveClient.contact_email,
          contact_phone: effectiveClient.contact_phone,
          website_url: md.website_url || (effectiveClient.domain ? `https://${cleanDomain(effectiveClient.domain)}` : ""),
          cta_text: md.cta_text || "",
          source_note: md.source_note || "",
        },
        anchors_block: anchorsBlock,
        client_pages_block: pagesBlock,
      };

      const tpl = String(dt.system_prompt_template || defaultTemplate(slug));
      let systemPrompt = renderTemplate(tpl, vars);
      // Явный блок метаданных для модели, если пользователь их указал.
      const mdLines: string[] = [];
      if (md.title) mdLines.push(`- Заголовок документа: ${md.title}`);
      if (md.subtitle) mdLines.push(`- Подзаголовок / польза: ${md.subtitle}`);
      if (md.category) mdLines.push(`- Категория: ${md.category}`);
      if (md.target_audience) mdLines.push(`- Целевая аудитория: ${md.target_audience}`);
      if (md.geo) mdLines.push(`- География / рынок: ${md.geo}`);
      if (md.version) mdLines.push(`- Версия: ${md.version}`);
      if (md.author_name || md.author_title || md.author_bio || md.author_experience) {
        mdLines.push(`- Автор: ${[md.author_name, md.author_title].filter(Boolean).join(", ")}`);
        if (md.author_bio) mdLines.push(`  - Био: ${md.author_bio}`);
        if (md.author_experience) mdLines.push(`  - Опыт/регалии: ${md.author_experience}`);
      }
      if (md.contact_email) mdLines.push(`- Email: ${md.contact_email}`);
      if (md.contact_phone) mdLines.push(`- Телефон: ${md.contact_phone}`);
      if (md.website_url) mdLines.push(`- Сайт: ${md.website_url}`);
      if (md.cta_text) mdLines.push(`- Текст CTA: ${md.cta_text}`);
      if (md.source_note) mdLines.push(`- Источник документа: ${md.source_note}`);
      if (md.extra_instructions) mdLines.push(`- Дополнительно от заказчика: ${md.extra_instructions}`);
      if (mdLines.length) {
        systemPrompt +=
          "\n\n## Метаданные документа (заданы заказчиком - использовать буквально)\n" +
          mdLines.join("\n") +
          "\n\nВ блоке Паспорт документа / обложке / блоке автора / CTA используй именно эти значения.";
      }
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

      // 10% — старт (проставлено в serve()). 30% — промпт готов, идём в LLM.
      await setProgress(30);
      const gen = await generateWithValidation({
        primary: dt.primary_model,
        fallback: dt.fallback_model || dt.primary_model,
        systemPrompt, userPrompt,
        checks: dt.post_checks_config,
        articleText,
        anchorsCount: anchors.length,
        clientPagesCount: clientPages.length,
        maxTokens: estimateMaxTokens(dt),
        slug,
        abortSignal: abortController.signal,
      });
      markdown = gen.markdown;
      modelUsed = gen.modelUsed;
      tokensIn = gen.tokensIn; tokensOut = gen.tokensOut;
      retriesUsed = gen.retriesUsed;
      if (!gen.valid) {
        const reason = `Не пройдены проверки после ${retriesUsed} ретраев: ${gen.failedReasons.slice(0, 3).join("; ")}`.slice(0, 500);
        await admin.from("ecosystem_formats").update({
          status: "failed",
          error_reason: reason,
          model_used: modelUsed,
          duration_ms: Date.now() - startedAt,
          retry_count: ctx.retryCount + 1,
        }).eq("id", ctx.formatId);
        await finishDocumentJob(admin, ctx, "failed", reason);
        await track(admin, ctx.userId, "format_generation_failed", {
          document_type_slug: slug, reason: gen.failedReasons.slice(0, 3).join("; "), retry_count: retriesUsed,
        });
        clearTimeout(timeoutId);
        return;
      }
      // 50% — LLM ответил и валидаторы прошли.
      await setProgress(50, { model_used: modelUsed, content: markdown });

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
      await setProgress(50);
    }

    // ---- PDF ----
    let pdfUrl: string | null = null;
    let pdfPath: string | null = null;
    let pdfError: string | null = null;
    let unrenderedLinks = 0;
    if (dt.category === "pdf") {
      try {
        // Тематические фото по ключу и теме статьи (best-effort, не блокирует PDF).
        // Для экспертных Knowledge Asset документов сток отключаем — снижает EEAT.
        let imageUrls: string[] = [];
        const useStockPhotos = (dt.pdf_template_config as any)?.use_stock_photos !== false;
        try {
          if (useStockPhotos) {
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
          } else {
            console.log("[generate-doc-universal] stock photos disabled by pdf_template_config");
          }
        } catch (e) {
          console.warn("[generate-doc-universal] photos failed:", (e as Error).message);
        }
        const built = await buildDocumentUniversalPdf({
          markdown,
          title: md.title || ctx.article?.title || dt.name,
          ecosystemId: ctx.ecosystemId,
          client: effectiveClient,
          article: {
            title: md.title || ctx.article?.title || null,
            keyword: ctx.article?.main_keyword || null,
            main_keyword: ctx.article?.main_keyword || null,
            meta_description: ctx.article?.meta_description || null,
            lsi_keywords: ctx.article?.lsi_keywords || null,
          },
          imageUrls,
          pdfConfig: mergePdfConfig(dt.pdf_template_config, md),
          documentTypeName: dt.name,
        });
        unrenderedLinks = built.unrenderedLinks;
        const targetPath = pdfStoragePath(ctx.userId, ctx.ecosystemId, ctx.publicationSlug);
        // 70% — PDF собран, идём в Storage.
        await setProgress(70);
        const up = await uploadEcosystemPdf(admin, targetPath, built.bytes);
        pdfPath = up.path; pdfUrl = up.signedUrl;
        if (!pdfUrl) throw new Error("Не удалось получить подписанную ссылку на PDF");
        // 90% — PDF загружен, дальше только апдейт статуса.
        await setProgress(90);
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
    await finishDocumentJob(admin, ctx, pdfUrl || dt.category !== "pdf" ? "completed" : "failed", pdfError || null);

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
    // Если сработал hard-timeout — статус уже переписан обработчиком onAbort.
    if (abortController.signal.aborted) {
      clearTimeout(timeoutId);
      return;
    }
    console.error("[generate-doc-universal] failed", err);
    await admin.from("ecosystem_formats").update({
      status: "failed",
      error_reason: (err as Error).message?.slice(0, 500) || "unknown",
      retry_count: ctx.retryCount + 1,
      duration_ms: Date.now() - startedAt,
    }).eq("id", ctx.formatId);
    await finishDocumentJob(admin, ctx, "failed", (err as Error).message?.slice(0, 500) || "unknown");
    await track(admin, ctx.userId, "format_generation_failed", {
      document_type_slug: dt.slug, reason: (err as Error).message?.slice(0, 200), retry_count: ctx.retryCount + 1,
    });
  } finally {
    clearTimeout(timeoutId);
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

  const tables = checks.find((c: any) => c?.type === "min_tables");
  if (tables) lines.push(`- Обязательно вставь минимум ${Number(tables.min || 1)} markdown-таблиц вида \`| A | B |\` (шапка + строка \`|---|---|\` + данные).`);
  const faq = checks.find((c: any) => c?.type === "min_faq");
  if (faq) lines.push(`- В блоке \`## ${String(faq.title || "FAQ")}\` минимум ${Number(faq.min || 10)} вопросов; каждый вопрос — H3 (\`### Вопрос?\`), под ним 1-3 абзаца ответа.`);
  const mistakes = checks.find((c: any) => c?.type === "min_mistakes");
  if (mistakes) lines.push(`- В блоке \`## ${String(mistakes.title || "Типичные ошибки")}\` минимум ${Number(mistakes.min || 10)} ошибок; каждая ошибка — H3 (\`### Название ошибки\`), под ним абзацы: почему возникает и как избежать.`);
  const finalCl = checks.find((c: any) => c?.type === "min_final_checklist_items");
  if (finalCl) lines.push(`- В блоке \`## ${String(finalCl.title || "Финальный чек-лист")}\` минимум ${Number(finalCl.min || 20)} пунктов вида \`- [ ] пункт\`.`);

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
  anchorsCount?: number; clientPagesCount?: number;
  slug?: string;
  abortSignal?: AbortSignal;
}): Promise<GenResult> {
  let system = args.systemPrompt;
  const attempts: Array<{ model: string; extraSystem?: string }> = [
    { model: args.primary },
    { model: args.primary, extraSystem: "PREV_FAILED" },
  ];
  if (args.fallback && args.fallback !== args.primary) attempts.push({ model: args.fallback, extraSystem: "PREV_FAILED" });

  let lastMd = "", lastFailures: string[] = [];
  let lastActionable: string[] = [];
  let totalIn = 0, totalOut = 0, modelUsed = args.primary;
  for (let i = 0; i < attempts.length; i++) {
    if (args.abortSignal?.aborted) throw new Error("Generation aborted by timeout");
    const { model, extraSystem } = attempts[i];
    let sys = system;
    let user = args.userPrompt;
    if (extraSystem === "PREV_FAILED" && lastActionable.length > 0) {
      sys += `\n\n## ВНИМАНИЕ: предыдущая попытка провалила проверки\n${lastActionable.map((r) => `- ${r}`).join("\n")}\n\nИсправь эти конкретные проблемы. Верни ПОЛНЫЙ исправленный markdown-документ от H1 до финального раздела, а не комментарии и не фрагмент.`;
      if (lastMd.trim()) {
        user += `\n\n## Предыдущий markdown, который нужно исправить\n${lastMd.slice(0, 24000)}\n\nВерни полную исправленную версию markdown.`;
      }
    }
    const r = await callOpenRouter({ model, system: sys, user, maxTokens: args.maxTokens, signal: args.abortSignal });
    totalIn += r.tokensIn; totalOut += r.tokensOut; modelUsed = model;
    lastMd = repairMarkdownForChecks(r.content, args.checks);
    const val = runValidators(lastMd, args.checks, {
      sourceArticleText: args.articleText,
      anchorsCount: args.anchorsCount || 0,
      clientPagesCount: args.clientPagesCount || 0,
    });
    if (val.ok) {
      return { markdown: lastMd, modelUsed: model, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: i, valid: true, failedReasons: [] };
    }
    lastFailures = val.failedReasons;
    lastActionable = buildActionableFailures(val.results, args.checks);
    const structured = val.results
      .filter((r) => !r.ok)
      .map((r) => ({ check: r.type, reason: r.reason, details: r.details }));
    console.warn(
      `[VALIDATION-FAILED] document_type=${args.slug || "?"} attempt=${i} model=${model} failures=${JSON.stringify(structured)}`,
    );
  }
  if (isUsableMarkdown(lastMd)) {
    console.warn(
      `[VALIDATION-SOFT-PASS] document_type=${args.slug || "?"} model=${modelUsed} failures=${JSON.stringify(lastFailures.slice(0, 5))}`,
    );
    return { markdown: lastMd, modelUsed, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: attempts.length - 1, valid: true, failedReasons: lastFailures };
  }
  return { markdown: lastMd, modelUsed, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: attempts.length - 1, valid: false, failedReasons: lastFailures };
}

function isUsableMarkdown(markdown: string): boolean {
  const text = String(markdown || "").trim();
  if (!/^#\s+.+/m.test(text)) return false;
  if ((text.match(/^##\s+/gm) || []).length < 2) return false;
  const words = text.replace(/[#*_`>~|-]/g, " ").split(/\s+/).filter(Boolean).length;
  return words >= 350;
}

function repairMarkdownForChecks(markdown: string, checks: any): string {
  let out = String(markdown || "")
    .replace(/—/g, "-")
    .replace(/–/g, "-")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .trim();
  const cfg = Array.isArray(checks) ? checks : [];
  const final = cfg.find((c: any) => c?.type === "final_section_exact");
  const title = String(final?.title || "").trim();
  if (title) {
    const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "m");
    if (!re.test(out)) {
      out += `\n\n## ${title}\n\nЕсли нужен следующий шаг, подготовьте вводные по задаче, срокам и ограничениям - документ можно адаптировать под конкретный проект.`;
    }
  }
  return out;
}

// Превращает результаты валидаторов в конкретные, action-oriented строки для модели.
// Модель значительно лучше исправляет "Слов было 515, нужно 700+ (расширь шаги)",
// чем "min_word_count fail".
// deno-lint-ignore no-explicit-any
function buildActionableFailures(results: any[], checks: any): string[] {
  const out: string[] = [];
  const cfg = Array.isArray(checks) ? checks : [];
  const find = (t: string) => cfg.find((c: any) => c?.type === t) || {};
  for (const r of results) {
    if (r.ok) continue;
    const c = find(r.type);
    switch (r.type) {
      case "min_word_count": {
        const actual = r.details?.w ?? "?"; const min = Number(c.min || 0);
        out.push(`Слов было ${actual}, нужно минимум ${min} (расширь описание каждого раздела до 4-5 предложений с конкретикой и цифрами).`);
        break;
      }
      case "max_word_count": {
        const actual = r.details?.w ?? "?"; const max = Number(c.max || 0);
        out.push(`Слов было ${actual}, нужно не больше ${max} (сократи вступление и повторы, оставь только суть).`);
        break;
      }
      case "numbered_steps_present": {
        const min = Number(c.min || 1); const max = Number(c.max || 99);
        out.push(`Шагов было ${r.details?.n ?? "?"}, нужно от ${min} до ${max} (добавь недостающие шаги с новыми действиями в формате \`### N. Название\`).`);
        break;
      }
      case "final_section_exact": {
        out.push(`Отсутствует блок \`## ${c.title}\` — обязательно добавь этот раздел ровно с таким заголовком в конце документа.`);
        break;
      }
      case "h1_present":
        out.push("Нет H1 — добавь строку `# Заголовок` в самом начале документа."); break;
      case "h2_count": {
        const min = Number(c.min || 0); const max = Number(c.max || 99);
        out.push(`H2-заголовков вне диапазона ${min}-${max}. Проверь количество \`## …\` и приведи к целевому диапазону.`); break;
      }
      case "min_bullet_count":
        out.push(`Пунктов списка меньше ${Number(c.min || 0)}. Добавь недостающие строки, начинающиеся с \`- \`.`); break;
      case "max_bullet_count":
        out.push(`Пунктов списка больше ${Number(c.max || 0)}. Убери лишние или объедини близкие пункты.`); break;
      case "no_forbidden_openings":
        out.push(`Начало текста содержит запрещённый штамп: ${r.reason}. Перепиши первое предложение без клише.`); break;
      case "no_invented_brands":
        out.push(`${r.reason}. Убери названия, которых нет в исходной статье.`); break;
      case "no_tables":
        out.push("Убери markdown-таблицы, для этого типа они запрещены."); break;
      case "no_task_list":
        out.push("Убери чекбоксы \`- [ ]\`, используй обычные пункты \`- \`."); break;
      case "no_verbose_intro":
        out.push("Слишком длинное или водянистое вступление. Оставь 1-3 предложения без штампов."); break;
      case "practical_conclusions_present":
        out.push(`В блоке \`## ${c.title || "Практические выводы"}\` меньше ${Number(c.min_items || 3)} пунктов. Добавь недостающие пункты \`- \`.`); break;
      case "min_tables":
        out.push(`Меньше ${Number(c.min || 1)} markdown-таблиц. Добавь таблицу с шапкой \`| A | B |\` и строкой-разделителем \`|---|---|\`.`); break;
      case "min_faq":
        out.push(`В блоке \`## ${c.title || "FAQ"}\` меньше ${Number(c.min || 10)} вопросов. Добавь недостающие H3 (\`### Вопрос?\`) с ответами.`); break;
      case "min_mistakes":
        out.push(`В блоке \`## ${c.title || "Типичные ошибки"}\` меньше ${Number(c.min || 10)} ошибок. Добавь недостающие H3 с описанием, почему возникает и как избежать.`); break;
      case "min_final_checklist_items":
        out.push(`В финальном чек-листе меньше ${Number(c.min || 20)} пунктов \`- [ ]\`. Добавь недостающие.`); break;
      case "min_questions_count":
        out.push(`Вопросов ${r.details?.n ?? "?"}, нужно минимум ${Number(c.min || 1)}. Добавь недостающие H3 в формате \`### Вопрос?\`.`); break;
      case "max_questions_count":
        out.push(`Вопросов ${r.details?.n ?? "?"}, нужно не больше ${Number(c.max || 0)}. Убери лишние.`); break;
      case "min_answer_word_count":
        out.push(`${r.reason}. Расширь короткие ответы до минимум ${Number(c.min || 30)} слов.`); break;
      case "required_sections":
        out.push(`${r.reason}. Добавь недостающие H2 в правильной последовательности.`); break;
      case "min_metrics_count":
        out.push(`В блоке \`## ${c.section || "Результаты"}\` меньше ${Number(c.min || 3)} метрик. Добавь конкретные цифры: %, ₽, шт, дней и т.д.`); break;
      case "executive_summary_present":
        out.push(`Executive Summary отсутствует или вне ${Number(c.min_words || 300)}-${Number(c.max_words || 600)} слов. Дай сжатый обзор именно в этом объёме.`); break;
      case "key_findings_present":
        out.push(`В блоке \`## ${c.title || "Ключевые выводы"}\` меньше ${Number(c.min || 5)} пунктов. Добавь пронумерованные выводы.`); break;
      case "recommendations_present":
        out.push(`В блоке \`## ${c.title || "Рекомендации"}\` меньше ${Number(c.min || 5)} пунктов. Добавь конкретные рекомендации.`); break;
      case "category_headers_count":
        out.push(`H2-категорий ${r.details?.n ?? "?"}, нужно ${Number(c.min || 1)}-${Number(c.max || 99)}. Приведи количество \`## Категория …\` к целевому.`); break;
      case "items_per_category_min":
        out.push(`${r.reason}. В каждой категории должно быть минимум ${Number(c.min || 3)} H3-элементов.`); break;
      case "toc_present":
        out.push(`Отсутствует блок \`## ${c.title || "Оглавление"}\` или в нём меньше ${Number(c.min_items || 3)} пунктов. Добавь оглавление.`); break;
      case "context_links_count":
        out.push(`Markdown-ссылок вне диапазона ${Number(c.min || 0)}-${Number(c.max || 99)}. Приведи количество \`[текст](url)\` к целевому.`); break;
      default:
        out.push(r.reason || `${r.type}: провал`);
    }
  }
  return out;
}

async function callOpenRouter(opts: { model: string; system: string; user: string; maxTokens: number; signal?: AbortSignal }): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orKey } = await admin.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
  const key = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OpenRouter API key not configured");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: opts.signal,
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

// deno-lint-ignore no-explicit-any
async function finishDocumentJob(admin: any, ctx: BgCtx, status: "completed" | "failed", message: string | null): Promise<void> {
  const patch = {
    status,
    last_error: status === "failed" ? message : null,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (ctx.jobId) {
    await admin.from("document_generation_jobs").update(patch).eq("id", ctx.jobId);
    return;
  }
  await admin
    .from("document_generation_jobs")
    .update(patch)
    .eq("ecosystem_format_id", ctx.formatId)
    .eq("status", "processing");
}

function cleanDomain(raw?: string | null): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "").split("/")[0];
}

// Пробрасывает пользовательские метаданные в блоки PDF-конфига (обложка, CTA).
function mergePdfConfig(cfg: any, md: Record<string, string>): any {
  if (!cfg || typeof cfg !== "object") return cfg;
  const clone = JSON.parse(JSON.stringify(cfg));
  const blocks = Array.isArray(clone.blocks) ? clone.blocks : null;
  if (md.version) clone.version = md.version;
  if (blocks) {
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "cover" || b.type === "cover_expert") {
        if (md.title) b.title = md.title;
        if (md.subtitle) b.subtitle = md.subtitle;
        if (md.category) b.category = md.category;
        if (md.version) b.version = md.version;
      }
      if (b.type === "cta" || b.type === "cta_expert" || b.type === "back_cover") {
        if (md.cta_text) b.text = md.cta_text;
      }
    }
  }
  return clone;
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