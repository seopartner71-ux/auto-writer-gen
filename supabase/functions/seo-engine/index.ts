// ============================================================================
// P14 - SEO ENGINE runner.
//
//   PDE -> PAGE REGISTRY -> [SEO ENGINE] -> (Build reads page_seo)
//
// Source of truth: page_registry, status in (approved, review).
// Produces DATA only: page_seo rows. No HTML, no rendering, no deploy.
// Does not touch PDE / Registry / SILO / Build / Content Engine / QA.
//
// Body:
//   { project_id, mode?: "all" | "missing" | "only_fail" | "selected",
//     registry_ids?: string[], limit?: number, dry_run?: boolean }
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";
import { readCommercialProfile } from "../_shared/commercialProfile.ts";
import {
  buildSchema, checkSeoPackage, robotsFor, schemaTypeFor, sanitizeSeoText,
  truncateAtWord, normKey, TITLE_MAX, FAQ_COUNT, FAQ_MIN_WORDS, DESC_MIN, DESC_MAX,
  type SeoPackage, type SeoPageType,
} from "../_shared/seoEngine.ts";

// Only Gemini 2.5 Pro generates SEO copy.
const SEO_MODEL = "google/gemini-2.5-pro";

const GEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "h1", "faq"],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    h1: { type: "string" },
    faq: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["q", "a"],
        properties: { q: { type: "string" }, a: { type: "string" } },
      },
    },
  },
} as const;

const t = (v: unknown) => String(v ?? "").trim();

interface GenOut { title: string; description: string; h1: string; faq: { q: string; a: string }[] }

function sysPrompt(pageType: SeoPageType, lang: string): string {
  const ru = lang !== "en";
  const titleMax = TITLE_MAX[pageType] ?? 65;
  const faqN = FAQ_COUNT[pageType] ?? 3;
  const rules = ru
    ? [
        `title: не длиннее ${titleMax} символов, уникальный, без кавычек и без названия сайта.`,
        pageType === "product"
          ? "title товара: название + ключ + коммерческий хвост (купить, цена, доставка) по фактам."
          : "title отражает интент страницы и её тип.",
        `description: ${DESC_MIN}-${DESC_MAX} символов, содержит ценность и призыв к действию, не дублирует title.`,
        "h1 отдельно от title. Для товара h1 может совпадать с названием товара, title - нет.",
        `faq: ровно ${faqN} вопросов, каждый ответ не короче ${FAQ_MIN_WORDS} слов.`,
        "Пиши только по фактам из входных данных. Не выдумывай цены, сроки, гарантии, сертификаты, наличие.",
        "Только короткий дефис, без длинного тире. Без буквы 'е' с точками. Без markdown и жирного текста.",
      ]
    : [
        `title: max ${titleMax} chars, unique, no site name, no quotes.`,
        `description: ${DESC_MIN}-${DESC_MAX} chars, value + CTA, must not repeat the title.`,
        "h1 is separate from title.",
        `faq: exactly ${faqN} items, each answer at least ${FAQ_MIN_WORDS} words.`,
        "Use only the given facts. Never invent prices, stock, warranty or certificates. No markdown.",
      ];
  const role = ru
    ? "Ты SEO-инженер. Формируешь мета-данные страницы коммерческого сайта."
    : "You are an SEO engineer producing page metadata for a commercial site.";
  return `${role}\n${rules.map((r) => `- ${r}`).join("\n")}\nВерни JSON: {"title":"","description":"","h1":"","faq":[{"q":"","a":""}]}`;
}

function userPrompt(ctx: Record<string, unknown>): string {
  return JSON.stringify(ctx, null, 1).slice(0, 12000);
}

function localeOf(v: unknown): string {
  return String(v || "ru").toLowerCase().startsWith("en") ? "en" : "ru";
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = t(body?.project_id);
    const mode = t(body?.mode) || "missing";
    const registryIds: string[] = Array.isArray(body?.registry_ids) ? body.registry_ids.map(String) : [];
    // fast: deterministic metadata, no LLM - the only way to cover hundreds of
    // pages inside one invocation. Also used as the fallback below.
    const fast = body?.fast === true;
    const limit = Math.min(fast ? 2000 : 200, Math.max(1, Number(body?.limit) || (fast ? 500 : 40)));
    const dryRun = body?.dry_run === true;
    const startedAt = Date.now();
    const LLM_BUDGET_MS = 100_000;
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();

    const { data: project } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);

    const lang = localeOf((project as any).site_language || (project as any).language);
    const profile = readCommercialProfile(project as any);
    const domain = t((project as any).custom_domain) || t((project as any).site_domain) || "";
    const origin = domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "";

    // ---- SOURCE OF TRUTH -------------------------------------------------
    const { data: registry } = await admin
      .from("page_registry")
      .select("id, entity_type, entity_id, page_type, url_path, canonical, intent, demand_score, title, indexable, is_system, status")
      .eq("project_id", projectId)
      .in("status", ["approved", "review"])
      .order("demand_score", { ascending: false });

    const rows = (registry || []) as any[];
    if (!rows.length) return errorResponse("registry_empty: run the Page Decision Engine first", 409);

    const { data: existingSeo } = await admin
      .from("page_seo").select("*").eq("project_id", projectId);
    const seoByRegistry = new Map<string, any>((existingSeo || []).map((r: any) => [r.registry_id, r]));

    // ---- ENTITY DATA -----------------------------------------------------
    const [silosRes, clustersRes, productsRes, keywordsRes] = await Promise.all([
      admin.from("site_silos").select("id, name, description, seo_content").eq("project_id", projectId),
      admin.from("site_clusters").select("id, silo_id, parent_id, name, description, seo_content").eq("project_id", projectId),
      admin.from("site_products").select("id, site_cluster_id, silo_id, name, sku, brand, price, currency, availability, description, characteristics, images, benefits, region, kind, seo_content").eq("project_id", projectId).limit(5000),
      admin.from("site_keywords").select("keyword, target_type, target_id, intent, volume").eq("project_id", projectId).limit(5000),
    ]);
    const silos = new Map<string, any>(((silosRes.data || []) as any[]).map((r) => [r.id, r]));
    const clusters = new Map<string, any>(((clustersRes.data || []) as any[]).map((r) => [r.id, r]));
    const products = new Map<string, any>(((productsRes.data || []) as any[]).map((r) => [r.id, r]));
    const kwByTarget = new Map<string, string[]>();
    for (const k of ((keywordsRes.data || []) as any[])) {
      if (!k.target_id) continue;
      const arr = kwByTarget.get(k.target_id) || [];
      if (arr.length < 12 && t(k.keyword)) arr.push(t(k.keyword));
      kwByTarget.set(k.target_id, arr);
    }

    // ---- selection -------------------------------------------------------
    const wanted = rows.filter((r) => {
      const cur = seoByRegistry.get(r.id);
      if (mode === "selected") return registryIds.includes(r.id);
      if (mode === "all") return true;
      if (mode === "only_fail") return !cur || cur.seo_status === "FAIL";
      return !cur; // missing
    }).slice(0, limit);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";

    // Duplicate tracking across the WHOLE project, not just this batch.
    const titleIndex = new Map<string, string>(); // normTitle -> registry_id
    const h1Index = new Map<string, string>();
    const canonicalIndex = new Map<string, string>();
    for (const r of rows) {
      const cur = seoByRegistry.get(r.id);
      if (cur?.title) titleIndex.set(normKey(cur.title), r.id);
      if (cur?.h1) h1Index.set(normKey(cur.h1), r.id);
      if (cur?.canonical) canonicalIndex.set(t(cur.canonical), r.id);
    }

    const results: any[] = [];
    let generated = 0, failed = 0;

    for (const row of wanted) {
      const pageType = (t(row.page_type) || "system") as SeoPageType;
      const product = row.entity_type === "product" || row.entity_type === "service"
        ? products.get(row.entity_id) : null;
      const cluster = row.entity_type === "category" ? clusters.get(row.entity_id) : null;
      const silo = row.entity_type === "hub" ? silos.get(row.entity_id) : silos.get(product?.silo_id || cluster?.silo_id);
      const seoContent = (product?.seo_content || cluster?.seo_content || silo?.seo_content || {}) as any;

      // 8. CANONICAL comes only from the registry.
      const canonicalPath = t(row.canonical) || t(row.url_path);
      const canonical = origin ? `${origin}${canonicalPath}` : canonicalPath;
      const robots = robotsFor({ pageType, urlPath: row.url_path, indexable: row.indexable });
      const schemaType = schemaTypeFor(pageType);

      let gen: GenOut | null = null;
      let modelUsed: string | null = null;
      let usedFallback = false;
      const llmAllowed = !fast && !!apiKey && (Date.now() - startedAt) < LLM_BUDGET_MS;

      if (!dryRun && pageType !== "system" && llmAllowed) {
        const ctx: Record<string, unknown> = {
          page_type: pageType,
          intent: row.intent,
          demand: row.demand_score,
          url: canonicalPath,
          silo: silo ? { name: silo.name, description: silo.description } : null,
          category: cluster ? { name: cluster.name, description: cluster.description } : null,
          entity: product
            ? {
                name: product.name, sku: product.sku, brand: product.brand,
                price: product.price, currency: product.currency, availability: product.availability,
                description: product.description, characteristics: product.characteristics,
                benefits: product.benefits, region: product.region, kind: product.kind,
              }
            : { name: row.title },
          company_profile: {
            company: profile.companyName, region: profile.region || profile.city,
            delivery: profile.delivery, payment: profile.payment, warranty: profile.warranty,
            advantages: profile.advantages, cta: profile.primaryCta, phone: profile.phone,
          },
          semantic_terms: kwByTarget.get(row.entity_id) || [],
          existing_content: {
            intro: t(seoContent?.intro).slice(0, 600),
            entities: Array.isArray(seoContent?.entities) ? seoContent.entities.slice(0, 15) : [],
          },
          language: lang,
        };

        try {
          const res = await chatJson<GenOut>({
            apiKey, model: SEO_MODEL,
            system: sysPrompt(pageType, lang),
            user: userPrompt(ctx),
            schema: GEN_SCHEMA as unknown as Record<string, unknown>,
            schemaName: "seo_package",
            temperature: 0.4,
            maxTokens: 2200,
            timeoutMs: 90_000,
            retries: 1,
            appTitle: "SEO-Modul seo-engine",
            functionName: "seo-engine",
            userId: auth.userId,
            projectId,
          });
          gen = res.data;
          modelUsed = SEO_MODEL;
        } catch (e) {
          // Never skip the page: an LLM failure must still leave a valid
          // deterministic page_seo row instead of "page without a title".
          failed++;
          results.push({
            registry_id: row.id, url_path: row.url_path,
            error: e instanceof AiError ? `${e.kind}: ${e.message}` : String(e),
            fallback: true,
          });
        }
      }

      const titleMax = TITLE_MAX[pageType] ?? 65;
      let fb: { title: string; h1: string; description: string } | null = null;
      if (!gen && pageType !== "system") {
        usedFallback = true;
        fb = buildFallbackSeo({
          pageType,
          lang,
          name: t(product?.name || cluster?.name || silo?.name || row.title),
          description: product?.description || cluster?.description || silo?.description || t(seoContent?.intro),
          siloName: silo?.name || null,
          categoryName: cluster?.name || null,
          siteName: t((project as any).site_name) || profile.companyName || null,
          companyName: profile.companyName || null,
          region: profile.region || profile.city || null,
          delivery: profile.delivery || null,
          price: product?.price ?? null,
          currency: product?.currency ?? null,
        });
      }

      const pkg: SeoPackage = {
        title: truncateAtWord(sanitizeSeoText(gen?.title || fb?.title || row.title || product?.name || cluster?.name || silo?.name || ""), titleMax),
        meta_description: truncateAtWord(sanitizeSeoText(gen?.description || fb?.description || ""), DESC_MAX),
        h1: sanitizeSeoText(gen?.h1 || fb?.h1 || product?.name || cluster?.name || silo?.name || row.title || ""),
        canonical,
        og_title: "",
        og_description: "",
        robots,
        schema_type: schemaType,
        faq: (gen?.faq || []).filter((f) => t(f?.q) && t(f?.a)).map((f) => ({
          q: sanitizeSeoText(f.q), a: sanitizeSeoText(f.a),
        })),
      };
      pkg.og_title = pkg.title;
      pkg.og_description = pkg.meta_description;

      // duplicates: compare against everything except this very page
      const otherTitles = new Set<string>();
      const otherH1 = new Set<string>();
      const otherCanonicals = new Set<string>();
      for (const [k, id] of titleIndex) if (id !== row.id) otherTitles.add(k);
      for (const [k, id] of h1Index) if (id !== row.id) otherH1.add(k);
      for (const [k, id] of canonicalIndex) if (id !== row.id) otherCanonicals.add(k);

      const check = checkSeoPackage(pkg, {
        pageType, otherTitles, otherH1, otherCanonicals,
        registryCanonical: canonical,
      });

      const breadcrumbs: { name: string; url: string }[] = [{ name: lang === "en" ? "Home" : "Главная", url: origin || "/" }];
      if (silo?.name) breadcrumbs.push({ name: silo.name, url: canonical });
      if (cluster?.name) breadcrumbs.push({ name: cluster.name, url: canonical });
      breadcrumbs.push({ name: pkg.h1, url: canonical });

      const schemaJson = buildSchema({
        pageType, url: canonical,
        title: pkg.title, description: pkg.meta_description, h1: pkg.h1,
        siteName: profile.companyName || t((project as any).site_name),
        breadcrumbs,
        faq: pkg.faq,
        product: product
          ? {
              name: product.name, sku: product.sku, brand: product.brand,
              price: product.price, currency: product.currency, availability: product.availability,
              image: Array.isArray(product.images) ? t(product.images[0]) : null,
            }
          : null,
        local: pageType === "local"
          ? {
              name: profile.companyName, phone: profile.phone, address: profile.address,
              city: profile.city, country: profile.country, hours: profile.workingHours,
            }
          : null,
      });

      titleIndex.set(normKey(pkg.title), row.id);
      h1Index.set(normKey(pkg.h1), row.id);
      canonicalIndex.set(t(pkg.canonical), row.id);

      if (!dryRun) {
        await admin.from("page_seo").upsert({
          project_id: projectId,
          registry_id: row.id,
          url_path: row.url_path,
          page_type: pageType,
          title: pkg.title,
          meta_description: pkg.meta_description,
          h1: pkg.h1,
          canonical: pkg.canonical,
          og_title: pkg.og_title,
          og_description: pkg.og_description,
          robots: pkg.robots,
          schema_type: pkg.schema_type,
          schema_json: schemaJson,
          faq: pkg.faq,
          seo_status: check.status,
          seo_issues: check.issues,
          model_used: modelUsed,
          generated_at: new Date().toISOString(),
        }, { onConflict: "registry_id" });
      }

      generated++;
      results.push({
        registry_id: row.id, url_path: row.url_path, page_type: pageType,
        title: pkg.title, schema_type: pkg.schema_type,
        status: check.status, issues: check.issues,
      });
    }

    const summary = {
      registry_total: rows.length,
      processed: wanted.length,
      generated, failed,
      pass: results.filter((r) => r.status === "PASS").length,
      review: results.filter((r) => r.status === "REVIEW").length,
      fail: results.filter((r) => r.status === "FAIL").length,
    };

    return jsonResponse({ ok: true, mode, dry_run: dryRun, summary, results });
  } catch (e) {
    console.error("seo-engine error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
