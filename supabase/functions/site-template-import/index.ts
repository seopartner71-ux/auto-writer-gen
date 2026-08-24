// ============================================================================
// TEMPLATE IMPORT V1
//
// Upload template.zip -> strict validation -> sanitize -> Storage + DB.
// Also serves list / preview / select / disable / delete for the importer UI.
//
// Nothing in the SEO / data / render pipeline is touched here: this function
// only stores template bundles and links one of them to a project.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { validateTemplateBundle, type ValidationResult, type ZipEntry } from "../_shared/templateValidator.ts";
import { buildLenientBundle } from "../_shared/templateLenient.ts";
import { expandTemplate } from "../_shared/templateEngine.ts";
import { sampleDataFor } from "../_shared/templateSampleData.ts";
import { REQUIRED_PAGES } from "../_shared/templateContract.ts";

const BUCKET = "site-templates";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function slugify(s: string): string {
  return String(s || "template")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "template";
}

function readZip(buf: Uint8Array): ZipEntry[] {
  const files = unzipSync(buf);
  const out: ZipEntry[] = [];
  for (const [rawPath, bytes] of Object.entries(files)) {
    if (!bytes || (bytes as Uint8Array).length === 0) continue;
    // strip a single wrapping folder if the archive was zipped with one
    out.push({ path: rawPath.replace(/\\/g, "/"), bytes: bytes as Uint8Array });
  }
  // if every entry lives under the same root folder, drop that prefix
  const roots = new Set(out.map((e) => e.path.split("/")[0]));
  if (roots.size === 1 && !out.some((e) => e.path === "template.json")) {
    const root = [...roots][0] + "/";
    for (const e of out) e.path = e.path.startsWith(root) ? e.path.slice(root.length) : e.path;
  }
  return out.filter((e) => e.path && !e.path.endsWith("/"));
}

/** Wraps a rendered <main> body into a standalone preview document. */
function previewDoc(mainHtml: string, css: string, title: string): string {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>${css}</style></head>
<body><main>${mainHtml}</main></body></html>`;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;
  const userId = auth.userId;
  const db = admin();

  try {
    const url = new URL(req.url);
    const ct = req.headers.get("content-type") || "";
    let action = url.searchParams.get("action") || "";
    let body: Record<string, unknown> = {};
    let zipBytes: Uint8Array | null = null;

    const isBinary = /zip|octet-stream/i.test(ct);

    if (isBinary && req.method === "POST") {
      // Raw binary upload (preferred): action/slug come from query params.
      action = action || "install";
      if (url.searchParams.get("slug")) body.slug = url.searchParams.get("slug");
      const buf = await req.arrayBuffer();
      if (buf.byteLength === 0) return errorResponse("Пустой файл", 400);
      if (buf.byteLength > 8 * 1024 * 1024) {
        return jsonResponse({
          ok: false,
          warnings: [],
          errors: [`ZIP больше лимита (${(buf.byteLength / 1048576).toFixed(1)} MB > 8 MB)`],
        }, 200);
      }
      zipBytes = new Uint8Array(buf);
    } else if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      action = String(fd.get("action") || action || "install");
      for (const [k, v] of fd.entries()) if (typeof v === "string") body[k] = v;
      const file = fd.get("file");
      if (file instanceof File) {
        if (!/\.zip$/i.test(file.name)) return errorResponse("Ожидается файл template.zip", 400);
        zipBytes = new Uint8Array(await file.arrayBuffer());
      }
    } else if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
      action = String(body.action || action || "list");
    } else {
      action = action || "list";
    }


    // ---------------------------------------------------------------- list
    if (action === "list") {
      const { data, error } = await db
        .from("site_templates")
        .select("id, slug, name, version, engine, description, status, pages, css_path, created_at")
        .or(`user_id.eq.${userId},is_public.eq.true`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResponse({ templates: data || [] });
    }

    // -------------------------------------------------------- inspect_zip
    // Lists html/css files of an arbitrary archive so the UI can map them
    // onto the five page types.
    if (action === "inspect_zip") {
      if (!zipBytes) return errorResponse("Файл не передан", 400);
      let entries: ZipEntry[];
      try {
        entries = readZip(zipBytes);
      } catch (e) {
        return jsonResponse({ ok: false, warnings: [], errors: [`Не удалось распаковать архив: ${(e as Error).message}`] });
      }
      const dec2 = new TextDecoder();
      const html = entries.filter((e) => /\.html?$/i.test(e.path)).map((e) => e.path).sort();
      const cssFiles = entries.filter((e) => /\.css$/i.test(e.path)).map((e) => e.path).sort();
      const hasManifest = entries.some((e) => e.path === "template.json");
      let manifestName: string | null = null;
      if (hasManifest) {
        try {
          manifestName = JSON.parse(dec2.decode(entries.find((e) => e.path === "template.json")!.bytes))?.name || null;
        } catch { /* ignore */ }
      }
      return jsonResponse({ ok: true, html, css: cssFiles, has_manifest: hasManifest, manifest_name: manifestName });
    }

    // ------------------------------------------------- validate / install
    if (action === "validate" || action === "install" || action === "preview_zip" || action === "install_pages") {
      let res: ValidationResult;

      if (action === "install_pages") {
        // Page-by-page upload: raw html strings straight from the UI.
        const rawPages = (body.pages || {}) as Record<string, string>;
        res = buildLenientBundle(rawPages, String(body.css || ""), String(body.name || "Imported template"));
      } else {
        if (!zipBytes) return errorResponse("Файл не передан", 400);
        let entries: ZipEntry[];
        try {
          entries = readZip(zipBytes);
        } catch (e) {
          return jsonResponse({ ok: false, warnings: [], errors: [`Не удалось распаковать архив: ${(e as Error).message}`] });
        }
        const hasManifest = entries.some((e) => e.path === "template.json");
        let map: Record<string, string> | null = null;
        if (body.map) {
          try { map = JSON.parse(String(body.map)); } catch { map = null; }
        }

        if (map || !hasManifest) {
          // Lenient path: arbitrary template ZIP mapped by the user.
          const dec3 = new TextDecoder();
          const byPath = new Map(entries.map((e) => [e.path, e]));
          const rawPages: Record<string, string> = {};
          for (const [type, p] of Object.entries(map || {})) {
            const entry = byPath.get(p);
            if (!entry) continue;
            rawPages[type] = dec3.decode(entry.bytes);
          }
          if (!rawPages.home) {
            const guess = entries.find((e) => /(^|\/)index\.html?$/i.test(e.path))
              || entries.find((e) => /\.html?$/i.test(e.path));
            if (guess) rawPages.home = dec3.decode(guess.bytes);
          }
          let css = "";
          const cssPick = body.css_path ? [String(body.css_path)] : null;
          for (const e of entries) {
            if (!/\.css$/i.test(e.path)) continue;
            if (cssPick && !cssPick.includes(e.path)) continue;
            css += `\n${dec3.decode(e.bytes)}`;
          }
          res = buildLenientBundle(rawPages, css, String(body.name || "Imported template"));
        } else {
          res = validateTemplateBundle(entries, zipBytes.length);
        }
      }

      if (!res.ok) {
        // 200 on purpose: supabase-js hides the body of non-2xx responses,
        // and the UI must show the exact validation errors.
        return jsonResponse({ ok: false, errors: res.errors.slice(0, 40), warnings: res.warnings }, 200);
      }



      if (action === "validate") {
        return jsonResponse({
          ok: true,
          errors: [],
          warnings: res.warnings,
          manifest: res.manifest,
          pages: Object.keys(res.pages!),
          assets: (res.assets || []).map((a) => a.path),
        });
      }

      if (action === "preview_zip") {
        const previews: Record<string, string> = {};
        for (const type of REQUIRED_PAGES) {
          const tpl = res.pages![type];
          if (!tpl) continue;
          const data = sampleDataFor(type);
          previews[type] = previewDoc(
            expandTemplate(tpl, data),
            expandTemplate(res.css || "", data),
            `${res.manifest!.name} - ${type}`,
          );
        }
        return jsonResponse({ ok: true, previews });
      }

      // ---- install: store metadata in DB, files in Storage --------------
      const manifest = res.manifest!;
      const slug = slugify(String(body.slug || manifest.name));
      const templateId = crypto.randomUUID();
      const prefix = `${userId}/${templateId}`;
      const enc = new TextEncoder();

      const uploads: { path: string; bytes: Uint8Array; type: string }[] = [];
      const pagePaths: Record<string, string> = {};
      for (const [type, html] of Object.entries(res.pages!)) {
        const p = `${prefix}/pages/${type}.html`;
        pagePaths[type] = p;
        uploads.push({ path: p, bytes: enc.encode(html), type: "text/html; charset=utf-8" });
      }
      const cssPath = `${prefix}/assets/theme.css`;
      uploads.push({ path: cssPath, bytes: enc.encode(res.css || ""), type: "text/css; charset=utf-8" });
      uploads.push({
        path: `${prefix}/template.json`,
        bytes: enc.encode(JSON.stringify(manifest, null, 2)),
        type: "application/json",
      });
      const assetPaths: string[] = [];
      for (const a of (res.assets || [])) {
        const p = `${prefix}/${a.path}`;
        assetPaths.push(a.path);
        uploads.push({ path: p, bytes: a.bytes, type: "application/octet-stream" });
      }

      for (const u of uploads) {
        const { error } = await db.storage
          .from(BUCKET)
          .upload(u.path, u.bytes, { contentType: u.type, upsert: true });
        if (error) {
          await db.storage.from(BUCKET).remove(uploads.map((x) => x.path));
          return jsonResponse({ ok: false, errors: [`Ошибка загрузки ${u.path}: ${error.message}`] }, 500);
        }
      }

      const { data: row, error: insErr } = await db
        .from("site_templates")
        .insert({
          id: templateId,
          user_id: userId,
          slug,
          name: manifest.name,
          version: String(manifest.version),
          engine: manifest.engine,
          description: manifest.description || null,
          manifest,
          storage_prefix: prefix,
          pages: pagePaths,
          assets: assetPaths,
          css_path: cssPath,
          status: "installed",
        })
        .select("id, slug, name, version")
        .single();
      if (insErr) {
        await db.storage.from(BUCKET).remove(uploads.map((x) => x.path));
        return jsonResponse({ ok: false, errors: [insErr.message] }, 500);
      }

      await db.from("site_template_events").insert({
        user_id: userId, template_id: templateId, level: "info", event: "template_installed",
        details: { slug, version: manifest.version, files: uploads.length },
      });

      return jsonResponse({ ok: true, template: row, warnings: res.warnings });
    }

    // ------------------------------------------------------------- preview
    if (action === "preview") {
      const templateId = String(body.template_id || "");
      if (!templateId) return errorResponse("template_id обязателен", 400);
      const { data: tpl, error } = await db
        .from("site_templates").select("*").eq("id", templateId).maybeSingle();
      if (error) throw error;
      if (!tpl) return errorResponse("Шаблон не найден", 404);
      if (tpl.user_id !== userId && !tpl.is_public) return errorResponse("Нет доступа", 403);

      const dl = async (p: string) => {
        const { data } = await db.storage.from(BUCKET).download(p);
        return data ? await data.text() : "";
      };
      const css = tpl.css_path ? await dl(tpl.css_path) : "";
      const previews: Record<string, string> = {};
      for (const type of REQUIRED_PAGES) {
        const p = (tpl.pages as Record<string, string>)[type];
        if (!p) continue;
        const html = await dl(p);
        const data = sampleDataFor(type);
        previews[type] = previewDoc(expandTemplate(html, data), expandTemplate(css, data), `${tpl.name} - ${type}`);
      }
      return jsonResponse({ ok: true, previews });
    }

    // -------------------------------------------------- select / disable
    if (action === "select" || action === "disable") {
      const projectId = String(body.project_id || "");
      if (!projectId) return errorResponse("project_id обязателен", 400);
      const { data: project } = await db
        .from("projects").select("id, user_id").eq("id", projectId).maybeSingle();
      if (!project) return errorResponse("Проект не найден", 404);
      if (project.user_id !== userId) return errorResponse("Нет доступа к проекту", 403);

      if (action === "disable") {
        await db.from("projects")
          .update({ template_engine: "legacy", site_template_id: null })
          .eq("id", projectId);
        await db.from("site_template_events").insert({
          user_id: userId, project_id: projectId, level: "info", event: "template_disabled", details: {},
        });
        return jsonResponse({ ok: true, template_engine: "legacy", site_template_id: null });
      }

      const templateId = String(body.template_id || "");
      const { data: tpl } = await db
        .from("site_templates").select("id, user_id, is_public, status").eq("id", templateId).maybeSingle();
      if (!tpl) return errorResponse("Шаблон не найден", 404);
      if (tpl.user_id !== userId && !tpl.is_public) return errorResponse("Нет доступа к шаблону", 403);

      await db.from("projects")
        .update({ template_engine: "template", site_template_id: templateId })
        .eq("id", projectId);
      await db.from("site_template_events").insert({
        user_id: userId, project_id: projectId, template_id: templateId,
        level: "info", event: "template_selected", details: {},
      });
      return jsonResponse({ ok: true, template_engine: "template", site_template_id: templateId });
    }

    // -------------------------------------------------------------- delete
    if (action === "delete") {
      const templateId = String(body.template_id || "");
      const { data: tpl } = await db
        .from("site_templates").select("id, user_id, storage_prefix").eq("id", templateId).maybeSingle();
      if (!tpl) return errorResponse("Шаблон не найден", 404);
      if (tpl.user_id !== userId) return errorResponse("Нет доступа", 403);
      const { data: list } = await db.storage.from(BUCKET).list(tpl.storage_prefix, { limit: 500 });
      const paths: string[] = [];
      for (const f of list || []) {
        if ((f as { id?: string }).id === null) {
          const { data: sub } = await db.storage.from(BUCKET).list(`${tpl.storage_prefix}/${f.name}`, { limit: 500 });
          for (const s of sub || []) paths.push(`${tpl.storage_prefix}/${f.name}/${s.name}`);
        } else {
          paths.push(`${tpl.storage_prefix}/${f.name}`);
        }
      }
      if (paths.length) await db.storage.from(BUCKET).remove(paths);
      await db.from("site_templates").delete().eq("id", templateId);
      return jsonResponse({ ok: true });
    }

    return errorResponse(`Неизвестное действие: ${action}`, 400);
  } catch (e) {
    console.error("[site-template-import]", e);
    return new Response(JSON.stringify({ ok: false, errors: [(e as Error).message] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
