// Pre-flight QA for a Site Factory bundle (P7.4 / P7.5 / P7.10).
//
// Builds the bundle with build_only=true (read-only, no DB writes, no deploy)
// and validates it with the shared audit engine. Saves the report to
// projects.last_qa_report and returns it. With { include_files: true } the
// bundle is returned for ZIP export; with { mode: "full_static" } external
// images are downloaded and returned base64-encoded so the archive is a
// self-contained static site.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { auditBundle, type StructureFacts } from "../_shared/siteAudit.ts";

const MAX_ASSETS = 150;
const MAX_ASSET_BYTES = 3_000_000;

function extOf(url: string): string {
  const m = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
  return (m?.[1] || "jpg").toLowerCase();
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Downloads remote images and rewrites every reference to a local path. */
async function localizeAssets(files: Record<string, string>) {
  const urls = new Set<string>();
  for (const [key, content] of Object.entries(files)) {
    if (!key.endsWith(".html") && !key.endsWith(".css")) continue;
    for (const m of String(content).matchAll(/https?:\/\/[^\s"'()<>]+\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s"'()<>]*)?/gi)) {
      urls.add(m[0]);
    }
  }
  const list = [...urls].slice(0, MAX_ASSETS);
  const assets: Record<string, string> = {};
  const map = new Map<string, string>();
  let idx = 0;
  await Promise.all(list.map(async (url) => {
    const local = `assets/img/${String(++idx).padStart(3, "0")}.${extOf(url)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_ASSET_BYTES) return;
      assets[local] = toBase64(buf);
      map.set(url, `/${local}`);
    } catch { /* keep the remote URL when the download fails */ }
  }));
  for (const [key, content] of Object.entries(files)) {
    if (!key.endsWith(".html") && !key.endsWith(".css")) continue;
    let out = String(content);
    for (const [url, local] of map) out = out.split(url).join(local);
    files[key] = out;
  }
  return { assets, localized: map.size, requested: list.length };
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    const includeFiles = body?.include_files === true;
    const fullStatic = String(body?.mode || "") === "full_static";
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: project } = await sb.from("projects")
      .select("id, user_id, custom_domain, domain").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("Project not found", 404);
    if ((project as Record<string, unknown>).user_id !== auth.userId) return errorResponse("Forbidden", 403);

    const { data: built, error: buildErr } = await sb.functions.invoke("deploy-cloudflare-direct", {
      body: { project_id: projectId, build_only: true },
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        "x-queue-user-id": auth.userId,
      },
    });
    if (buildErr) {
      // supabase-js masks the real failure as "non-2xx status code" — read the
      // upstream response so the UI shows the actual status and error body.
      let status = 502;
      let detail = buildErr.message;
      const ctx = (buildErr as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        try {
          status = ctx.status || 502;
          const raw = await ctx.text();
          try {
            const parsed = JSON.parse(raw);
            detail = String(parsed?.error || raw);
          } catch {
            detail = raw || detail;
          }
        } catch { /* keep defaults */ }
      }
      console.error("[site-qa-check] build failed", status, detail);
      return errorResponse(`Build failed (${status}): ${detail}`, status >= 400 && status < 600 ? status : 502);
    }
    const built0 = built as Record<string, unknown> | null;
    const files = built0?.files as Record<string, string> | undefined;
    if (!files) return errorResponse(String(built0?.error || "Build returned no files"), 502);

    // Structural facts straight from the database (orphans, empty categories).
    const [{ data: silos }, { data: clusters }, { data: products }] = await Promise.all([
      sb.from("site_silos").select("id, name, status, seo_content").eq("project_id", projectId).neq("status", "archived"),
      sb.from("site_clusters").select("id, silo_id, name, status, seo_content").eq("project_id", projectId).neq("status", "archived"),
      sb.from("site_products").select("id, name, site_cluster_id, silo_id, kind, url_path, seo_content").eq("project_id", projectId)
        .neq("status", "archived").limit(2000),
    ]);
    const { data: kwFacts } = await sb.from("site_keywords")
      .select("keyword, target_type, target_id").eq("project_id", projectId).limit(2000);
    const { buildContentFacts } = await import("../_shared/commerceContent.ts");
    const structure: StructureFacts = {
      silos: (silos || []) as StructureFacts["silos"],
      clusters: (clusters || []) as StructureFacts["clusters"],
      products: (products || []) as StructureFacts["products"],
      content: (products || []).length
        ? buildContentFacts({ silos: silos || [], clusters: clusters || [], products: products || [] })
        : undefined,
      keywords: (kwFacts || []) as StructureFacts["keywords"],
    };

    const domain = String(
      built0?.canonical_domain || (project as Record<string, unknown>).custom_domain || built0?.domain || "",
    );
    const report = auditBundle(files, domain, structure);
    await sb.from("projects").update({ last_qa_report: report }).eq("id", projectId);

    let assets: Record<string, string> | undefined;
    let assetStats: Record<string, number> | undefined;
    if (includeFiles && fullStatic) {
      const res = await localizeAssets(files);
      assets = res.assets;
      assetStats = { localized: res.localized, requested: res.requested };
    }

    return jsonResponse({
      success: true,
      report,
      domain,
      ...(includeFiles ? { files } : {}),
      ...(assets ? { assets, asset_stats: assetStats } : {}),
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
