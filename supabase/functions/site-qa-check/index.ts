// Pre-flight QA for a Site Factory bundle.
//
// Builds the bundle with build_only=true (no deploy) and validates it:
// titles, descriptions, H1s, canonical, sitemap/robots, internal 404s,
// duplicate titles, missing alt attributes. Saves the report to
// projects.last_qa_report and returns it. Also returns the bundle when
// { include_files: true } so the UI can offer a ZIP export.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

interface Issue { level: "error" | "warning"; kind: string; page: string; detail?: string }

function textOf(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

function auditBundle(files: Record<string, string>, domain: string) {
  const issues: Issue[] = [];
  const pages = Object.keys(files).filter((k) => k.endsWith(".html") && k !== "404.html");
  const titles = new Map<string, string[]>();
  const known = new Set(pages.map((p) => "/" + p.replace(/index\.html$/, "")));
  for (const p of pages) known.add("/" + p);

  for (const page of pages) {
    const html = files[page];
    if (/noindex/i.test(html)) continue; // redirect stubs
    const title = textOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || "";
    const h1s = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || "";

    if (!title) issues.push({ level: "error", kind: "missing_title", page });
    else {
      if (title.length > 65) issues.push({ level: "warning", kind: "long_title", page, detail: `${title.length} симв.` });
      const arr = titles.get(title) || [];
      arr.push(page); titles.set(title, arr);
    }
    if (!desc) issues.push({ level: "error", kind: "missing_description", page });
    else if (desc.length > 160) issues.push({ level: "warning", kind: "long_description", page, detail: `${desc.length} симв.` });
    if (h1s.length === 0) issues.push({ level: "error", kind: "missing_h1", page });
    if (h1s.length > 1) issues.push({ level: "error", kind: "multiple_h1", page, detail: `${h1s.length}` });
    if (!canonical) issues.push({ level: "warning", kind: "missing_canonical", page });
    else if (domain && !canonical.includes(domain)) {
      issues.push({ level: "error", kind: "foreign_canonical", page, detail: canonical });
    }

    const imgs = html.match(/<img\b[^>]*>/gi) || [];
    const noAlt = imgs.filter((t) => !/\balt=/.test(t)).length;
    if (noAlt) issues.push({ level: "warning", kind: "img_without_alt", page, detail: `${noAlt}` });

    for (const m of html.matchAll(/href=["'](\/[^"'#?]*)["']/g)) {
      const href = m[1];
      if (/\.(css|js|xml|txt|png|jpe?g|svg|webp|ico)$/i.test(href)) continue;
      const key = href.replace(/^\//, "");
      const candidates = [key, `${key}index.html`, `${key}/index.html`, `${key}.html`];
      if (!candidates.some((c) => files[c] !== undefined)) {
        issues.push({ level: "error", kind: "broken_internal_link", page, detail: href });
      }
    }
  }

  for (const [title, list] of titles) {
    if (list.length > 1) {
      issues.push({ level: "warning", kind: "duplicate_title", page: list.join(", "), detail: title });
    }
  }
  if (!files["sitemap.xml"]) issues.push({ level: "error", kind: "missing_sitemap", page: "sitemap.xml" });
  if (!files["robots.txt"]) issues.push({ level: "error", kind: "missing_robots", page: "robots.txt" });

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const score = Math.max(0, 100 - errors * 6 - warnings * 2);
  return {
    checked_at: new Date().toISOString(),
    pages: pages.length,
    errors,
    warnings,
    score,
    ok: errors === 0,
    issues: issues.slice(0, 200),
  };
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
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: project } = await sb.from("projects").select("id, user_id").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("Project not found", 404);
    if ((project as any).user_id !== auth.userId) return errorResponse("Forbidden", 403);

    const { data: built, error: buildErr } = await sb.functions.invoke("deploy-cloudflare-direct", {
      body: { project_id: projectId, build_only: true },
    });
    if (buildErr) return errorResponse(`Build failed: ${buildErr.message}`, 502);
    const files = (built as any)?.files as Record<string, string> | undefined;
    if (!files) return errorResponse((built as any)?.error || "Build returned no files", 502);

    const report = auditBundle(files, String((built as any)?.domain || ""));
    await sb.from("projects").update({ last_qa_report: report }).eq("id", projectId);

    return jsonResponse({ success: true, report, ...(includeFiles ? { files } : {}) });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});