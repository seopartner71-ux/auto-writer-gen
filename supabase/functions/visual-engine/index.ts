// ============================================================================
// P17 - VISUAL ENGINE runner (presentation layer only).
//
//   PAGE REGISTRY -> [VISUAL ENGINE] -> design_profiles + page_visual_config
//
// Produces DATA only (design profile + visual JSON per page). No HTML, no CSS,
// no deploy. Does NOT touch PDE / Registry / Content / SEO / Commercial /
// Blog / Build / QA pipelines.
//
// Body:
//   { project_id,
//     action: "get" | "save_profile" | "ai_profile" | "apply" | "qa",
//     profile?: {...}, industry?, style?, limit?, mode?: "all" | "missing" }
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";
import { readCommercialProfile } from "../_shared/commercialProfile.ts";
import {
  buildPageVisualConfig, checkVisualConfig, presetFor, sanitizeAiOverrides,
  sanitizeColorScheme, sanitizeTypography, templatesFor, visualPageType,
  DESIGN_PRESETS, PAGE_TEMPLATES,
  type DesignProfile, type Industry, type LayoutType, type PageFacts,
  type VisualPageType, type VisualStyle,
} from "../_shared/visualTemplates.ts";
import { COMPONENT_LIBRARY } from "../_shared/visualComponents.ts";

const DESIGN_MODEL = "google/gemini-2.5-pro";
const t = (v: unknown) => String(v ?? "").trim();

const INDUSTRIES: Industry[] = ["ecommerce", "services", "informational", "local_business", "b2b_catalog"];
const STYLES: VisualStyle[] = ["industrial", "minimal", "corporate", "bold", "warm"];
const LAYOUTS: LayoutType[] = ["wide", "boxed", "split"];
const PAGE_TYPES: VisualPageType[] = ["home", "hub", "category", "product", "service", "article", "informational", "local", "system"];

const AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["industry", "style", "layout_type", "color_scheme", "typography", "pages"],
  properties: {
    industry: { type: "string" },
    style: { type: "string" },
    layout_type: { type: "string" },
    color_scheme: {
      type: "object", additionalProperties: false,
      required: ["primary", "accent", "background", "surface", "text", "muted"],
      properties: {
        primary: { type: "string" }, accent: { type: "string" }, background: { type: "string" },
        surface: { type: "string" }, text: { type: "string" }, muted: { type: "string" },
      },
    },
    typography: {
      type: "object", additionalProperties: false,
      required: ["heading_font", "body_font", "scale"],
      properties: { heading_font: { type: "string" }, body_font: { type: "string" }, scale: { type: "string" } },
    },
    pages: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["page_type", "template", "blocks"],
        properties: {
          page_type: { type: "string" },
          template: { type: "string" },
          blocks: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              required: ["type", "enabled"],
              properties: {
                type: { type: "string" }, enabled: { type: "boolean" },
                variant: { type: "string" }, order: { type: "number" },
              },
            },
          },
        },
      },
    },
  },
} as const;

function profileFromRow(row: Record<string, unknown> | null, fallbackIndustry: Industry): DesignProfile {
  const base = presetFor(fallbackIndustry);
  if (!row) return base;
  return {
    name: t(row.name) || base.name,
    industry: (INDUSTRIES.includes(t(row.industry) as Industry) ? t(row.industry) : base.industry) as Industry,
    style: (STYLES.includes(t(row.style) as VisualStyle) ? t(row.style) : base.style) as VisualStyle,
    color_scheme: sanitizeColorScheme(row.color_scheme, base.color_scheme),
    typography: sanitizeTypography(row.typography, base.typography),
    layout_type: (LAYOUTS.includes(t(row.layout_type) as LayoutType) ? t(row.layout_type) : base.layout_type) as LayoutType,
    components_config: {
      ...base.components_config,
      ...((row.components_config as Record<string, unknown>) || {}),
      templates: {
        ...base.components_config.templates,
        ...(((row.components_config as Record<string, unknown>)?.templates as Record<string, string>) || {}),
      },
      blocks: {
        ...(((row.components_config as Record<string, unknown>)?.blocks as Record<string, unknown>) || {}),
      },
    } as DesignProfile["components_config"],
  };
}

function guessIndustry(products: Record<string, unknown>[], profileRegion: string): Industry {
  const kinds = products.map((p) => t(p.kind).toLowerCase());
  const services = kinds.filter((k) => k === "service").length;
  const goods = kinds.filter((k) => k && k !== "service").length;
  if (!products.length) return "informational";
  if (services > goods * 1.5) return profileRegion ? "local_business" : "services";
  if (products.some((p) => Object.keys((p.characteristics as Record<string, unknown>) || {}).length >= 5)) return "b2b_catalog";
  return "ecommerce";
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = t(body?.project_id);
    const action = t(body?.action) || "get";
    const limit = Math.min(3000, Math.max(1, Number(body?.limit) || 1000));
    const mode = t(body?.mode) || "all";
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();
    const { data: project } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);
    if ((project as Record<string, unknown>).user_id !== auth.userId) return errorResponse("Forbidden", 403);

    const { data: profileRow } = await admin.from("design_profiles")
      .select("*").eq("project_id", projectId).eq("is_active", true).maybeSingle();

    // ---- library / catalogue ------------------------------------------------
    if (action === "catalog") {
      return jsonResponse({
        ok: true,
        components: COMPONENT_LIBRARY,
        templates: PAGE_TEMPLATES,
        presets: DESIGN_PRESETS,
      });
    }

    const commercial = readCommercialProfile(project as Record<string, unknown>);

    if (action === "get") {
      const { data: configs } = await admin.from("page_visual_config")
        .select("id, url_path, page_type, template, visual_status, visual_score, visual_issues, blocks")
        .eq("project_id", projectId).order("url_path").limit(limit);
      return jsonResponse({ ok: true, profile: profileRow || null, configs: configs || [] });
    }

    // ---- SAVE PROFILE (manual UI edits) -------------------------------------
    if (action === "save_profile") {
      const incoming = (body?.profile || {}) as Record<string, unknown>;
      const industry = (INDUSTRIES.includes(t(incoming.industry) as Industry)
        ? t(incoming.industry) : (profileRow?.industry as Industry) || "ecommerce") as Industry;
      const base = presetFor(industry);
      const merged: DesignProfile = {
        name: t(incoming.name) || t(profileRow?.name) || base.name,
        industry,
        style: (STYLES.includes(t(incoming.style) as VisualStyle) ? t(incoming.style) : base.style) as VisualStyle,
        color_scheme: sanitizeColorScheme(incoming.color_scheme, base.color_scheme),
        typography: sanitizeTypography(incoming.typography, base.typography),
        layout_type: (LAYOUTS.includes(t(incoming.layout_type) as LayoutType) ? t(incoming.layout_type) : base.layout_type) as LayoutType,
        components_config: {
          ...base.components_config,
          ...((incoming.components_config as Record<string, unknown>) || {}),
          templates: {
            ...base.components_config.templates,
            ...(((incoming.components_config as Record<string, unknown>)?.templates as Record<string, string>) || {}),
          },
          blocks: (((incoming.components_config as Record<string, unknown>)?.blocks as Record<string, never>) || {}),
        } as DesignProfile["components_config"],
      };
      const payload = { project_id: projectId, is_active: true, ...merged };
      const saved = profileRow
        ? await admin.from("design_profiles").update(payload).eq("id", profileRow.id).select().maybeSingle()
        : await admin.from("design_profiles").insert(payload).select().maybeSingle();
      if (saved.error) return errorResponse(saved.error.message, 400);
      return jsonResponse({ ok: true, profile: saved.data });
    }

    // ---- AI DESIGN GENERATOR (JSON only, never HTML) ------------------------
    if (action === "ai_profile") {
      const { data: products } = await admin.from("site_products")
        .select("name, kind, characteristics, price, brand, region").eq("project_id", projectId).limit(120);
      const { data: silos } = await admin.from("site_silos").select("name").eq("project_id", projectId).limit(40);
      const industryHint = INDUSTRIES.includes(t(body?.industry) as Industry)
        ? (t(body.industry) as Industry)
        : guessIndustry((products || []) as Record<string, unknown>[], t(commercial.region || commercial.city));
      const base = presetFor(industryHint);

      const allowedTemplates = PAGE_TYPES.map((pt) => ({
        page_type: pt,
        templates: templatesFor(pt).map((x) => x.id),
      }));
      const allowedBlocks = COMPONENT_LIBRARY.map((b) => ({ type: b.type, variants: b.variants }));

      let ai: Record<string, unknown> | null = null;
      try {
        const res = await chatJson<Record<string, unknown>>({
          apiKey: Deno.env.get("OPENROUTER_API_KEY") || "",
          model: DESIGN_MODEL,
          system: [
            "Ты арт-директор SEO-сайтов. Ты выбираешь только шаблон, набор блоков и визуальные токены.",
            "СТРОГО ЗАПРЕЩЕНО генерировать HTML, CSS или тексты.",
            "Используй только идентификаторы шаблонов и типы блоков из белого списка.",
            "Цвета - только HEX формата #RRGGBB, контраст текста и фона обязателен.",
            "Отрасль определяет структуру: каталог - характеристики и таблицы, услуги - процесс и кейсы, магазин - категории и карточки.",
          ].join("\n"),
          user: JSON.stringify({
            company: {
              name: commercial.companyName, region: commercial.region || commercial.city,
              advantages: commercial.advantages, delivery: commercial.delivery,
              payment: commercial.payment, warranty: commercial.warranty, cta: commercial.primaryCta,
            },
            industry_hint: industryHint,
            style_hint: t(body?.style) || base.style,
            silos: (silos || []).map((s: Record<string, unknown>) => s.name).slice(0, 20),
            product_sample: (products || []).slice(0, 20).map((p: Record<string, unknown>) => ({
              name: p.name, kind: p.kind, has_price: p.price != null,
              chars: Object.keys((p.characteristics as Record<string, unknown>) || {}).length,
            })),
            allowed_templates: allowedTemplates,
            allowed_blocks: allowedBlocks,
            allowed_fonts: ["Inter", "IBM Plex Sans", "Manrope", "DM Sans", "Space Grotesk", "Lora", "Source Sans 3", "Roboto", "Open Sans", "Merriweather", "Plus Jakarta Sans", "Outfit"],
          }),
          schema: AI_SCHEMA as unknown as Record<string, unknown>,
          schemaName: "visual_design_profile",
          temperature: 0.5,
          maxTokens: 3000,
          timeoutMs: 90_000,
          retries: 1,
          appTitle: "SEO-Modul visual-engine",
          functionName: "visual-engine",
          userId: auth.userId,
          projectId,
        });
        ai = res.data as Record<string, unknown>;
      } catch (e) {
        console.error("[visual-engine] ai_profile", e instanceof AiError ? `${e.kind}: ${e.message}` : String(e));
      }

      const industry = INDUSTRIES.includes(t(ai?.industry) as Industry) ? (t(ai?.industry) as Industry) : industryHint;
      const preset = presetFor(industry);
      const templates: Record<string, string> = { ...preset.components_config.templates } as Record<string, string>;
      const blocks: Record<string, unknown> = {};
      for (const p of (ai?.pages as Record<string, unknown>[]) || []) {
        const pt = t(p.page_type) as VisualPageType;
        if (!PAGE_TYPES.includes(pt)) continue;
        const tid = t(p.template);
        if (templatesFor(pt).some((x) => x.id === tid)) templates[pt] = tid;
        const ov = sanitizeAiOverrides(p.blocks);
        if (ov.length) blocks[pt] = ov;
      }

      const merged: DesignProfile = {
        name: t(body?.name) || preset.name,
        industry,
        style: (STYLES.includes(t(ai?.style) as VisualStyle) ? t(ai?.style) : preset.style) as VisualStyle,
        color_scheme: sanitizeColorScheme(ai?.color_scheme, preset.color_scheme),
        typography: sanitizeTypography(ai?.typography, preset.typography),
        layout_type: (LAYOUTS.includes(t(ai?.layout_type) as LayoutType) ? t(ai?.layout_type) : preset.layout_type) as LayoutType,
        components_config: {
          ...preset.components_config,
          templates: templates as DesignProfile["components_config"]["templates"],
          blocks: blocks as DesignProfile["components_config"]["blocks"],
          logo_text: t(commercial.companyName) || null,
        },
      };

      const payload = { project_id: projectId, is_active: true, model_used: ai ? DESIGN_MODEL : null, ...merged };
      const saved = profileRow
        ? await admin.from("design_profiles").update(payload).eq("id", profileRow.id).select().maybeSingle()
        : await admin.from("design_profiles").insert(payload).select().maybeSingle();
      if (saved.error) return errorResponse(saved.error.message, 400);
      return jsonResponse({ ok: true, profile: saved.data, ai_used: Boolean(ai) });
    }

    // ---- APPLY / QA ---------------------------------------------------------
    if (action !== "apply" && action !== "qa") return errorResponse(`unknown action: ${action}`, 400);

    const { data: registry } = await admin.from("page_registry")
      .select("id, entity_type, entity_id, page_type, url_path, indexable, is_system, status, title")
      .eq("project_id", projectId)
      .in("status", ["approved", "review"])
      .limit(limit);
    const rows = (registry || []) as Record<string, unknown>[];
    if (!rows.length) return errorResponse("registry_empty: run the Page Decision Engine first", 409);

    const industryFallback = (t(profileRow?.industry) as Industry) || "ecommerce";
    const profile = profileFromRow(profileRow as Record<string, unknown> | null, industryFallback);
    const profileId = profileRow?.id || null;

    const [seoRes, productsRes, clustersRes, articlesRes, existingRes] = await Promise.all([
      admin.from("page_seo").select("registry_id, faq, h1").eq("project_id", projectId).limit(limit),
      admin.from("site_products").select("id, site_cluster_id, silo_id, name, price, images, characteristics, description, seo_content").eq("project_id", projectId).limit(5000),
      admin.from("site_clusters").select("id, silo_id, parent_id, name, description, seo_content").eq("project_id", projectId).limit(3000),
      admin.from("articles").select("id, cluster_id, status").eq("user_id", auth.userId).limit(2000),
      admin.from("page_visual_config").select("id, registry_id, blocks, template, page_type").eq("project_id", projectId).limit(limit),
    ]);

    const seoByReg = new Map<string, Record<string, unknown>>(((seoRes.data || []) as Record<string, unknown>[]).map((r) => [String(r.registry_id), r]));
    const products = ((productsRes.data || []) as Record<string, unknown>[]);
    const productById = new Map(products.map((p) => [String(p.id), p]));
    const clusters = ((clustersRes.data || []) as Record<string, unknown>[]);
    const clusterById = new Map(clusters.map((c) => [String(c.id), c]));
    const childrenOfCluster = new Map<string, number>();
    const childrenOfSilo = new Map<string, number>();
    for (const c of clusters) {
      if (c.parent_id) childrenOfCluster.set(String(c.parent_id), (childrenOfCluster.get(String(c.parent_id)) || 0) + 1);
      else if (c.silo_id) childrenOfSilo.set(String(c.silo_id), (childrenOfSilo.get(String(c.silo_id)) || 0) + 1);
    }
    const productsOfCluster = new Map<string, number>();
    const productsOfSilo = new Map<string, number>();
    for (const p of products) {
      if (p.site_cluster_id) productsOfCluster.set(String(p.site_cluster_id), (productsOfCluster.get(String(p.site_cluster_id)) || 0) + 1);
      if (p.silo_id) productsOfSilo.set(String(p.silo_id), (productsOfSilo.get(String(p.silo_id)) || 0) + 1);
    }
    const articlesCount = ((articlesRes.data || []) as Record<string, unknown>[])
      .filter((a) => ["completed", "published"].includes(String(a.status))).length;
    const existing = new Map<string, Record<string, unknown>>(((existingRes.data || []) as Record<string, unknown>[]).map((r) => [String(r.registry_id), r]));

    const summary = { total: rows.length, processed: 0, pass: 0, review: 0, fail: 0 };
    const results: Record<string, unknown>[] = [];
    const upserts: Record<string, unknown>[] = [];

    for (const row of rows) {
      const regId = String(row.id);
      if (action === "apply" && mode === "missing" && existing.has(regId)) continue;

      const pageType = visualPageType(row as { page_type?: string; url_path?: string });
      const seo = seoByReg.get(regId);
      const product = productById.get(String(row.entity_id));
      const cluster = clusterById.get(String(row.entity_id));
      const seoContent = ((product?.seo_content || cluster?.seo_content || {}) as Record<string, unknown>);

      const facts: PageFacts = {
        has_h1: Boolean(t(seo?.h1) || t(row.title)),
        has_faq: Array.isArray(seo?.faq) ? (seo?.faq as unknown[]).length > 0 : false,
        has_characteristics: product ? Object.keys((product.characteristics as Record<string, unknown>) || {}).length > 0 : false,
        has_price: product ? product.price != null : false,
        has_images: product ? Array.isArray(product.images) && (product.images as unknown[]).length > 0 : false,
        has_children: cluster
          ? (childrenOfCluster.get(String(cluster.id)) || 0) > 0
          : row.entity_type === "hub" ? (childrenOfSilo.get(String(row.entity_id)) || 0) > 0 : false,
        has_products: cluster
          ? (productsOfCluster.get(String(cluster.id)) || 0) > 0
          : row.entity_type === "hub" ? (productsOfSilo.get(String(row.entity_id)) || 0) > 0
          : pageType === "home" ? products.length > 0 : products.length > 0,
        has_articles: articlesCount > 0,
        has_reviews: Boolean(t(commercial.clients)),
        has_content: Boolean(t(product?.description) || t(cluster?.description) || t(seoContent?.intro)),
      };

      const prevBlocks = action === "qa" ? (existing.get(regId)?.blocks as never) : undefined;
      const config = action === "qa" && prevBlocks
        ? {
            type: pageType,
            template: String(existing.get(regId)?.template || ""),
            blocks: (prevBlocks as unknown as { type: string; enabled: boolean; variant?: string; order?: number }[]),
          }
        : buildPageVisualConfig(pageType, profile, facts);

      const check = checkVisualConfig(config as never, facts);
      summary.processed++;
      summary[check.status.toLowerCase() as "pass" | "review" | "fail"]++;

      upserts.push({
        project_id: projectId,
        registry_id: regId,
        design_profile_id: profileId,
        url_path: t(row.url_path),
        page_type: pageType,
        template: config.template,
        blocks: config.blocks,
        visual_status: check.status,
        visual_score: check.score,
        visual_issues: check.issues,
        generated_at: new Date().toISOString(),
      });
      if (results.length < 50) {
        results.push({ url_path: row.url_path, page_type: pageType, template: config.template, status: check.status, score: check.score, issues: check.issues });
      }
    }

    for (let i = 0; i < upserts.length; i += 500) {
      const chunk = upserts.slice(i, i + 500);
      const { error } = await admin.from("page_visual_config").upsert(chunk, { onConflict: "registry_id" });
      if (error) return errorResponse(`save failed: ${error.message}`, 400);
    }

    return jsonResponse({ ok: true, action, summary, results });
  } catch (e) {
    console.error("visual-engine error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
