// ============================================================================
// P23 - Supplier & Catalog Engine (AI helpers)
//
// Слой импорта каталога живёт на клиенте (парсинг и нормализация файла),
// сюда вынесены только две AI-задачи:
//
//   { action: "suggest_mapping", headers, sample }   -> колонка -> поле Factory
//   { action: "classify", project_id, names[] }      -> категория для товара
//
// Ядро P1-P22 не затрагивается: функция только предлагает маппинг и пишет
// category_hint у товаров, которые пришли без категории.
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson } from "../_shared/aiClient.ts";

const MODEL = "google/gemini-2.5-flash";

const FIELDS = [
  "name", "sku", "price", "stock", "image", "brand",
  "category", "description", "external_id", "currency", "url", "ignore",
];

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY is not configured", 500);

    // ------------------------------------------------------ suggest mapping
    if (action === "suggest_mapping") {
      const headers: string[] = (Array.isArray(body.headers) ? body.headers : []).map(String).slice(0, 80);
      const sample = Array.isArray(body.sample) ? body.sample.slice(0, 5) : [];
      if (!headers.length) return errorResponse("headers required", 400);

      const res = await chatJson<{ mapping: { column: string; field: string }[] }>({
        apiKey,
        model: MODEL,
        system:
          "Ты сопоставляешь колонки прайса поставщика с полями каталога интернет-магазина. " +
          `Допустимые поля: ${FIELDS.join(", ")}. Каждое поле, кроме ignore, используй максимум один раз. ` +
          "Если колонка - характеристика товара, ставь ignore.",
        user: JSON.stringify({ headers, sample }).slice(0, 8000),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["mapping"],
          properties: {
            mapping: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["column", "field"],
                properties: { column: { type: "string" }, field: { type: "string", enum: FIELDS } },
              },
            },
          },
        },
        schemaName: "catalog_mapping",
        temperature: 0.1,
        maxTokens: 2000,
        timeoutMs: 60_000,
        appTitle: "SEO-Modul catalog-engine",
        functionName: "catalog-engine",
        userId,
      });

      const map: Record<string, string> = {};
      for (const m of res.data?.mapping || []) {
        if (headers.includes(m.column) && FIELDS.includes(m.field)) map[m.column] = m.field;
      }
      return jsonResponse({ ok: true, mapping: map });
    }

    // ----------------------------------------------------------- classify
    if (action === "classify") {
      const projectId = String(body.project_id || "");
      if (!projectId) return errorResponse("project_id required", 400);
      const admin = adminClient();

      const { data: project } = await admin.from("projects")
        .select("id, user_id, site_positioning").eq("id", projectId).maybeSingle();
      if (!project) return errorResponse("project not found", 404);
      if (!auth.isQueueCall && project.user_id !== userId) return errorResponse("forbidden", 403);

      const limit = Math.min(Number(body.limit) || 200, 400);
      const { data: products } = await admin.from("site_products")
        .select("id, name, brand")
        .eq("project_id", projectId)
        .is("category_hint", null)
        .limit(limit);

      const rows = products || [];
      if (!rows.length) return jsonResponse({ ok: true, classified: 0, categories: [] });

      const { data: clusters } = await admin.from("site_clusters")
        .select("name").eq("project_id", projectId).limit(200);
      const known = (clusters || []).map((c: Record<string, unknown>) => String(c.name));

      const res = await chatJson<{ items: { i: number; category: string }[] }>({
        apiKey,
        model: MODEL,
        system:
          "Ты товаровед. По названию товара определи товарную категорию магазина. " +
          "Только классификация: не придумывай характеристики и не меняй название. " +
          "Категория - короткая группа во множественном числе, например: Болты DIN. " +
          (known.length ? `По возможности используй существующие категории: ${known.slice(0, 60).join("; ")}.` : ""),
        user: JSON.stringify({
          niche: project.site_positioning || "",
          products: rows.map((p: Record<string, unknown>, i: number) => ({ i, name: p.name, brand: p.brand })),
        }).slice(0, 20000),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["i", "category"],
                properties: { i: { type: "number" }, category: { type: "string" } },
              },
            },
          },
        },
        schemaName: "catalog_categories",
        temperature: 0.2,
        maxTokens: 8000,
        timeoutMs: 110_000,
        appTitle: "SEO-Modul catalog-engine",
        functionName: "catalog-engine",
        userId,
        projectId,
      });

      const seen = new Set<string>();
      let classified = 0;
      for (const item of res.data?.items || []) {
        const row = rows[Number(item.i)];
        const category = String(item.category || "").trim().slice(0, 160);
        if (!row || !category) continue;
        const { error } = await admin.from("site_products")
          .update({ category_hint: category }).eq("id", row.id);
        if (!error) { classified++; seen.add(category); }
      }

      return jsonResponse({
        ok: true,
        classified,
        remaining: Math.max(0, rows.length - classified),
        categories: [...seen],
      });
    }

    return errorResponse("unknown action", 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[catalog-engine]", message);
    return errorResponse(message, 500);
  }
});
