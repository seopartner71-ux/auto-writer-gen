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

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (action === "publish_pages") return await publishPages(body, gh, must);

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

// Updates the client's own GitHub Pages repository (owner/name): uploads the archive (without site/),
// replaces generator-owned folders, removes junk one-byte "1" files and adds search-engine verification files.
const GEN_DIRS = ["data/", "docs/", "sources/", "assets/", "site/"];
const GOOGLE_RE = /^google[a-z0-9]{8,40}\.html$/;
const YANDEX_RE = /^yandex_[a-z0-9]{8,40}\.html$/;
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

async function publishPages(body: any, gh: any, must: any): Promise<Response> {
  const repoFull = String(body.repo || "").trim();
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repoFull)) return errorResponse("Укажите репозиторий как владелец/имя", 400);
  const files = body.files && typeof body.files === "object" ? body.files as Record<string, string> : {};
  const paths = Object.keys(files).map((p) => p.replace(/^\/+/, "")).filter((p) => !p.includes("..") && !p.startsWith("site/"));
  if (!paths.length) return errorResponse("Нет файлов", 400);
  const google = String(body.google || "").trim().toLowerCase();
  const yandex = String(body.yandex || "").trim().toLowerCase();
  if (google && !GOOGLE_RE.test(google)) return errorResponse("Файл Google должен называться как googleXXXX.html", 400);
  if (yandex && !YANDEX_RE.test(yandex)) return errorResponse("Файл Яндекса должен называться как yandex_XXXX.html", 400);

  const full = `/repos/${repoFull}`;
  const repo = await gh(full);
  if (repo.status === 404) return errorResponse(`Репозиторий ${repoFull} не найден или токен GitHub не имеет к нему доступа`, 404);
  if (!repo.ok) throw new Error(`Репозиторий недоступен: ${repo.status}`);
  if (repo.body?.permissions && !repo.body.permissions.push) return errorResponse(`У токена GitHub нет права записи в ${repoFull}`, 403);
  const branch: string = repo.body.default_branch || "main";
  const ref = await must(`${full}/git/ref/heads/${branch}`);
  const headSha: string = ref.object.sha;
  const headCommit = await must(`${full}/git/commits/${headSha}`);
  const tree = await must(`${full}/git/trees/${headCommit.tree.sha}?recursive=1`);
  const blobs: any[] = (tree.tree || []).filter((e: any) => e.type === "blob");

  const incoming = new Set(paths);
  const isJunk = (b: any) => /(^|\/)1$/.test(b.path) && (b.size ?? 0) <= 2;
  const removed: string[] = [];
  const keep = blobs.filter((b) => {
    const drop = isJunk(b) || incoming.has(b.path) || GEN_DIRS.some((d) => b.path.startsWith(d));
    if (drop && !incoming.has(b.path)) removed.push(b.path);
    return !drop;
  }).map((b) => ({ path: b.path, mode: b.mode, type: "blob", sha: b.sha }));

  const extra: Record<string, string> = {};
  if (google) extra[google] = b64(`google-site-verification: ${google}`);
  if (yandex) extra[yandex] = b64(`<html>\n    <head>\n        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n    </head>\n    <body>Verification: ${yandex.replace(/^yandex_|\.html$/g, "")}</body>\n</html>\n`);
  const all: Record<string, string> = {};
  for (const p of Object.keys(files)) { const c = p.replace(/^\/+/, ""); if (incoming.has(c)) all[c] = files[p]; }
  Object.assign(all, extra);
  const entries: any[] = keep.filter((e) => !(e.path in all));
  for (const [p, content] of Object.entries(all)) {
    const blob = await must(`${full}/git/blobs`, { method: "POST", body: JSON.stringify({ content, encoding: "base64" }) });
    entries.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await must(`${full}/git/trees`, { method: "POST", body: JSON.stringify({ tree: entries }) });
  const commit = await must(`${full}/git/commits`, { method: "POST", body: JSON.stringify({ message: `Update archive page (${Object.keys(all).length} files)`, tree: newTree.sha, parents: [headSha] }) });
  await must(`${full}/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
  const [owner, name] = repoFull.split("/");
  const pagesUrl = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${name.toLowerCase()}/` : `https://${owner.toLowerCase()}.github.io/${name}/`;
  return jsonResponse({ ok: true, url: `https://github.com/${repoFull}`, pagesUrl, uploaded: Object.keys(all).length, removed });
}
