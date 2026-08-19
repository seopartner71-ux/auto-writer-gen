// Builds a draft SILO tree (silos -> categories) out of project semantics.
//
// Input : { project_id, mode?: "build" | "merge_duplicates" }
// Source: public.site_keywords rows for that project.
// Output: created site_silos / site_clusters rows (status 'draft') plus the
//         keyword -> cluster assignment. Nothing existing is deleted.
//
// The build is IDEMPOTENT: an existing silo / cluster with the same normalised
// name (or slug) is reused and updated in place, never duplicated. Keyword and
// product links survive a re-run.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

function slugify(v: string): string {
  const map: Record<string, string> = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",
    р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
  };
  return String(v || "").toLowerCase().split("").map((c) => map[c] ?? c).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Normalised entity key: case, "ё", punctuation and spacing insensitive. */
function nameKey(v: string): string {
  return String(v || "").toLowerCase().replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ").trim();
}

function parseJsonLoose(text: string): any | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { return null; }
}

// Repairs a JSON object that was cut off mid-generation by closing open
// strings/brackets after dropping the trailing incomplete fragment.
function parseJsonTruncated(text: string): any | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  const body = cleaned.slice(start);
  const stack: string[] = [];
  let inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") stack.pop();
    else if (c === ",") lastSafe = i;
  }
  const candidates = [body.length, lastSafe > 0 ? lastSafe : -1].filter((n) => n > 0);
  for (const cut of candidates) {
    let frag = body.slice(0, cut).replace(/,\s*$/, "");
    const st: string[] = [];
    let s2 = false, e2 = false;
    for (const c of frag) {
      if (s2) { if (e2) e2 = false; else if (c === "\\") e2 = true; else if (c === '"') s2 = false; continue; }
      if (c === '"') s2 = true;
      else if (c === "{") st.push("}");
      else if (c === "[") st.push("]");
      else if (c === "}" || c === "]") st.pop();
    }
    if (s2) frag += '"';
    frag = frag.replace(/,\s*$/, "");
    while (st.length) frag += st.pop();
    try { return JSON.parse(frag); } catch { /* try next */ }
  }
  return null;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const mode = String(body?.mode || "build");
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: project, error: projectErr } = await sb.from("projects")
      .select("id, user_id, name, domain, language").eq("id", projectId).maybeSingle();
    if (projectErr) return errorResponse(`Project lookup failed: ${projectErr.message}`, 500);
    if (!project) return errorResponse("Project not found", 404);
    if ((project as any).user_id !== auth.userId) {
      const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", auth.userId);
      const isAdmin = (roles || []).some((r: any) => r.role === "admin" || r.role === "staff");
      if (!isAdmin) return errorResponse("Forbidden", 403);
    }

    // ---- mode: merge duplicates (explicit, never runs during a build) ------
    if (mode === "merge_duplicates") {
      const [{ data: allSilos }, { data: allClusters }] = await Promise.all([
        sb.from("site_silos").select("id, name, slug, created_at").eq("project_id", projectId).neq("status", "archived"),
        sb.from("site_clusters").select("id, silo_id, name, slug, created_at").eq("project_id", projectId).neq("status", "archived"),
      ]);
      let mergedSilos = 0, mergedClusters = 0;

      const groupBy = <T extends { name: string }>(rows: T[], key: (r: T) => string) => {
        const m = new Map<string, T[]>();
        for (const r of rows) {
          const k = key(r);
          m.set(k, [...(m.get(k) || []), r]);
        }
        return m;
      };

      // clusters first: they carry the keyword / product links
      for (const [, group] of groupBy((allClusters || []) as any[], (c) => nameKey(c.name))) {
        if (group.length < 2) continue;
        const keeper = group[0];
        for (const dup of group.slice(1)) {
          await sb.from("site_keywords").update({ site_cluster_id: keeper.id, silo_id: keeper.silo_id })
            .eq("project_id", projectId).eq("site_cluster_id", dup.id);
          await sb.from("site_products").update({ site_cluster_id: keeper.id, silo_id: keeper.silo_id })
            .eq("project_id", projectId).eq("site_cluster_id", dup.id);
          await sb.from("site_clusters").update({ parent_id: keeper.id }).eq("parent_id", dup.id);
          await sb.from("site_clusters").update({ status: "archived" }).eq("id", dup.id);
          mergedClusters++;
        }
      }

      const { data: freshClusters } = await sb.from("site_clusters")
        .select("id, silo_id, name").eq("project_id", projectId).neq("status", "archived");
      for (const [, group] of groupBy((allSilos || []) as any[], (s) => nameKey(s.name))) {
        if (group.length < 2) continue;
        // keep the silo that already holds the most categories
        const count = (id: string) => (freshClusters || []).filter((c: any) => c.silo_id === id).length;
        const sorted = [...group].sort((a, b) => count(b.id) - count(a.id));
        const keeper = sorted[0];
        for (const dup of sorted.slice(1)) {
          await sb.from("site_clusters").update({ silo_id: keeper.id }).eq("project_id", projectId).eq("silo_id", dup.id);
          await sb.from("site_keywords").update({ silo_id: keeper.id }).eq("project_id", projectId).eq("silo_id", dup.id);
          await sb.from("site_products").update({ silo_id: keeper.id }).eq("project_id", projectId).eq("silo_id", dup.id);
          await sb.from("site_silos").update({ status: "archived" }).eq("id", dup.id);
          mergedSilos++;
        }
      }
      // after merging, dedupe categories that ended up twice inside one silo
      const { data: afterClusters } = await sb.from("site_clusters")
        .select("id, silo_id, name").eq("project_id", projectId).neq("status", "archived");
      for (const [, group] of groupBy((afterClusters || []) as any[], (c) => `${c.silo_id}|${nameKey(c.name)}`)) {
        if (group.length < 2) continue;
        const keeper = group[0];
        for (const dup of group.slice(1)) {
          await sb.from("site_keywords").update({ site_cluster_id: keeper.id })
            .eq("project_id", projectId).eq("site_cluster_id", dup.id);
          await sb.from("site_products").update({ site_cluster_id: keeper.id })
            .eq("project_id", projectId).eq("site_cluster_id", dup.id);
          await sb.from("site_clusters").update({ status: "archived" }).eq("id", dup.id);
          mergedClusters++;
        }
      }
      return jsonResponse({ success: true, mode, merged_silos: mergedSilos, merged_clusters: mergedClusters });
    }

    const { data: kwRows } = await sb.from("site_keywords")
      .select("id, keyword, frequency, intent")
      .eq("project_id", projectId)
      .order("frequency", { ascending: false })
      .limit(600);
    const keywords = (kwRows || []) as any[];
    if (!keywords.length) return errorResponse("Нет семантики: сначала импортируйте ключевые слова", 400);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const lang = String((project as any).language || "ru");
    const system = `Ты SEO-архитектор коммерческих сайтов. Строишь SILO-структуру из семантики.
Правила:
- 3-8 силосов верхнего уровня (крупные направления: услуги, категории товаров, блог/информационное).
- В каждом силосе 2-10 категорий (кластеров).
- Коммерческие и информационные интенты разносить по разным силосам.
- Названия короткие, человеческие, без кавычек и без буквы "е с двумя точками".
- Каждому кластеру назначь список ключей из входного массива (точные строки).
Верни строго JSON:
{"silos":[{"name":"...","description":"...","page_type":"silo_hub","clusters":[{"name":"...","description":"...","page_type":"category","keywords":["..."]}]}]}`;

    const userMsg = `Проект: ${(project as any).name}. Сайт: ${(project as any).domain || "-"}. Язык: ${lang}.
Ключевые слова (${keywords.length}):
${keywords.map((k) => `- ${k.keyword}${k.frequency ? ` (${k.frequency})` : ""}${k.intent ? ` [${k.intent}]` : ""}`).join("\n").slice(0, 24000)}

Построй структуру и верни JSON.`;

    const upstream = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Module SILO Builder",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 24000,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
        }),
      }),
      90_000,
      "silo builder timeout",
    );
    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      return errorResponse(`Upstream ${upstream.status}: ${txt.slice(0, 200)}`, 502);
    }
    const json = await upstream.json();
    try {
      logLLM({
        functionName: "build-silo-from-semantics",
        model: json?.model,
        tokensIn: Number(json?.usage?.prompt_tokens || 0),
        tokensOut: Number(json?.usage?.completion_tokens || 0),
      });
    } catch (_) { /* ignore */ }

    const rawContent = String(json?.choices?.[0]?.message?.content || "");
    const finishReason = json?.choices?.[0]?.finish_reason;
    const parsed = parseJsonLoose(rawContent) || parseJsonTruncated(rawContent);
    const siloDefs = Array.isArray(parsed?.silos) ? parsed.silos.slice(0, 8) : [];
    if (!siloDefs.length) {
      console.error("[build-silo] parse failed", {
        finish_reason: finishReason,
        chars: rawContent.length,
        head: rawContent.slice(0, 300),
        tail: rawContent.slice(-300),
      });
      return errorResponse(
        `Модель не вернула структуру (finish_reason: ${finishReason || "?"}, ${rawContent.length} симв.)`,
        502,
      );
    }

    const [{ data: existingSilos }, { data: existingClusters }] = await Promise.all([
      sb.from("site_silos").select("id, name, slug, status").eq("project_id", projectId),
      sb.from("site_clusters").select("id, silo_id, name, slug, status").eq("project_id", projectId),
    ]);
    const siloByKey = new Map<string, any>();
    for (const s of (existingSilos || []) as any[]) {
      siloByKey.set(nameKey(s.name), s);
      siloByKey.set(`slug:${s.slug}`, s);
    }
    const clusterByKey = new Map<string, any>();
    for (const c of (existingClusters || []) as any[]) {
      clusterByKey.set(`${c.silo_id}|${nameKey(c.name)}`, c);
      clusterByKey.set(`${c.silo_id}|slug:${c.slug}`, c);
      // a cluster that only exists under another silo is still reusable
      if (!clusterByKey.has(nameKey(c.name))) clusterByKey.set(nameKey(c.name), c);
    }
    const usedSlugs = new Set((existingSilos || []).map((s: any) => s.slug));
    const uniq = (base: string) => {
      let s = base || "silo", i = 2;
      while (usedSlugs.has(s)) s = `${base}-${i++}`;
      usedSlugs.add(s);
      return s;
    };

    const kwByText = new Map(keywords.map((k) => [String(k.keyword).toLowerCase().trim(), k.id]));
    let siloCount = 0, clusterCount = 0, assigned = 0, siloReused = 0, clusterReused = 0;

    for (const [si, s] of siloDefs.entries()) {
      const name = String(s?.name || "").trim();
      if (!name) continue;
      const wantedSlug = slugify(name);
      const existingSilo = siloByKey.get(nameKey(name)) || siloByKey.get(`slug:${wantedSlug}`);
      let siloRow: { id: string } | null = null;
      if (existingSilo) {
        // reuse: keep the slug (URL stability) and only refresh soft fields
        await sb.from("site_silos").update({
          name,
          description: String(s?.description || "").slice(0, 400) || null,
          position: si,
          page_type: String(s?.page_type || "silo_hub"),
          ...(existingSilo.status === "archived" ? { status: "draft" } : {}),
        }).eq("id", existingSilo.id);
        siloRow = { id: existingSilo.id };
        siloReused++;
      } else {
        const { data: created, error: siloErr } = await sb.from("site_silos").insert({
          project_id: projectId,
          name,
          slug: uniq(wantedSlug),
          description: String(s?.description || "").slice(0, 400) || null,
          position: si,
          status: "draft",
          page_type: String(s?.page_type || "silo_hub"),
        }).select("id, name, slug").single();
        if (siloErr || !created) continue;
        siloByKey.set(nameKey(name), created);
        siloRow = { id: created.id };
        siloCount++;
      }

      const clusters = Array.isArray(s?.clusters) ? s.clusters.slice(0, 12) : [];
      const clusterSlugs = new Set<string>();
      for (const [ci, c] of clusters.entries()) {
        const cname = String(c?.name || "").trim();
        if (!cname) continue;
        const baseSlug = slugify(cname) || `cat-${ci + 1}`;
        const existingCluster =
          clusterByKey.get(`${siloRow.id}|${nameKey(cname)}`) ||
          clusterByKey.get(`${siloRow.id}|slug:${baseSlug}`) ||
          clusterByKey.get(nameKey(cname));
        let clRow: { id: string } | null = null;
        if (existingCluster) {
          await sb.from("site_clusters").update({
            name: cname,
            silo_id: siloRow.id,
            description: String(c?.description || "").slice(0, 400) || null,
            position: ci,
            page_type: String(c?.page_type || "category"),
            ...(existingCluster.status === "archived" ? { status: "draft" } : {}),
          }).eq("id", existingCluster.id);
          clRow = { id: existingCluster.id };
          clusterSlugs.add(existingCluster.slug || baseSlug);
          clusterReused++;
        } else {
          let cslug = baseSlug;
          let i = 2;
          while (clusterSlugs.has(cslug)) cslug = `${baseSlug}-${i++}`;
          clusterSlugs.add(cslug);
          const { data: created } = await sb.from("site_clusters").insert({
            project_id: projectId,
            silo_id: siloRow.id,
            name: cname,
            slug: cslug,
            description: String(c?.description || "").slice(0, 400) || null,
            position: ci,
            type: "cluster",
            status: "draft",
            page_type: String(c?.page_type || "category"),
          }).select("id, name, slug, silo_id").single();
          if (!created) continue;
          clusterByKey.set(`${siloRow.id}|${nameKey(cname)}`, created);
          if (!clusterByKey.has(nameKey(cname))) clusterByKey.set(nameKey(cname), created);
          clRow = { id: created.id };
          clusterCount++;
        }

        const ids = (Array.isArray(c?.keywords) ? c.keywords : [])
          .map((k: any) => kwByText.get(String(k).toLowerCase().trim()))
          .filter(Boolean);
        if (ids.length) {
          await sb.from("site_keywords")
            .update({ silo_id: siloRow.id, site_cluster_id: clRow.id, status: "assigned" })
            .in("id", ids);
          assigned += ids.length;
        }
      }
    }

    return jsonResponse({
      success: true,
      silos: siloCount,
      clusters: clusterCount,
      silos_reused: siloReused,
      clusters_reused: clusterReused,
      keywords_assigned: assigned,
      note: "Структура создана в статусе draft. Проверьте и активируйте её перед деплоем.",
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});