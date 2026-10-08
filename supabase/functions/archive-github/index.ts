// Centralized client archive storage in one public GitHub repository.
// Layout: <kind>/<client-slug>/... where kind = "kb" | "rag".
// Body: { action: "upload", kind, client, files: { [path]: base64 } }
//     | { action: "delete", kind, client }
//     | { action: "list" }
// Admin only. Token: GITHUB_ARCHIVE_TOKEN, repo name: GITHUB_ARCHIVE_REPO (default "seo-archives").
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const API = "https://api.github.com";

function slug(s: string): string {
  const map: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
  return (s || "").toLowerCase().split("").map((c) => map[c] ?? c).join("")
    .replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: auth.userId, _role: "admin" });
    if (!isAdmin) return errorResponse("Только для администратора", 403);

    const token = (Deno.env.get("GITHUB_ARCHIVE_TOKEN") || "").trim();
    if (!token) return errorResponse("Не задан токен GitHub для архива", 400);
    const repoName = (Deno.env.get("GITHUB_ARCHIVE_REPO") || "seo-archives").trim();

    const gh = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "seo-modul", ...(init.headers || {}) },
      });
      const text = await r.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { ok: r.ok, status: r.status, body };
    };
    const must = async (path: string, init: RequestInit = {}) => {
      const r = await gh(path, init);
      if (!r.ok) throw new Error(`GitHub ${r.status} ${path}: ${typeof r.body === "string" ? r.body : r.body?.message || ""}`.slice(0, 400));
      return r.body;
    };

    const user = await must("/user");
    const owner: string = user.login;
    const full = `/repos/${owner}/${repoName}`;

    // Ensure repository exists (public, initialized with README so main exists).
    let repo = await gh(full);
    if (repo.status === 404) {
      await must("/user/repos", { method: "POST", body: JSON.stringify({ name: repoName, private: false, auto_init: true, description: "Client knowledge bases and RAG archives (SEO-Module)" }) });
      for (let i = 0; i < 10; i++) { repo = await gh(full); if (repo.ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!repo.ok) throw new Error(`Репозиторий недоступен: ${repo.status}`);
    const branch: string = repo.body.default_branch || "main";
    const repoUrl = `https://github.com/${owner}/${repoName}`;

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    const ref = await must(`${full}/git/ref/heads/${branch}`);
    const headSha: string = ref.object.sha;
    const headCommit = await must(`${full}/git/commits/${headSha}`);
    const tree = await must(`${full}/git/trees/${headCommit.tree.sha}?recursive=1`);
    const blobs: any[] = (tree.tree || []).filter((e: any) => e.type === "blob");

    if (action === "list") {
      const set = new Map<string, number>();
      for (const b of blobs) {
        const m = /^(kb|rag)\/([^/]+)\//.exec(b.path);
        if (m) set.set(`${m[1]}/${m[2]}`, (set.get(`${m[1]}/${m[2]}`) || 0) + 1);
      }
      return jsonResponse({ ok: true, repoUrl, items: [...set].map(([path, files]) => ({ path, files, url: `${repoUrl}/tree/${branch}/${path}` })) });
    }

    const kind = body.kind === "rag" ? "rag" : body.kind === "kb" ? "kb" : null;
    const client = slug(String(body.client || ""));
    if (!kind || !client) return errorResponse("Нужны kind и client", 400);
    const prefix = `${kind}/${client}/`;

    const keep = blobs.filter((b) => !b.path.startsWith(prefix)).map((b) => ({ path: b.path, mode: b.mode, type: "blob", sha: b.sha }));
    const entries: any[] = [...keep];
    let message = "";

    if (action === "upload") {
      const files = body.files && typeof body.files === "object" ? body.files as Record<string, string> : {};
      const paths = Object.keys(files);
      if (!paths.length) return errorResponse("Нет файлов", 400);
      for (const p of paths) {
        const clean = p.replace(/^\/+/, "").replace(/\.\.+\//g, "");
        const blob = await must(`${full}/git/blobs`, { method: "POST", body: JSON.stringify({ content: files[p], encoding: "base64" }) });
        entries.push({ path: prefix + clean, mode: "100644", type: "blob", sha: blob.sha });
      }
      message = `Update ${prefix} (${paths.length} files)`;
    } else if (action === "delete") {
      if (keep.length === blobs.length) return jsonResponse({ ok: true, repoUrl, deleted: 0 });
      message = `Delete ${prefix}`;
    } else {
      return errorResponse("Неизвестное действие", 400);
    }

    const newTree = await must(`${full}/git/trees`, { method: "POST", body: JSON.stringify({ tree: entries }) });
    const commit = await must(`${full}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }) });
    await must(`${full}/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });

    return jsonResponse({ ok: true, repoUrl, url: `${repoUrl}/tree/${branch}/${prefix}`, deleted: blobs.length - keep.length });
  } catch (e: any) {
    console.error("[archive-github]", e?.message || e);
    return errorResponse(e?.message || String(e), 500);
  }
});
