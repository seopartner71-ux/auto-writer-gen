// P7.1 - Automatic product -> category (cluster) assignment.
//
// Strategy, cheapest first:
//   1. exact/normalised match of category_hint against cluster names
//   2. lexical similarity (token overlap of name + brand + hint vs cluster
//      name, description and its keywords)
//   3. embeddings (Lovable AI gateway) for everything still unresolved
//
// Confidence >= 0.75 -> auto-assign, 0.45..0.75 -> "review", below -> untouched.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

const AUTO = 0.75;
const REVIEW = 0.45;

const STOP = new Set([
  "и","в","на","для","с","по","от","до","из","the","and","for","of","a","an",
  "купить","цена","заказать","услуги","услуга","товар","товары","buy","price",
]);

function tokens(s: string): string[] {
  return String(s || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.slice(0, 7)); // crude stemming: cut RU endings
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function embed(texts: string[]): Promise<number[][] | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key || !texts.length) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts.slice(0, 256) }),
    });
    if (!res.ok) { console.warn("[assign] embeddings failed:", res.status); return null; }
    const json = await res.json();
    return (json?.data || []).map((d: { embedding: number[] }) => d.embedding);
  } catch (e) {
    console.warn("[assign] embeddings error:", (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const onlyUnassigned = body?.only_unassigned !== false;
    const dryRun = body?.dry_run === true;
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: project } = await sb.from("projects").select("id, user_id").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("Project not found", 404);
    if ((project as Record<string, unknown>).user_id !== auth.userId) return errorResponse("Forbidden", 403);

    const [{ data: clusterRows }, { data: productRows }, { data: kwRows }] = await Promise.all([
      sb.from("site_clusters").select("id, name, description, silo_id").eq("project_id", projectId).neq("status", "archived"),
      sb.from("site_products").select("id, name, brand, description, category_hint, site_cluster_id, assignment_status")
        .eq("project_id", projectId).neq("status", "archived").limit(2000),
      sb.from("site_keywords").select("keyword, site_cluster_id").eq("project_id", projectId).limit(4000),
    ]);

    const clusters = (clusterRows || []) as { id: string; name: string; description: string | null; silo_id: string | null }[];
    if (!clusters.length) return errorResponse("No categories to assign to - build the SILO structure first", 400);

    const kwByCluster = new Map<string, string[]>();
    for (const k of (kwRows || []) as { keyword: string; site_cluster_id: string | null }[]) {
      if (!k.site_cluster_id) continue;
      const arr = kwByCluster.get(k.site_cluster_id) || [];
      if (arr.length < 40) arr.push(k.keyword);
      kwByCluster.set(k.site_cluster_id, arr);
    }

    const clusterText = clusters.map((c) =>
      [c.name, c.description || "", ...(kwByCluster.get(c.id) || [])].join(" "));
    const clusterTokens = clusterText.map(tokens);
    const nameKey = new Map(clusters.map((c, i) => [c.name.trim().toLowerCase(), i]));

    const products = ((productRows || []) as {
      id: string; name: string; brand: string | null; description: string | null;
      category_hint: string | null; site_cluster_id: string | null; assignment_status: string;
    }[]).filter((p) => (onlyUnassigned ? !p.site_cluster_id : true));

    const results: { id: string; name: string; cluster_id: string | null; confidence: number; status: string; method: string }[] = [];
    const unresolved: number[] = [];

    products.forEach((p, idx) => {
      const hint = (p.category_hint || "").trim().toLowerCase();
      const exact = hint ? nameKey.get(hint) : undefined;
      if (exact !== undefined) {
        results[idx] = { id: p.id, name: p.name, cluster_id: clusters[exact].id, confidence: 0.99, status: "auto", method: "hint_exact" };
        return;
      }
      const pt = tokens([p.name, p.brand || "", p.category_hint || "", (p.description || "").slice(0, 200)].join(" "));
      let best = -1, bestScore = 0;
      clusterTokens.forEach((ct, i) => {
        const s = jaccard(pt, ct);
        if (s > bestScore) { bestScore = s; best = i; }
      });
      if (best >= 0 && bestScore >= AUTO) {
        results[idx] = { id: p.id, name: p.name, cluster_id: clusters[best].id, confidence: Number(bestScore.toFixed(2)), status: "auto", method: "lexical" };
      } else {
        results[idx] = { id: p.id, name: p.name, cluster_id: best >= 0 ? clusters[best].id : null, confidence: Number(bestScore.toFixed(2)), status: "review", method: "lexical" };
        unresolved.push(idx);
      }
    });

    // Embeddings pass for everything the lexical stage could not settle.
    if (unresolved.length) {
      const [clusterVecs, productVecs] = await Promise.all([
        embed(clusterText),
        embed(unresolved.slice(0, 256).map((i) => {
          const p = products[i];
          return [p.name, p.brand || "", p.category_hint || "", (p.description || "").slice(0, 300)].join(" ");
        })),
      ]);
      if (clusterVecs && productVecs) {
        unresolved.slice(0, 256).forEach((pi, vi) => {
          const vec = productVecs[vi];
          if (!vec) return;
          let best = -1, bestScore = 0;
          clusterVecs.forEach((cv, ci) => {
            const s = cosine(vec, cv);
            if (s > bestScore) { bestScore = s; best = ci; }
          });
          if (best < 0) return;
          const conf = Number(bestScore.toFixed(2));
          if (conf <= results[pi].confidence) return;
          results[pi] = {
            id: products[pi].id, name: products[pi].name, cluster_id: clusters[best].id,
            confidence: conf, method: "embedding",
            status: conf >= AUTO ? "auto" : conf >= REVIEW ? "review" : "unassigned",
          };
        });
      }
    }

    let assigned = 0, review = 0, skipped = 0;
    for (const r of results) {
      if (!r) continue;
      if (r.status === "auto" && r.cluster_id) assigned++;
      else if (r.status === "review" && r.cluster_id && r.confidence >= REVIEW) review++;
      else skipped++;
    }

    if (!dryRun) {
      for (const r of results) {
        if (!r) continue;
        const applies = r.cluster_id && (r.status === "auto" || (r.status === "review" && r.confidence >= REVIEW));
        if (!applies) {
          await sb.from("site_products").update({ assignment_status: "unassigned", cluster_confidence: r.confidence }).eq("id", r.id);
          continue;
        }
        await sb.from("site_products").update({
          site_cluster_id: r.status === "auto" ? r.cluster_id : null,
          silo_id: clusters.find((c) => c.id === r.cluster_id)?.silo_id || null,
          cluster_confidence: r.confidence,
          assignment_status: r.status === "auto" ? "auto" : "review",
        }).eq("id", r.id);
      }
    }

    return jsonResponse({
      success: true, dry_run: dryRun,
      totals: { processed: results.filter(Boolean).length, assigned, review, skipped },
      suggestions: results.filter(Boolean).slice(0, 200),
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
