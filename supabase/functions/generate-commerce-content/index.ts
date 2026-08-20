// Commerce Content Engine.
//
// Chain: DATA -> SEMANTICS -> STRUCTURE -> CONTENT GENERATION -> SAVE.
// Rendering / QA / deploy happen elsewhere and only read what is saved here.
//
// Additive: writes only to seo_content / content_status on existing rows and
// to the new target columns of site_keywords. Nothing else is touched.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";
import { resolveOpenRouterModel, getProjectAiModel } from "../_shared/aiModel.ts";
import {
  buildKeywordCoverage, buildFallbackContent, normalizeSeoContent, contentWordCount,
  isContentThin, MIN_WORDS, type ContentContext, type PageKind, type SeoContent, type TargetEntity,
} from "../_shared/commerceContent.ts";
import {
  readCommercialProfile, profileFacts, profileCoverage,
  productCoverage, serviceCoverage,
} from "../_shared/commercialProfile.ts";
import { contentRequirements } from "../_shared/pageQuality.ts";
import type { PdePageType } from "../_shared/pageDecision.ts";

const CONTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["seo_title", "seo_description", "h1", "intro", "body", "faq", "entities", "semantic_terms"],
  properties: {
    seo_title: { type: "string" },
    seo_description: { type: "string" },
    h1: { type: "string" },
    intro: { type: "string" },
    body: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["heading", "text"],
        properties: { heading: { type: "string" }, text: { type: "string" } },
      },
    },
    faq: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["q", "a"],
        properties: { q: { type: "string" }, a: { type: "string" } },
      },
    },
    entities: { type: "array", items: { type: "string" } },
    semantic_terms: { type: "array", items: { type: "string" } },
  },
} as const;

function sysPrompt(kind: PageKind, lang: string, ctx?: ContentContext): string {
  const ru = lang !== "en";
  const role = ru
    ? "Ты коммерческий SEO-редактор. Пишешь полезные тексты для страниц коммерческого сайта."
    : "You are a commercial SEO editor writing useful copy for a commercial site.";
  const rules = ru
    ? [
        "Пиши ТОЛЬКО по фактам из входных данных. Запрещено выдумывать цены, сроки, характеристики, сертификаты, наличие, доставку, гарантию, отзывы, клиентов и бренды.",
        "Если факта нет во входных данных - не упоминай его вообще. Лучше короче, но правдиво.",
        "Условия доставки, оплаты, гарантии и CTA бери дословно по смыслу из блока company_profile, ничего не добавляя от себя.",
        "Никакой воды и рекламных штампов.",
        "Не используй символ длинного тире, только короткий дефис.",
        "Не используй букву 'е' с двумя точками.",
        "Не используй markdown и жирный текст.",
        "FAQ - только вопросы, на которые есть ответ во входных данных.",
        "Не повторяй один и тот же тезис в разных блоках.",
      ]
    : [
        "Use only the facts given. Never invent prices, lead times, specs, certificates, stock, delivery, warranty, reviews or brands.",
        "If a fact is absent, do not mention it at all.",
        "Delivery, payment, warranty and CTA must come from company_profile only.",
        "No filler and no marketing cliches. Use short hyphens only, no em dashes. No markdown, no bold.",
        "FAQ answers must be grounded in the given data. Do not repeat the same point twice.",
      ];
  const size: Record<PageKind, string> = {
    product: ru ? "3-4 блока по 60-90 слов и 3 вопроса FAQ. Суммарно не меньше 200 слов." : "3-4 blocks of 60-90 words and 3 FAQ items, 200+ words total.",
    service: ru ? "4 блока по 70-100 слов и 3 вопроса FAQ. Суммарно не меньше 250 слов." : "4 blocks of 70-100 words and 3 FAQ items, 250+ words total.",
    category: ru ? "Ровно 3-4 блока по 80-110 слов и 3 вопроса FAQ. Суммарно не меньше 260 слов." : "3-4 blocks of 80-110 words and 3 FAQ items, 260+ words total.",
    hub: ru ? "3-4 блока по 90-120 слов и 3 вопроса FAQ. Суммарно не меньше 300 слов." : "3-4 blocks of 90-120 words and 3 FAQ items, 300+ words total.",
    informational: ru
      ? "5-6 блоков по 110-150 слов и 3-4 вопроса FAQ. Суммарно не меньше 650 слов. Это полезный материал по теме, а не рекламная простыня."
      : "5-6 blocks of 110-150 words and 3-4 FAQ items, 650+ words total. Useful editorial content, not an ad.",
    article: ru ? "3-4 блока." : "3-4 blocks.",
  };
  const intent: Record<PageKind, string> = {
    product: ru ? "Задача: помочь выбрать конкретную позицию по ее параметрам и объяснить порядок заказа." : "Goal: help pick this item by its specs and explain how to order.",
    service: ru ? "Задача: объяснить состав услуги, процесс работы, сроки, порядок расчета и результат." : "Goal: explain scope, process, timing, pricing method and outcome.",
    category: ru ? "Задача: закрыть интент категории и помочь с подбором, а не пересказывать карточки товаров." : "Goal: satisfy the category intent and guide selection, never repeat product cards.",
    hub: ru ? "Задача: объяснить тему всего направления, связи между разделами и вести в категории." : "Goal: explain the whole section, its structure and route to categories.",
    informational: ru ? "Задача: дать по теме реальную пользу - разбор, критерии, ошибки, ответы. Коммерция только как уместная ссылка." : "Goal: deliver real informational value; commerce only as a relevant link.",
    article: ru ? "Информационная страница." : "Informational page.",
  };
  const req = (ctx?.requirements || []).filter((r) => r.level === "required");
  const reqLine = req.length
    ? (ru
        ? `\nСтраница проверяется автоматически. Обязательно раскрой по фактам: ${req.map((r) => r.name).join(", ")}. Если фактов для пункта нет - пропусти его, не выдумывай.`
        : `\nThe page is auto-checked. Cover, factually: ${req.map((r) => r.name).join(", ")}. Skip anything you have no data for.`)
    : "";
  const missing = (ctx?.missingData || []);
  const missLine = missing.length
    ? (ru
        ? `\nОтсутствующие данные (НЕ упоминать и НЕ придумывать): ${missing.join(", ")}.`
        : `\nMissing data (never mention, never invent): ${missing.join(", ")}.`)
    : "";
  const lengthRule = ru
    ? "Каждый блок body - связный абзац не короче 60 слов."
    : "Every body block is a coherent paragraph of at least 60 words.";
  return `${role}\n${intent[kind]}\n${size[kind]}\n${rules.map((r) => `- ${r}`).join("\n")}\n- ${lengthRule}${reqLine}${missLine}\nseo_title <= 65 символов, seo_description <= 158.`;
}

function userPrompt(ctx: ContentContext): string {
  const facts: Record<string, unknown> = {
    page_type: ctx.pageType || ctx.kind,
    kind: ctx.kind,
    name: ctx.name,
    site: ctx.siteName,
    brand: ctx.brand || undefined,
    sku: ctx.sku || undefined,
    price: ctx.price || undefined,
    availability: ctx.availability || undefined,
    description: ctx.description || undefined,
    characteristics: ctx.characteristics || undefined,
    benefits: ctx.benefits?.length ? ctx.benefits : undefined,
    service: ctx.serviceMeta && Object.keys(ctx.serviceMeta).length ? ctx.serviceMeta : undefined,
    silo: ctx.siloName || undefined,
    category: ctx.categoryName || undefined,
    children: ctx.childNames?.slice(0, 12),
    primary_keywords: ctx.primaryKeywords,
    secondary_keywords: ctx.secondaryKeywords,
    city: ctx.city || undefined,
    company_profile: ctx.profile && Object.keys(ctx.profile).length ? ctx.profile : undefined,
  };
  return `ДАННЫЕ СТРАНИЦЫ (только эти факты):\n${JSON.stringify(facts, null, 1)}`;
}

interface Row { id: string; [k: string]: any }

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const admin = adminClient();

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    const scope: string = body.scope || "all"; // all | products | categories | hubs | semantics
    const limit: number = Math.min(Number(body.limit || 40), 60);
    const force = !!body.force;
    // Regenerate pages that already have content but are thin or fallback-made
    // without touching the pages that are already ready.
    const includeThin = !!body.include_thin;
    const dryRun = !!body.dry_run;
    const bridgeLegacy = body.bridge_legacy !== false;
    if (!projectId) return errorResponse("project_id required", 400);

    const { data: project } = await admin
      .from("projects")
      .select("id, user_id, name, site_name, site_about, language, company_phone, company_address, region, ai_model")
      .eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("Project not found", 404);
    if (project.user_id !== auth.userId && !auth.isQueueCall) {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", auth.userId);
      const isAdmin = (roles || []).some((r: any) => r.role === "admin" || r.role === "staff");
      if (!isAdmin) return errorResponse("Forbidden", 403);
    }

    const lang = project.language === "en" ? "en" : "ru";
    const siteName = project.site_name || project.name;

    // ---- load structure ----------------------------------------------------
    const [{ data: silos }, { data: clusters }, { data: products }] = await Promise.all([
      admin.from("site_silos").select("id, name, slug, description, status, seo_content, content_status")
        .eq("project_id", projectId).neq("status", "archived"),
      admin.from("site_clusters").select("id, silo_id, parent_id, name, slug, description, status, seo_content, content_status")
        .eq("project_id", projectId).neq("status", "archived"),
      admin.from("site_products")
        .select("id, silo_id, site_cluster_id, sku, name, brand, price, currency, availability, description, characteristics, kind, status, seo_content, content_status")
        .eq("project_id", projectId).neq("status", "archived"),
    ]);
    const siloRows = (silos || []) as Row[];
    const clusterRows = (clusters || []) as Row[];
    const productRows = (products || []) as Row[];

    // ---- semantics bridge (legacy keywords -> site_keywords) ---------------
    let bridged = 0;
    if (bridgeLegacy) {
      const { data: legacy } = await admin
        .from("keywords")
        .select("id, seed_keyword, intent, lsi_keywords")
        .eq("user_id", project.user_id)
        .limit(500);
      const { data: existing } = await admin
        .from("site_keywords").select("keyword, source_keyword_id").eq("project_id", projectId);
      const have = new Set((existing || []).map((k: any) => String(k.keyword).toLowerCase()));
      const toAdd = (legacy || [])
        .filter((k: any) => k.seed_keyword && !have.has(String(k.seed_keyword).toLowerCase()))
        .map((k: any) => ({
          project_id: projectId,
          keyword: k.seed_keyword,
          intent: k.intent || null,
          source_keyword_id: k.id,
          status: "active",
        }));
      if (toAdd.length && !dryRun) {
        for (let i = 0; i < toAdd.length; i += 200) {
          await admin.from("site_keywords").insert(toAdd.slice(i, i + 200));
        }
      }
      bridged = toAdd.length;
    }

    const { data: kwRows } = await admin
      .from("site_keywords").select("id, keyword, frequency, intent, silo_id, site_cluster_id")
      .eq("project_id", projectId).limit(2000);

    // ---- coverage ----------------------------------------------------------
    const entities: TargetEntity[] = [
      ...siloRows.map((s) => ({ id: s.id, kind: "hub" as PageKind, name: s.name, text: s.description || "", silo_id: s.id })),
      ...clusterRows.map((c) => ({ id: c.id, kind: "category" as PageKind, name: c.name, text: c.description || "", silo_id: c.silo_id, cluster_id: c.id })),
      ...productRows.map((p) => ({
        id: p.id,
        kind: (p.kind === "service" ? "service" : "product") as PageKind,
        name: p.name,
        text: [p.brand, p.sku, p.description, Object.entries(p.characteristics || {}).map(([k, v]) => `${k} ${v}`).join(" ")]
          .filter(Boolean).join(" "),
        silo_id: p.silo_id, cluster_id: p.site_cluster_id,
      })),
    ];
    const coverage = buildKeywordCoverage((kwRows || []) as any[], entities);

    if (!dryRun) {
      for (const a of coverage.assignments) {
        await admin.from("site_keywords").update({
          target_type: a.target_type, target_id: a.target_id,
          role: a.role, coverage_status: a.coverage_status,
        }).eq("id", a.keyword_id);
      }
    }

    if (scope === "semantics") {
      return jsonResponse({
        ok: true, bridged,
        coverage: {
          total: coverage.total, covered: coverage.covered, uncovered: coverage.uncovered,
          conflict: coverage.conflict, duplicate_intent: coverage.duplicate_intent,
        },
      });
    }

    // ---- content generation ------------------------------------------------
    const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
    const model = resolveOpenRouterModel(await getProjectAiModel(admin, projectId));
    const clusterById = new Map(clusterRows.map((c) => [c.id, c]));
    const siloById = new Map(siloRows.map((s) => [s.id, s]));

    const kwOf = (id: string) => {
      const arr = coverage.byTarget.get(id) || [];
      return {
        primary: arr.filter((a) => a.role === "primary").map((a) => a.keyword),
        secondary: arr.filter((a) => a.role !== "primary").map((a) => a.keyword),
      };
    };

    type Job = { table: string; row: Row; ctx: ContentContext; priority: number };
    const jobs: Job[] = [];

    const wants = (k: string) => scope === "all" || scope === k;
    // 0 - never generated, 1 - fallback text, 2 - thin, ready pages are skipped
    const jobPriority = (row: Row): number | null => {
      const status = row.content_status;
      const byFallback = (row.seo_content as any)?.generated_by === "fallback";
      if (!status || status === "pending" || !row.seo_content) return 0;
      if (force) return byFallback ? 1 : status === "thin" ? 2 : 3;
      if (byFallback) return includeThin ? 1 : null;
      if (status === "thin") return includeThin ? 2 : null;
      return null;
    };

    if (wants("hubs")) {
      for (const s of siloRows) {
        const priority = jobPriority(s);
        if (priority === null) continue;
        const k = kwOf(s.id);
        jobs.push({
          table: "site_silos", row: s, priority,
          ctx: {
            kind: "hub", name: s.name, siteName, lang, description: s.description,
            childNames: clusterRows.filter((c) => c.silo_id === s.id).map((c) => c.name),
            primaryKeywords: k.primary, secondaryKeywords: k.secondary, city: project.region || null,
          },
        });
      }
    }
    if (wants("categories")) {
      for (const c of clusterRows) {
        const priority = jobPriority(c);
        if (priority === null) continue;
        const k = kwOf(c.id);
        jobs.push({
          table: "site_clusters", row: c, priority,
          ctx: {
            kind: "category", name: c.name, siteName, lang, description: c.description,
            siloName: siloById.get(c.silo_id)?.name || null,
            childNames: [
              ...clusterRows.filter((x) => x.parent_id === c.id).map((x) => x.name),
              ...productRows.filter((p) => p.site_cluster_id === c.id).map((p) => p.name),
            ],
            primaryKeywords: k.primary, secondaryKeywords: k.secondary, city: project.region || null,
          },
        });
      }
    }
    if (wants("products")) {
      for (const p of productRows) {
        const priority = jobPriority(p);
        if (priority === null) continue;
        const cluster = p.site_cluster_id ? clusterById.get(p.site_cluster_id) : undefined;
        const k = kwOf(p.id);
        jobs.push({
          table: "site_products", row: p, priority,
          ctx: {
            kind: p.kind === "service" ? "service" : "product",
            name: p.name, siteName, lang, brand: p.brand, sku: p.sku,
            price: p.price ? `${p.price} ${(p.currency || "RUB").toUpperCase()}` : null,
            availability: p.availability, description: p.description,
            characteristics: p.characteristics,
            categoryName: cluster?.name || null,
            siloName: (cluster ? siloById.get(cluster.silo_id)?.name : siloById.get(p.silo_id)?.name) || null,
            primaryKeywords: k.primary, secondaryKeywords: k.secondary, city: project.region || null,
          },
        });
      }
    }

    // Never-generated first, then fallback text, then thin pages. Stable order
    // by id so a repeated call resumes instead of reshuffling the queue.
    jobs.sort((a, b) => a.priority - b.priority || String(a.row.id).localeCompare(String(b.row.id)));
    const queue = jobs.slice(0, limit);
    let generated = 0, fallbacks = 0, thin = 0, processed = 0, expanded = 0;
    const deadline = Date.now() + 110_000;
    // Hub / category pages need room for 3-4 paragraphs plus FAQ; 1400 tokens
    // truncated the JSON and produced the "empty body" fallbacks.
    const maxTokensFor = (k: PageKind) => (k === "hub" || k === "category" ? 2800 : k === "service" ? 2000 : 1600);

    const askModel = async (job: Job, extraSystem = "") => {
      const res = await chatJson<Record<string, unknown>>({
        apiKey, model,
        system: sysPrompt(job.ctx.kind, lang) + extraSystem,
        user: userPrompt(job.ctx),
        schema: CONTENT_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "seo_content",
        temperature: 0.6,
        maxTokens: maxTokensFor(job.ctx.kind),
        timeoutMs: 45_000,
        appTitle: "generate-commerce-content",
        functionName: "generate-commerce-content",
        userId: project.user_id, projectId,
      });
      const norm = normalizeSeoContent(res.data, job.ctx, res.model);
      if (!norm.body.length) {
        console.warn("[commerce-content] empty body after normalize", {
          page: job.ctx.name,
          raw_chars: res.raw?.length || 0,
          raw_body: Array.isArray((res.data as any)?.body) ? (res.data as any).body.length : -1,
          head: String(res.raw || "").slice(0, 200),
        });
      }
      return norm;
    };

    for (const job of queue) {
      // keep a per-page budget so the loop stops before the platform kills it
      if (Date.now() > deadline - 20_000) { console.warn("[TIMEOUT] commerce content budget reached"); break; }
      let content: SeoContent;
      try {
        if (!apiKey) throw new AiError("config", "no api key");
        content = await askModel(job);
        if (!content.body.length) throw new AiError("parse_failed", "empty body");
        // one expansion pass instead of shipping a thin page
        if (isContentThin(job.ctx.kind, content) && Date.now() < deadline - 45_000) {
          const need = MIN_WORDS[job.ctx.kind];
          const retry = await askModel(
            job,
            lang === "en"
              ? `\nThe previous draft was too short. Write a longer version: at least ${need + 60} words in total across intro, body and FAQ, no filler, same facts.`
              : `\nПредыдущий вариант оказался слишком коротким. Напиши развернутее: суммарно не меньше ${need + 60} слов в intro, body и FAQ. Без воды, только те же факты, больше конкретики по подбору, параметрам и порядку заказа.`,
          );
          if (retry.body.length && contentWordCount(retry) > contentWordCount(content)) {
            content = retry;
            expanded++;
          }
        }
      } catch (e) {
        console.warn("[commerce-content] fallback", job.ctx.name, (e as Error)?.message?.slice(0, 120));
        content = buildFallbackContent(job.ctx);
        fallbacks++;
      }
      // guarantee the keyword linkage even when the model omitted it
      if (!content.primary_keywords.length) content.primary_keywords = (job.ctx.primaryKeywords || []).slice(0, 3);
      if (!content.primary_keywords.length) content.primary_keywords = [job.ctx.name];
      if (!content.secondary_keywords.length) content.secondary_keywords = (job.ctx.secondaryKeywords || []).slice(0, 10);

      const isThin = isContentThin(job.ctx.kind, content);
      if (isThin) thin++;
      if (!dryRun) {
        await admin.from(job.table).update({
          seo_content: content,
          content_status: isThin ? "thin" : "ready",
          content_generated_at: new Date().toISOString(),
          content_hash: String(contentWordCount(content)) + ":" + content.h1.slice(0, 40),
        }).eq("id", job.row.id);
      }
      generated++;
      processed++;
    }

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      bridged,
      coverage: {
        total: coverage.total, covered: coverage.covered, uncovered: coverage.uncovered,
        conflict: coverage.conflict, duplicate_intent: coverage.duplicate_intent,
      },
      pending: Math.max(0, jobs.length - processed),
      generated, fallbacks, thin, expanded,
      model,
    });
  } catch (e) {
    console.error("[generate-commerce-content]", e);
    return errorResponse((e as Error)?.message || "unexpected error", 500);
  }
});