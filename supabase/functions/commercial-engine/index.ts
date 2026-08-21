// ============================================================================
// P15 - TRUST & CONVERSION ENGINE runner.
//
//   PDE -> PAGE REGISTRY -> SEO ENGINE -> [COMMERCIAL BLOCKS] -> Build reads them
//
// Data only: page_commercial_blocks rows + coverage metrics.
// No HTML rewriting, no deploy. Does not touch PDE, Registry, Content Engine,
// SEO Engine, Build or QA.
//
// Body: { project_id, mode?: "analyze" | "missing" | "all" | "only_fail" | "selected",
//         registry_ids?: string[], limit?: number }
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";
import {
  readCommercialProfile, commercialFactors, factorFacts,
} from "../_shared/commercialProfile.ts";
import {
  blockSpecsFor, blocksSorted, assessPageBlocks, missingDataText,
  BLOCK_TITLES, type BlockType, type StoredBlock,
} from "../_shared/commercialBlocks.ts";

const MODEL = "google/gemini-2.5-pro";
const t = (v: unknown) => String(v ?? "").trim();

const GEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["block_type", "title", "content"],
        properties: {
          block_type: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  },
} as const;

interface GenBlock { block_type: string; title: string; content: string }

function sysPrompt(pageType: string, types: BlockType[], ru: boolean): string {
  const rules = ru
    ? [
        "Ты коммерческий редактор сайта. Пишешь блоки доверия и конверсии.",
        "Категорически запрещено выдумывать факты: цены, сроки, гарантии, сертификаты, отзывы, количество клиентов.",
        "Используй только факты из входных данных. Если факта нет - используй нейтральную формулировку про уточнение у менеджера.",
        "Не пиши отзывы и рейтинги, если их нет во входных данных.",
        "Каждый блок: 40-110 слов, простой HTML (p, ul, li). Без markdown, без жирного текста.",
        "Только короткий дефис, без длинного тире. Без буквы 'е' с точками.",
      ]
    : [
        "You are a commercial editor writing trust and conversion blocks.",
        "Never invent facts: prices, terms, warranty, certificates, reviews, client counts.",
        "Use only the supplied facts. If a fact is absent, state that it is confirmed by a manager.",
        "Each block: 40-110 words, simple HTML (p, ul, li). No markdown, no bold.",
      ];
  return [
    rules.map((r) => `- ${r}`).join("\n"),
    `Тип страницы: ${pageType}.`,
    `Нужны блоки строго этих типов: ${types.join(", ")}.`,
    `Верни JSON: {"blocks":[{"block_type":"","title":"","content":""}]}`,
  ].join("\n");
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
    const limit = Math.min(120, Math.max(1, Number(body?.limit) || 25));
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();

    const { data: project } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);
    if ((project as any).user_id !== auth.userId) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: auth.userId, _role: "admin" });
      if (!isAdmin) return errorResponse("forbidden", 403);
    }

    const lang = String((project as any).site_language || (project as any).language || "ru").toLowerCase();
    const ru = !lang.startsWith("en");
    const profile = readCommercialProfile(project as Record<string, unknown>);
    const factors = commercialFactors(profile);
    const facts = factorFacts(profile);

    const { data: registry } = await admin
      .from("page_registry")
      .select("id, entity_type, entity_id, page_type, url_path, title, status, demand_score, quality_status, quality_errors")
      .eq("project_id", projectId)
      .in("status", ["approved", "review"])
      .order("demand_score", { ascending: false });

    const rows = (registry || []) as any[];
    if (!rows.length) return errorResponse("registry_empty: run the Page Decision Engine first", 409);

    const { data: blockRows } = await admin
      .from("page_commercial_blocks").select("*").eq("project_id", projectId);
    const byRegistry = new Map<string, StoredBlock[]>();
    for (const b of (blockRows || []) as any[]) {
      const list = byRegistry.get(b.registry_id) || [];
      list.push(b as StoredBlock);
      byRegistry.set(b.registry_id, list);
    }

    // ---- current state (also the "analyze" answer) -------------------------
    const report = (r: any) => assessPageBlocks(String(r.page_type || ""), byRegistry.get(r.id) || []);
    const pages = rows.map((r) => ({ row: r, rep: report(r) }));

    if (mode === "analyze") {
      return jsonResponse({
        ok: true, mode,
        profile: factors,
        summary: summarize(pages, factors),
        pages: pages.map(({ row, rep }) => ({
          registry_id: row.id, url_path: row.url_path, page_type: row.page_type,
          quality_status: row.quality_status, ...rep,
        })),
      });
    }

    // ---- pick work --------------------------------------------------------
    let wanted = pages;
    if (mode === "selected") wanted = pages.filter((p) => registryIds.includes(p.row.id));
    else if (mode === "missing") wanted = pages.filter((p) => p.rep.missing_blocks.length > 0);
    else if (mode === "only_fail") wanted = pages.filter((p) => p.rep.status === "FAIL");
    wanted = wanted.filter((p) => blockSpecsFor(String(p.row.page_type || "")).length > 0).slice(0, limit);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY is not configured", 500);

    // entity data for product / service facts
    const productIds = wanted.map((p) => p.row.entity_id).filter(Boolean);
    const [{ data: products }, { data: clusters }, { data: silos }, { data: seoRows }] = await Promise.all([
      admin.from("site_products")
        .select("id, name, sku, brand, price, currency, availability, description, characteristics, benefits, region, kind, service_meta")
        .eq("project_id", projectId).in("id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]),
      admin.from("site_clusters").select("id, name, description, silo_id").eq("project_id", projectId),
      admin.from("site_silos").select("id, name, description").eq("project_id", projectId),
      admin.from("page_seo").select("registry_id, title, meta_description, h1, faq").eq("project_id", projectId),
    ]);
    const productById = new Map((products || []).map((p: any) => [p.id, p]));
    const clusterById = new Map((clusters || []).map((c: any) => [c.id, c]));
    const siloById = new Map((silos || []).map((s: any) => [s.id, s]));
    const seoById = new Map((seoRows || []).map((s: any) => [s.registry_id, s]));

    let generated = 0, failed = 0, blocksWritten = 0, skipped = 0;
    const results: any[] = [];
    const startedAt = Date.now();
    const BUDGET_MS = 100_000;
    const CONCURRENCY = 4;

    const processPage = async ({ row, rep }: { row: any; rep: any }) => {
      if (Date.now() - startedAt > BUDGET_MS) { skipped++; return; }
      const pageType = String(row.page_type || "");
      const specs = blocksSorted(blockSpecsFor(pageType));
      const todo = mode === "missing"
        ? specs.filter((s) => rep.missing_blocks.includes(s.type) || (s.required && !rep.present.includes(s.type)))
        : specs;
      if (!todo.length) return;

      const product = productById.get(row.entity_id);
      const cluster = clusterById.get(row.entity_id);
      const silo = siloById.get(row.entity_id);
      const seo = seoById.get(row.id);

      const neededFactors = [...new Set(todo.flatMap((s) => s.factors))];
      const missingFactors = neededFactors.filter((f) => !facts[f]);

      const ctx = {
        page_type: pageType,
        url_path: row.url_path,
        page_title: seo?.h1 || seo?.title || row.title,
        meta_description: seo?.meta_description || null,
        product: product
          ? {
              name: product.name, sku: product.sku, brand: product.brand,
              price: product.price, currency: product.currency,
              availability: product.availability, kind: product.kind,
              description: t(product.description).slice(0, 900),
              characteristics: product.characteristics, benefits: product.benefits,
              region: product.region, service_meta: product.service_meta,
            }
          : null,
        category: cluster ? { name: cluster.name, description: cluster.description } : null,
        hub: silo ? { name: silo.name, description: silo.description } : null,
        company_facts: facts,
        missing_factors: missingFactors,
        missing_data_phrases: Object.fromEntries(missingFactors.map((f) => [f, missingDataText(f, ru)])),
        quality_missing_required: Array.isArray(row.quality_errors) ? row.quality_errors : [],
        language: ru ? "ru" : "en",
      };

      let gen: GenBlock[] = [];
      try {
        const res = await chatJson<{ blocks: GenBlock[] }>({
          apiKey, model: MODEL,
          system: sysPrompt(pageType, todo.map((s) => s.type), ru),
          user: JSON.stringify(ctx, null, 1).slice(0, 12000),
          schema: GEN_SCHEMA as unknown as Record<string, unknown>,
          schemaName: "commercial_blocks",
          temperature: 0.4,
          maxTokens: 4000,
          timeoutMs: 110_000,
          retries: 1,
          appTitle: "SEO-Modul commercial-engine",
          functionName: "commercial-engine",
          userId: auth.userId,
          projectId,
        });
        gen = Array.isArray(res.data?.blocks) ? res.data.blocks : [];
      } catch (e) {
        failed++;
        results.push({
          registry_id: row.id, url_path: row.url_path,
          error: e instanceof AiError ? `${e.kind}: ${e.message}` : String(e),
        });
        return;
      }

      const genByType = new Map(gen.map((g) => [t(g.block_type), g]));
      const payload = todo.map((spec) => {
        const g = genByType.get(spec.type);
        const blockMissing = spec.factors.filter((f) => !facts[f]);
        const fallback = blockMissing.map((f) => `<p class="cbx-note">${missingDataText(f, ru)}</p>`).join("");
        const content = t(g?.content) ? t(g?.content) + fallback : fallback;
        return {
          project_id: projectId,
          registry_id: row.id,
          page_type: pageType,
          block_type: spec.type,
          title: t(g?.title) || BLOCK_TITLES[spec.type][ru ? "ru" : "en"],
          content,
          missing_factors: blockMissing,
          priority: spec.priority,
          status: content ? "ready" : "missing_data",
          model_used: MODEL,
          updated_at: new Date().toISOString(),
        };
      }).filter((b) => t(b.content).length > 0);

      if (payload.length) {
        const { error } = await admin.from("page_commercial_blocks")
          .upsert(payload, { onConflict: "registry_id,block_type" });
        if (error) {
          failed++;
          results.push({ registry_id: row.id, url_path: row.url_path, error: error.message });
          return;
        }
        blocksWritten += payload.length;
        const merged = [...(byRegistry.get(row.id) || []).filter((b) => !payload.some((p) => p.block_type === b.block_type)), ...payload];
        byRegistry.set(row.id, merged as StoredBlock[]);
      }

      generated++;
      const after = assessPageBlocks(pageType, byRegistry.get(row.id) || []);
      results.push({
        registry_id: row.id, url_path: row.url_path, page_type: pageType,
        before: { status: rep.status, score: rep.score, missing_blocks: rep.missing_blocks },
        after: { status: after.status, score: after.score, missing_blocks: after.missing_blocks },
        blocks: payload.map((p) => p.block_type),
      });
    };

    // bounded parallelism keeps a batch inside the edge function time budget
    const queue = [...wanted];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await processPage(next);
        }
      }),
    );

    const finalPages = rows.map((r) => ({ row: r, rep: assessPageBlocks(String(r.page_type || ""), byRegistry.get(r.id) || []) }));

    return jsonResponse({
      ok: true, mode,
      profile: factors,
      summary: { ...summarize(finalPages, factors), processed: wanted.length, generated, failed, skipped, blocks_written: blocksWritten },
      results,
    });
  } catch (e) {
    console.error("commercial-engine error:", e);
    return errorResponse(e instanceof Error ? e.message : "commercial engine failed", 500);
  }
});

function summarize(
  pages: { row: any; rep: ReturnType<typeof assessPageBlocks> }[],
  factors: ReturnType<typeof commercialFactors>,
) {
  const applicable = pages.filter((p) => blockSpecsFor(String(p.row.page_type || "")).length > 0);
  const avg = applicable.length
    ? Math.round(applicable.reduce((a, p) => a + p.rep.score, 0) / applicable.length)
    : 0;
  return {
    registry_total: pages.length,
    commercial_pages: applicable.length,
    pass: applicable.filter((p) => p.rep.status === "PASS").length,
    review: applicable.filter((p) => p.rep.status === "REVIEW").length,
    fail: applicable.filter((p) => p.rep.status === "FAIL").length,
    page_coverage: avg,
    commercial_coverage: factors.commercial_coverage,
    trust_score: factors.trust_score,
    conversion_score: factors.conversion_score,
    groups: factors.byGroup,
  };
}
