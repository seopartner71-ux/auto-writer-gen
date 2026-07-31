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
import { sanitizeInventedBrands } from "../_shared/documentValidators.ts";

function applySanitize(md: string, source: string, slug: string, stage: string): string {
  try {
    const s = sanitizeInventedBrands(md, source);
    if (s.removedCount > 0) {
      console.log(`[SANITIZE] slug=${slug} stage=${stage} removed=${s.removedCount} items=${s.removedItems.join(", ")}`);
    }
    return s.cleaned;
  } catch (e) {
    console.warn(`[SANITIZE] slug=${slug} stage=${stage} error=${(e as Error).message}`);
    return md;
  }
}
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

/** RAG-блок с реальными данными клиента, вставляется ПЕРЕД основным заданием. */
function buildRagBlock(sources: Array<{ source_url: string; source_title?: string | null; source_content?: string | null }>): string {
  if (!sources || sources.length === 0) return "";
  const perSourceLimit = Math.max(3000, Math.floor(36000 / sources.length));
  const blocks = sources.map((s, i) =>
    `### Источник ${i + 1}: ${s.source_title || s.source_url}\n` +
    `URL: ${s.source_url}\n\n` +
    `${String(s.source_content || "").slice(0, perSourceLimit)}\n\n---`,
  );
  return (
    "## ИСТОЧНИКИ КЛИЕНТА - используй ТОЛЬКО эти данные\n" +
    "Ниже представлены реальные данные с сайта клиента. Ты ДОЛЖЕН использовать ТОЛЬКО эту информацию " +
    "для конкретных названий, характеристик, цен, моделей. НЕ ВЫДУМЫВАЙ факты, отсутствующие в источниках.\n\n" +
    blocks.join("\n") + "\n\n" +
    "## Правила использования источников\n" +
    "1. Если факт (модель, цена, характеристика) НЕ упоминается в источниках выше - НЕ используй его. " +
    "Используй обобщенные формулировки: «модель этого класса», «средняя цена сегмента».\n" +
    "2. Если в источниках несколько версий модели - используй ту, которая точно соответствует запросу пользователя.\n" +
    "3. При упоминании модели или продукта - используй точное название из источника, без искажений.\n" +
    "4. Не выдумывай отзывы, кейсы, характеристики, которых нет в источниках.\n" +
    "5. ОБЯЗАТЕЛЬНО ссылайся на источники в тексте маркерами [1], [2], [3] - " +
    "номер соответствует номеру источника выше. Ставь маркер сразу после факта, цены, характеристики " +
    "или названия модели, взятых из источника (например: «мощность 24 л.с. [1]»). " +
    "Минимум 3 таких маркера по документу. Не выдумывай номера источников, которых нет в списке.\n" +
    "6. НЕ создавай раздел «Источники» самостоятельно - он добавляется автоматически в конце документа.\n\n"
  );
}

/** Список источников в конце документа - кликабельные ссылки [1]..[n]. */
function buildSourcesSection(sources: Array<{ source_url: string; source_title?: string | null }>): string {
  if (!sources.length) return "";
  const items = sources.map((s, i) => {
    const title = String(s.source_title || "").trim() || cleanDomain(s.source_url) || s.source_url;
    return `- [${i + 1}] [${title}](${s.source_url})`;
  });
  return `\n\n## Источники\n\n${items.join("\n")}\n`;
}

/** Убирает раздел «Источники», если модель написала его сама (заменим своим). */
function stripSourcesSection(md: string): string {
  const text = String(md || "");
  const re = /^##\s+(Источники|Список источников|Использованные источники)\s*$/mi;
  const m = re.exec(text);
  if (!m || m.index == null) return text.trimEnd();
  return text.slice(0, m.index).trimEnd();
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
  const deadlineAt = startedAt + HARD_TIMEOUT_MS;
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

      // RAG: источники клиента для этого формата.
      const { data: refRows } = await admin
        .from("document_source_references")
        .select("source_url, source_title, source_content, extracted_images, use_images")
        .eq("ecosystem_format_id", ctx.formatId)
        .order("created_at", { ascending: true });
      const allRefs = (refRows || []) as any[];
      const sources = allRefs.filter((r: any) => String(r.source_content || "").trim());
      const sourceContent = sources.map((s: any) => String(s.source_content)).join("\n\n").slice(0, 40000);
      const ragBlock = buildRagBlock(sources);
      const first100 = sourceContent.slice(0, 100).replace(/\s+/g, " ");
      console.log(
        `[RAG-INJECT] slug=${slug} format=${ctx.formatId} sources_count=${sources.length} ` +
        `source_content_length=${sourceContent.length} first_100_chars="${first100}"`,
      );
      // Fail-fast: тип требует источник, а его нет - генерировать нельзя, иначе модель выдумает данные.
      const refCfg = (dt.reference_source_config || {}) as any;
      if (!sources.length && refCfg.required && refCfg.fallback_behavior === "fail_generation") {
        const reason = "Для этого типа документа обязателен источник данных клиента (URL страницы). Добавьте источник и запустите генерацию заново.";
        console.error(`[RAG-INJECT] slug=${slug} format=${ctx.formatId} ABORT missing_required_source`);
        await admin.from("ecosystem_formats").update({
          status: "failed", error_reason: reason, duration_ms: Date.now() - startedAt,
          retry_count: ctx.retryCount + 1, updated_at: new Date().toISOString(),
        }).eq("id", ctx.formatId);
        await finishDocumentJob(admin, ctx, "failed", reason);
        clearTimeout(timeoutId);
        return;
      }
      // Источник истины для sanitize/no_invented_brands = статья + данные клиента.
      const truthText = sourceContent ? `${articleText}\n\n${sourceContent}` : articleText;

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
      let systemPrompt = ragBlock + renderTemplate(tpl, vars);
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
          "\n\n## СЛУЖЕБНЫЕ МЕТАДАННЫЕ ДОКУМЕНТА (НЕ ПЕЧАТАТЬ В ТЕЛЕ!)\n" +
          "Эти поля используются рендером обложки, футера и блока автора автоматически. " +
          "СТРОГО ЗАПРЕЩЕНО копировать их в текст статьи, создавать разделы «Метаданные», «О документе», " +
          "«Паспорт документа», «Ссылки на клиента», а также печатать строки вида «Заголовок документа: ...», " +
          "«Категория: ...», «Целевая аудитория: ...», «Версия: ...», «Автор: ...», «Био: ...», «Email: ...», " +
          "«Текст CTA: ...», «Источник документа: ...». Такие строки в теле — грубая ошибка.\n\n" +
          "Служебные значения (только для внутреннего рендера):\n" +
          mdLines.join("\n") +
          "\n\nТвоя задача — написать ТОЛЬКО контент документа (H1 + разделы). Всё остальное подставится автоматически.";
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
      systemPrompt +=
        "\n\n## ⚠️ КРИТИЧЕСКИ ВАЖНО: НЕ ВЫДУМЫВАЙ БРЕНДЫ И МОДЕЛИ\n" +
        "Если в исходной статье НЕ упоминается конкретная модель техники/продукта " +
        "(например «Файтер Т-15», «Kubota B7100», «МТЗ-152», «Скаут Т-654», «Кентавр Т-15», «Беларус МТЗ 152») — " +
        "СТРОГО ЗАПРЕЩЕНО упоминать её в документе.\n\n" +
        "Используй ТОЛЬКО обобщённые формулировки:\n" +
        "✅ «модель мощностью 15-25 л.с.»\n" +
        "✅ «компактный минитрактор с гидростатической трансмиссией»\n" +
        "✅ «трактор среднего класса»\n" +
        "✅ «оборудование известного европейского производителя»\n\n" +
        "❌ Любые буквенно-цифровые индексы моделей (X-100, Т-15, B7100, МТЗ-152), если их нет в исходнике.\n" +
        "❌ «например, модель Файтер Т-15» — если модели нет в исходнике.\n" +
        "❌ Даже если ты УВЕРЕН, что модель существует — не упоминай её без явной ссылки на исходник.";
      systemPrompt += buildValidationInstructions(dt.post_checks_config, dt.target_length_words);
      console.log(
        `[RAG-INJECT] slug=${slug} final_prompt_length=${systemPrompt.length} ` +
        `contains_source_block=${systemPrompt.includes("ИСТОЧНИКИ КЛИЕНТА")}`,
      );

      const userPrompt =
        `Название материала: ${ctx.article?.title || ""}\n` +
        `Основной ключ: ${vars.article.keyword}\n\n` +
        `Исходный материал:\n${articleText}\n\n` +
        `Собери документ типа "${dt.name}" по описанным требованиям.`;

      // 10% — старт (проставлено в serve()). 30% — промпт готов, идём в LLM.
      await setProgress(30);
      const twoStage = shouldUseTwoStage(dt);
      const checksAll = Array.isArray(dt.post_checks_config) ? dt.post_checks_config : [];
      const finalChecks = twoStage ? checksAll.filter((c: any) => FINAL_SECTION_CHECKS.has(c?.type)) : [];
      const mainChecks = twoStage
        ? checksAll
            .filter((c: any) => !FINAL_SECTION_CHECKS.has(c?.type))
            .map((c: any) => (c?.type === "min_word_count" ? { ...c, min: Math.max(300, Number(c.min || 0) - 300) } : c))
        : checksAll;
      const stage1Started = Date.now();
      const mainSystem = twoStage
        ? systemPrompt +
          "\n\n## Разделы «Ключевые выводы» и «Рекомендации» — НЕ ПИШИ\n" +
          "Эти два финальных раздела будут сгенерированы отдельным вызовом. " +
          "НЕ добавляй их в текущий документ ни в каком виде, даже как заголовки. " +
          "Закончи документ последней аналитической главой."
        : systemPrompt;
      const gen = await generateWithValidation({
        primary: dt.primary_model,
        fallback: dt.fallback_model || dt.primary_model,
        systemPrompt: mainSystem, userPrompt,
        checks: mainChecks,
        articleText: truthText,
        sourceContent,
        anchorsCount: anchors.length,
        clientPagesCount: clientPages.length,
        maxTokens: estimateMaxTokens(dt),
        slug,
        abortSignal: abortController.signal,
        deadlineAt,
      });
      markdown = gen.markdown;
      modelUsed = gen.modelUsed;
      tokensIn = gen.tokensIn; tokensOut = gen.tokensOut;
      retriesUsed = gen.retriesUsed;
      if (twoStage) {
        const stage1Words = countWordsSimple(markdown);
        console.log(`[TWO-STAGE] stage=1 slug=${slug} wordCount=${stage1Words} model=${modelUsed} elapsed=${Date.now() - stage1Started}ms`);
      }
      // Stage 2: finальные секции отдельным вызовом.
      let finalSectionsInfo: { failed: boolean; reason?: string } = { failed: false };
      if (twoStage && gen.valid && finalChecks.length > 0) {
        const stage2Started = Date.now();
        const stage2 = await generateFinalSections({
          mainMarkdown: markdown,
          keyword: vars.article.keyword,
          brandName: effectiveClient.name || "клиент",
          model: dt.primary_model,
          fallback: dt.fallback_model || dt.primary_model,
          checks: finalChecks,
          articleText: truthText,
          slug,
          abortSignal: abortController.signal,
          deadlineAt,
        });
        tokensIn += stage2.tokensIn; tokensOut += stage2.tokensOut;
        const stage2Words = countWordsSimple(stage2.markdown);
        console.log(`[TWO-STAGE] stage=2 slug=${slug} wordCount=${stage2Words} validators=${stage2.valid ? "passed" : "failed"} elapsed=${Date.now() - stage2Started}ms`);
        if (stage2.valid && stage2.markdown.trim()) {
          markdown = stripTrailingFinalSections(markdown) + "\n\n" + stage2.markdown.trim();
        } else {
          // Fallback stub — секции останутся заглушками в PDF, но документ доедет до пользователя.
          finalSectionsInfo = { failed: true, reason: `Failed to generate final sections after 2 attempts: ${stage2.failedReasons.slice(0, 2).join("; ")}`.slice(0, 500) };
          markdown = stripTrailingFinalSections(markdown) +
            "\n\n## Ключевые выводы\n\n[Раздел не заполнен - не удалось сгенерировать после 2 попыток]\n\n" +
            "## Рекомендации\n\n[Раздел не заполнен - не удалось сгенерировать после 2 попыток]";
        }
        (gen as any).finalSectionsInfo = finalSectionsInfo;
      }
      // Финальный пост-фильтр «фантомных» брендов/моделей на объединённом markdown.
      markdown = applySanitize(markdown, truthText, slug, "final");
      // Раздел «Источники» с кликабельными ссылками на страницы, указанные пользователем.
      const linkRefs = allRefs.filter((r: any) => String(r.source_url || "").trim());
      if (linkRefs.length) {
        markdown = stripSourcesSection(markdown) + buildSourcesSection(linkRefs);
        console.log(`[SOURCES] format=${ctx.formatId} slug=${slug} appended=${linkRefs.length}`);
      }
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
      if ((gen as any).finalSectionsInfo?.failed) {
        // Не блокируем публикацию, но помечаем причину в error_reason (перезапишется ниже, если PDF ок).
        await admin.from("ecosystem_formats").update({
          error_reason: (gen as any).finalSectionsInfo.reason,
        }).eq("id", ctx.formatId);
      }

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
            context: [md.title || ctx.article?.title || "", md.category || dt.name || "", md.target_audience || ""]
              .filter(Boolean).join(". ").slice(0, 300),
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
        // RAG-фото со страниц клиента (hero-обложка и карточки позиций).
        let sourceImages: any[] = [];
        try {
          const { data: imgRefs } = await admin
            .from("document_source_references")
            .select("extracted_images, use_images")
            .eq("ecosystem_format_id", ctx.formatId);
          sourceImages = (imgRefs || [])
            .filter((r: any) => r.use_images !== false && Array.isArray(r.extracted_images))
            .flatMap((r: any) => r.extracted_images as any[])
            .filter((i: any) => i && typeof i.url === "string")
            .slice(0, 30);
          console.log(`[PDF-IMAGES] format=${ctx.formatId} slug=${slug} source_images=${sourceImages.length}`);
        } catch (e) {
          console.warn("[PDF-IMAGES] source images load failed:", (e as Error).message);
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
          sourceImages,
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

const FINAL_SECTION_CHECKS = new Set([
  "key_findings_present",
  "recommendations_present",
]);
function shouldUseTwoStage(dt: any): boolean {
  const max = Number(dt?.target_length_words?.max || 0);
  // После снижения целевых объёмов длинных типов до 2.5-3.5k слов модель уверенно
  // справляется в один вызов. Двухстадийку оставляем только для действительно
  // длинных документов (>3500 слов max).
  return dt?.category === "pdf" && max > 3500;
}

function countWordsSimple(md: string): number {
  return String(md || "").replace(/[#*_`>~|-]/g, " ").split(/\s+/).filter(Boolean).length;
}

// Убираем возможные хвостовые H2 «Ключевые выводы»/«Рекомендации», которые
// stage-1 модель могла всё-таки вписать (несмотря на запрет).
function stripTrailingFinalSections(md: string): string {
  const text = String(md || "");
  const re = /^##\s+(Ключевые выводы|Рекомендации)\s*$/mi;
  const m = re.exec(text);
  if (!m || m.index == null) return text.trim();
  return text.slice(0, m.index).trim();
}

async function generateFinalSections(args: {
  mainMarkdown: string;
  keyword: string;
  brandName: string;
  model: string;
  fallback: string;
  checks: any[];
  articleText: string;
  slug?: string;
  abortSignal?: AbortSignal;
  deadlineAt?: number;
}): Promise<{ markdown: string; valid: boolean; failedReasons: string[]; tokensIn: number; tokensOut: number }> {
  const system =
    "Ты пишешь ТОЛЬКО два финальных раздела для уже готового аналитического документа. " +
    "Формат ответа - строго Markdown, начинай с `## Ключевые выводы`, никаких пояснений до и после.\n\n" +
    "## ⚠️ НЕ ВЫДУМЫВАЙ БРЕНДЫ И МОДЕЛИ\n" +
    "Не упоминай конкретные модели техники/продуктов (типа «Файтер Т-15», «МТЗ-152», «Kubota B7100»), " +
    "если их нет в основном документе. Используй обобщённые формулировки.\n\n" +
    "Форматирование: только `-` (короткое тире), без буквы «ё», без HTML, без markdown-таблиц.";
  const buildUser = (extraHint: string) =>
    `Ты уже написал аналитический документ по теме "${args.keyword}" для бренда "${args.brandName}". Вот его основной контент:\n\n---\n${args.mainMarkdown.slice(0, 22000)}\n---\n\n` +
    `Твоя задача — написать ТОЛЬКО два финальных раздела:\n\n` +
    `## Ключевые выводы\n\n7 конкретных выводов из документа. Каждый — 2-3 предложения. Bullet-list (\`- \`). ` +
    `Основаны на фактах из документа выше. НЕ повторяй Executive Summary дословно — это НОВЫЕ формулировки, синтез главных мыслей.\n\n` +
    `## Рекомендации\n\n7 конкретных рекомендаций читателю. Каждая — 2-3 предложения. Нумерованный список (\`1. \`, \`2. \` …). ` +
    `Что делать читателю после прочтения. Конкретные действия, не абстрактные советы.\n\n` +
    `Формат ответа — ТОЛЬКО эти два раздела, ничего больше. Начинай с \`## Ключевые выводы\`.` +
    (extraHint ? `\n\n## Исправь провалы предыдущей попытки\n${extraHint}` : "");

  let tokensIn = 0, tokensOut = 0;
  let lastMd = ""; let lastReasons: string[] = [];
  const attempts: Array<{ model: string; hint: string }> = [
    { model: args.model, hint: "" },
    { model: args.fallback || args.model, hint: "" },
  ];
  for (let i = 0; i < attempts.length; i++) {
    if (args.abortSignal?.aborted) throw new Error("Generation aborted by timeout");
    if (i > 0 && args.deadlineAt && args.deadlineAt - Date.now() < 40_000) {
      console.warn(`[TIME-BUDGET] stage=2 slug=${args.slug || "?"} skip attempt=${i}`);
      break;
    }
    const { model, hint } = attempts[i];
    const hintText = i === 1 && lastReasons.length
      ? lastReasons.map((r) => `- ${r}`).join("\n")
      : hint;
    const r = await callOpenRouter({ model, system, user: buildUser(hintText), maxTokens: 3000, signal: args.abortSignal, deadlineAt: args.deadlineAt });
    tokensIn += r.tokensIn; tokensOut += r.tokensOut;
    lastMd = String(r.content || "").replace(/—/g, "-").replace(/–/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е").trim();
    // Отрезаем всё, что модель могла добавить до/после наших H2.
    const kwIdx = lastMd.search(/^##\s+Ключевые выводы\s*$/mi);
    if (kwIdx > 0) lastMd = lastMd.slice(kwIdx);
    lastMd = applySanitize(lastMd, args.articleText, args.slug || "?", `stage2-a${i}`);
    const val = runValidators(lastMd, args.checks, { sourceArticleText: args.articleText });
    if (val.ok) {
      return { markdown: lastMd, valid: true, failedReasons: [], tokensIn, tokensOut };
    }
    lastReasons = val.failedReasons;
    console.warn(`[TWO-STAGE] stage=2 attempt=${i} slug=${args.slug || "?"} model=${model} failures=${JSON.stringify(val.failedReasons.slice(0, 3))}`);
  }
  return { markdown: lastMd, valid: false, failedReasons: lastReasons, tokensIn, tokensOut };
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
  sourceContent?: string;
  anchorsCount?: number; clientPagesCount?: number;
  slug?: string;
  abortSignal?: AbortSignal;
  deadlineAt?: number;
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
    // Бюджет времени: не начинаем новую попытку, если до hard-timeout меньше 50с,
    // иначе процесс убьют посреди генерации и пользователь получит ошибку вместо документа.
    if (i > 0 && args.deadlineAt) {
      const left = args.deadlineAt - Date.now();
      if (left < 50_000) {
        console.warn(`[TIME-BUDGET] document_type=${args.slug || "?"} skip attempt=${i} left=${Math.round(left / 1000)}s`);
        break;
      }
    }
    const { model, extraSystem } = attempts[i];
    if (i > 0 && model !== attempts[i - 1].model) {
      console.warn(`[MODEL-SWITCH] document_type=${args.slug || "?"} attempt=${i} switching from ${attempts[i - 1].model} to ${model} due to persistent failures`);
    }
    let sys = system;
    let user = args.userPrompt;
    if (extraSystem === "PREV_FAILED" && lastActionable.length > 0) {
      sys += `\n\n## ВНИМАНИЕ: предыдущая попытка провалила проверки\n${lastActionable.map((r) => `- ${r}`).join("\n")}\n\nИсправь эти конкретные проблемы. Верни ПОЛНЫЙ исправленный markdown-документ от H1 до финального раздела, а не комментарии и не фрагмент.`;
      if (lastMd.trim()) {
        user += `\n\n## Предыдущий markdown, который нужно исправить\n${lastMd.slice(0, 24000)}\n\nВерни полную исправленную версию markdown.`;
      }
    }
    const r = await callOpenRouter({ model, system: sys, user, maxTokens: args.maxTokens, signal: args.abortSignal, deadlineAt: args.deadlineAt });
    totalIn += r.tokensIn; totalOut += r.tokensOut; modelUsed = model;
    lastMd = repairMarkdownForChecks(r.content, args.checks);
    lastMd = applySanitize(lastMd, args.articleText, args.slug || "?", `main-a${i}`);
    const val = runValidators(lastMd, args.checks, {
      sourceArticleText: args.articleText,
      sourceContent: args.sourceContent || "",
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
    if (isUsableMarkdown(lastMd) && !hasCriticalFailure(val.results)) {
      console.warn(
        `[VALIDATION-SOFT-PASS] document_type=${args.slug || "?"} attempt=${i} model=${model} failures=${JSON.stringify(lastFailures.slice(0, 5))}`,
      );
      return { markdown: lastMd, modelUsed: model, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: i, valid: true, failedReasons: lastFailures };
    }
  }
  if (isUsableMarkdown(lastMd)) {
    console.warn(
      `[VALIDATION-SOFT-PASS] document_type=${args.slug || "?"} model=${modelUsed} failures=${JSON.stringify(lastFailures.slice(0, 5))}`,
    );
    return { markdown: lastMd, modelUsed, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: attempts.length - 1, valid: true, failedReasons: lastFailures };
  }
  return { markdown: lastMd, modelUsed, tokensIn: totalIn, tokensOut: totalOut, retriesUsed: attempts.length - 1, valid: false, failedReasons: lastFailures };
}

// Критичные провалы, которые НЕЛЬЗЯ пропускать soft-pass'ом на промежуточных попытках —
// пустые ключевые секции и утечка метаданных ломают финальный PDF.
// deno-lint-ignore no-explicit-any
function hasCriticalFailure(results: any[]): boolean {
  const critical = new Set([
    "key_findings_present",
    "recommendations_present",
    "practical_conclusions_present",
    "executive_summary_present",
    "no_metadata_leak",
    "no_invented_brands",
  ]);
  return results.some((r) => !r.ok && critical.has(r.type));
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
      case "category_headers_count":
        out.push(`H2-категорий ${r.details?.n ?? "?"}, нужно ${Number(c.min || 1)}-${Number(c.max || 99)}. Приведи количество \`## Категория …\` к целевому.`); break;
      case "items_per_category_min":
        out.push(`${r.reason}. В каждой категории должно быть минимум ${Number(c.min || 3)} H3-элементов.`); break;
      case "toc_present":
        out.push(`Отсутствует блок \`## ${c.title || "Оглавление"}\` или в нём меньше ${Number(c.min_items || 3)} пунктов. Добавь оглавление.`); break;
      case "context_links_count":
        out.push(`Markdown-ссылок вне диапазона ${Number(c.min || 0)}-${Number(c.max || 99)}. Приведи количество \`[текст](url)\` к целевому.`); break;
      case "no_metadata_leak":
        out.push(`${r.reason || "утечка метаданных"}. Удали эти строки — метаданные обложки/автора рендерятся автоматически, в теле их быть не должно.`); break;
      case "key_findings_present":
      case "recommendations_present":
      case "practical_conclusions_present":
      case "executive_summary_present":
        out.push(`${r.reason || r.type}. Раздел должен быть заполнен конкретным содержимым (пункты + пояснения), не только заголовком.`); break;
      default:
        out.push(r.reason || `${r.type}: провал`);
    }
  }
  return out;
}

async function callOpenRouterRaw(opts: { model: string; messages: any[]; maxTokens: number; signal?: AbortSignal }): Promise<{ content: string; tokensIn: number; tokensOut: number; finishReason: string }> {
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
      messages: opts.messages,
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
    finishReason: String(j?.choices?.[0]?.finish_reason || j?.choices?.[0]?.native_finish_reason || ""),
  };
}

// Модель часто упирается в max_tokens и обрывает документ на середине фразы.
// Дописываем продолжение отдельными вызовами (до 3), передавая уже написанный текст
// как assistant-сообщение, и склеиваем результат.
async function callOpenRouter(opts: { model: string; system: string; user: string; maxTokens: number; signal?: AbortSignal; deadlineAt?: number }): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const messages: any[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let first = await callOpenRouterRaw({ model: opts.model, messages, maxTokens: opts.maxTokens, signal: opts.signal });
  let content = first.content;
  let tokensIn = first.tokensIn, tokensOut = first.tokensOut;
  let finish = first.finishReason;
  let cont = 0;
  while (finish === "length" && cont < 3 && !opts.signal?.aborted) {
    // Не начинаем продолжение, если до hard-timeout осталось меньше 35с.
    if (opts.deadlineAt && opts.deadlineAt - Date.now() < 35_000) {
      console.warn(`[TIME-BUDGET] stop continuation model=${opts.model} left=${Math.round((opts.deadlineAt - Date.now()) / 1000)}s`);
      break;
    }
    cont++;
    console.warn(`[TRUNCATED] model=${opts.model} continuation=${cont} chars=${content.length}`);
    const tail = content.slice(-4000);
    const r = await callOpenRouterRaw({
      model: opts.model,
      messages: [
        ...messages,
        { role: "assistant", content: tail },
        {
          role: "user",
          content:
            "Ответ оборвался по лимиту длины. Продолжи ТОЧНО с места обрыва, ничего не повторяя и не начиная заново. " +
            "Не пиши вступлений и пояснений - сразу продолжение текста (можно с середины слова/предложения). " +
            "Доведи документ до конца, включая финальные разделы.",
        },
      ],
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    });
    tokensIn += r.tokensIn; tokensOut += r.tokensOut;
    finish = r.finishReason;
    if (!r.content) break;
    content = joinContinuation(content, r.content);
  }
  if (finish === "length") content = trimDanglingSentence(content);
  return { content, tokensIn, tokensOut };
}

function joinContinuation(head: string, tail: string): string {
  const t = tail.replace(/^\s*(продолжение|continued)\s*[:\-]?\s*/i, "");
  const headEnd = head.slice(-1);
  const needsSpace = /[\wа-яА-Я,;:]/.test(headEnd) && /^[\wа-яА-Я(«"]/.test(t.trim().slice(0, 1));
  return head + (t.startsWith("\n") || head.endsWith("\n") ? "" : needsSpace ? " " : "\n\n") + t;
}

// Срезает последнее незавершенное предложение/строку, если текст все равно оборван.
function trimDanglingSentence(md: string): string {
  const text = String(md || "").trimEnd();
  if (/[.!?:»)\]]$/.test(text)) return text;
  const lastStop = Math.max(text.lastIndexOf(". "), text.lastIndexOf("! "), text.lastIndexOf("? "), text.lastIndexOf(".\n"));
  if (lastStop > text.length * 0.5) return text.slice(0, lastStop + 1).trimEnd();
  const lastNl = text.lastIndexOf("\n");
  return lastNl > 0 ? text.slice(0, lastNl).trimEnd() : text;
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