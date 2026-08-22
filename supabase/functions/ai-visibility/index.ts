// P22 - AI Visibility checker.
// Asks several LLMs a commercial query and detects whether the project's brand
// is mentioned, at what position, and whether it is cited with a link.
// Writes only into the ai_visibility analytics table.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson } from "../_shared/aiClient.ts";

const MODELS: { key: string; model: string }[] = [
  { key: "chatgpt", model: "openai/gpt-4o-mini" },
  { key: "gemini", model: "google/gemini-2.5-flash" },
  { key: "claude", model: "anthropic/claude-sonnet-4" },
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    brands: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          site: { type: "string" },
          why: { type: "string" },
        },
        required: ["name", "site", "why"],
      },
    },
  },
  required: ["brands"],
};

interface Brand { name: string; site: string; why: string }

const norm = (s: string) =>
  s.toLowerCase().replace(/["'«»`.,]/g, "").replace(/\s+/g, " ").trim();

function matchEntity(brand: Brand, entity: string, domain: string): { hit: boolean; cited: boolean } {
  const e = norm(entity);
  const n = norm(brand.name);
  const site = norm(brand.site);
  const d = norm(domain).replace(/^https?:\/\//, "").replace(/^www\./, "");
  const hit = !!e && (n === e || n.includes(e) || e.includes(n));
  const cited = !!d && (site.includes(d) || norm(brand.why).includes(d));
  return { hit: hit || cited, cited };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const action = String(body?.action || "check");
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: projectRow } = await sb.from("projects")
      .select("id, user_id, name, company_name, domain, custom_domain, production_url, language, region, site_positioning")
      .eq("id", projectId).maybeSingle();
    if (!projectRow) return errorResponse("Project not found", 404);
    const project = projectRow as Record<string, string | null>;
    if (project.user_id !== auth.userId) return errorResponse("Forbidden", 403);

    if (action === "list") {
      const { data } = await sb.from("ai_visibility").select("*")
        .eq("project_id", projectId).order("checked_at", { ascending: false }).limit(300);
      return jsonResponse({ rows: data || [] });
    }

    if (action === "suggest") {
      const { data: kws } = await sb.from("site_keywords")
        .select("keyword").eq("project_id", projectId).limit(200);
      const seeds = Array.from(new Set(((kws || []) as { keyword: string }[])
        .map((k) => String(k.keyword || "").trim()).filter(Boolean))).slice(0, 12);
      if (seeds.length) return jsonResponse({ queries: seeds });
      const { data: prods } = await sb.from("site_products").select("name").eq("project_id", projectId).limit(12);
      return jsonResponse({
        queries: ((prods || []) as { name: string }[]).map((p) => p.name).filter(Boolean),
      });
    }

    // ---------------------------------------------------------------- check --
    const queries = (Array.isArray(body?.queries) ? body.queries as string[] : [])
      .map((q) => String(q || "").trim()).filter(Boolean).slice(0, 10);
    if (!queries.length) return errorResponse("queries required", 400);

    const entity = String(body?.entity || project.company_name || project.name || "").trim();
    if (!entity) return errorResponse("entity required", 400);
    const domain = String(project.custom_domain || project.domain || project.production_url || "");
    const ru = (project.language || "ru") === "ru";
    const region = project.region || "RU";

    const rows: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (const query of queries) {
      const results = await Promise.all(MODELS.map(async (m) => {
        try {
          const res = await chatJson<{ brands: Brand[] }>({
            model: m.model,
            system: ru
              ? "Ты выступаешь как AI-ассистент, который советует пользователю поставщиков и бренды. Отвечай честно, по памяти, без выдумок."
              : "You act as an AI assistant recommending suppliers and brands. Answer honestly from memory, do not invent.",
            user: ru
              ? `Запрос пользователя: "${query}". Регион: ${region}. Ниша: ${project.site_positioning || "-"}.\nПеречисли до 8 компаний или брендов в порядке, в котором ты бы их назвал пользователю. Для каждой укажи name, site (домен, если знаешь, иначе пустая строка), why (1 предложение). Если не знаешь ни одной - верни пустой массив.`
              : `User query: "${query}". Region: ${region}. Niche: ${project.site_positioning || "-"}.\nList up to 8 companies or brands in the order you would name them. For each give name, site (domain if known, else empty string), why (one sentence). If you know none, return an empty array.`,
            schema: SCHEMA,
            schemaName: "brands",
            temperature: 0.2,
            maxTokens: 900,
            projectId,
            userId: auth.userId,
            functionName: "ai-visibility",
          } as never);
          const brands = Array.isArray(res.data?.brands) ? res.data.brands : [];
          let position: number | null = null;
          let cited = false;
          brands.forEach((b, i) => {
            const mt = matchEntity(b, entity, domain);
            if (mt.hit && position === null) { position = i + 1; cited = mt.cited; }
          });
          const confidence = position === null ? 0 : Math.max(0.3, 1 - (position - 1) * 0.1);
          return {
            project_id: projectId,
            user_id: auth.userId,
            query,
            entity,
            model: m.key,
            mentioned: position !== null,
            position,
            cited,
            confidence,
            competitors: brands.slice(0, 8).map((b) => ({ name: b.name, site: b.site })),
            raw_answer: JSON.stringify(brands).slice(0, 4000),
            checked_at: new Date().toISOString(),
          };
        } catch (e) {
          errors.push(`${m.key}/${query}: ${e instanceof Error ? e.message : "failed"}`);
          return null;
        }
      }));
      for (const r of results) if (r) rows.push(r);
    }

    if (rows.length) {
      const { error } = await sb.from("ai_visibility").insert(rows);
      if (error) console.error("[ai-visibility] insert failed", error.message);
    }

    return jsonResponse({ success: true, inserted: rows.length, rows, errors });
  } catch (e) {
    console.error("[ai-visibility] error", e);
    return errorResponse(e instanceof Error ? e.message : "AI visibility check failed", 500);
  }
});
