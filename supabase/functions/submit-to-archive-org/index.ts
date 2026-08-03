// Upload flagship ecosystem PDFs to Archive.org (Internet Archive) via the S3-like API.
// Body: { format_deployment_id } or { format_deployment_ids: string[] } (batch retry).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

/** Only flagship long-form documents go to Archive.org in this iteration. */
export const ARCHIVE_ORG_TYPES = [
  "whitepaper",
  "encyclopedia",
  "catalog",
  "expert_pdf",
  "ranking",
  "comparison_review",
  "glossary",
];

function slugify(input: string, max = 60): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e",
    ю: "yu", я: "ya",
  };
  const translit = (input || "").toLowerCase().split("").map((ch) => map[ch] ?? ch).join("");
  return translit
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "") || "document";
}

async function shortHash(input: string, len = 8): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

/** Archive.org header values must be latin-1 safe; encode anything else. */
function metaHeaderValue(v: string): string {
  const clean = (v || "").replace(/[\r\n]+/g, " ").trim().slice(0, 400);
  // deno-lint-ignore no-control-regex
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `uri(${encodeURIComponent(clean)})`;
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const accessKey = Deno.env.get("ARCHIVE_ORG_ACCESS_KEY");
    const secretKey = Deno.env.get("ARCHIVE_ORG_SECRET_KEY");
    if (!accessKey || !secretKey) {
      return errorResponse("Archive.org не настроен: отсутствуют ключи API", 400);
    }
    const publisherPrefix = Deno.env.get("ARCHIVE_ORG_PUBLISHER_NAME") || "seo-modul";

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.format_deployment_ids)
      ? body.format_deployment_ids.filter(Boolean)
      : body.format_deployment_id ? [body.format_deployment_id] : [];
    const force = body.force === true;
    if (ids.length === 0) return errorResponse("format_deployment_id обязателен", 400);

    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });

    const { data: deps, error: depErr } = await admin
      .from("format_deployments")
      .select("id, pdf_url, status, archive_org_status, ecosystem_format_id")
      .in("id", ids);
    if (depErr) throw depErr;

    const results: any[] = [];

    for (const dep of (deps || []) as any[]) {
      const started = Date.now();
      const log = (msg: string) => console.log(`[ARCHIVE-ORG] format_deployment_id=${dep.id} ${msg}`);

      try {
        // 1. Context: format -> ecosystem -> client + article
        const { data: fmt } = await admin
          .from("ecosystem_formats")
          .select("id, format_type, pdf_path, document_types(slug), content_ecosystems!inner(user_id, client_id, clients(id, name, domain, expert_name), articles(id, title, meta_description, lsi_keywords, main_keyword))")
          .eq("id", dep.ecosystem_format_id)
          .maybeSingle();
        if (!fmt) throw new Error("format_not_found");
        const eco: any = (fmt as any).content_ecosystems;
        if (!auth.isQueueCall && eco.user_id !== userId && !isAdmin) throw new Error("forbidden");
        const client: any = eco.clients || {};
        const article: any = eco.articles || {};
        const typeSlug: string = ((fmt as any).document_types?.slug) || (fmt as any).format_type;

        // 2. Eligibility (manual force allows any document type)
        if (!force && !ARCHIVE_ORG_TYPES.includes(typeSlug)) {
          results.push({ id: dep.id, skipped: "type_not_eligible", type: typeSlug });
          continue;
        }
        const st = dep.archive_org_status || "pending";
        if (!force && !["pending", "error"].includes(st)) {
          results.push({ id: dep.id, skipped: `status_${st}` });
          continue;
        }
        if (dep.status !== "deployed") {
          results.push({ id: dep.id, skipped: "not_deployed" });
          continue;
        }

        // 3. Identifier
        const hash = await shortHash(dep.id, 8);
        const identifier = `${slugify(publisherPrefix, 20)}-${slugify(client.domain || client.name || "client", 40)}-${slugify(typeSlug, 20)}-${hash}`
          .replace(/[^a-zA-Z0-9._-]/g, "-")
          .slice(0, 100);

        await admin.from("format_deployments")
          .update({ archive_org_status: "uploading", archive_org_error: null })
          .eq("id", dep.id);

        try {
          await admin.from("activation_events").insert({
            user_id: eco.user_id, event_name: "archive_org_upload_started", session_id: "server",
            metadata: { type_slug: typeSlug, client_id: client.id },
          });
        } catch { /* noop */ }

        // 4. PDF bytes: prefer storage path, fall back to public pdf_url
        let pdfBytes: Uint8Array | null = null;
        if ((fmt as any).pdf_path) {
          const dl = await admin.storage.from("ecosystem-formats").download((fmt as any).pdf_path);
          if (!dl.error && dl.data) pdfBytes = new Uint8Array(await dl.data.arrayBuffer());
        }
        if (!pdfBytes && dep.pdf_url) {
          const r = await fetch(dep.pdf_url);
          if (r.ok) pdfBytes = new Uint8Array(await r.arrayBuffer());
        }
        if (!pdfBytes || pdfBytes.length === 0) throw new Error("PDF не найден для загрузки");

        // 5. Upload via the S3-like API
        const title = article.title || client.name || typeSlug;
        const filename = `${slugify(title, 70)}.pdf`;
        const uploadUrl = `https://s3.us.archive.org/${identifier}/${filename}`;
        const description = article.meta_description
          || `${title}. ${client.name || ""}`.trim();
        const subject = Array.isArray(article.lsi_keywords) && article.lsi_keywords.length
          ? article.lsi_keywords.slice(0, 12).join(";")
          : (article.main_keyword || typeSlug);

        const headers: Record<string, string> = {
          Authorization: `LOW ${accessKey}:${secretKey}`,
          "x-amz-auto-make-bucket": "1",
          "x-archive-meta-mediatype": "texts",
          "x-archive-meta-collection": "opensource",
          "x-archive-meta-title": metaHeaderValue(title),
          "x-archive-meta-description": metaHeaderValue(description.slice(0, 300)),
          "x-archive-meta-creator": metaHeaderValue(client.expert_name || client.name || "SEO-Module"),
          "x-archive-meta-publisher": metaHeaderValue(client.name || "SEO-Module"),
          "x-archive-meta-subject": metaHeaderValue(subject),
          "x-archive-meta-language": "rus",
          "x-archive-meta-external-identifier": `urn:seo-modul:${dep.id}`,
          "x-archive-meta-source": client.domain ? `https://${String(client.domain).replace(/^https?:\/\//, "")}` : "",
          "x-archive-meta-date": new Date().toISOString().split("T")[0],
          "Content-Type": "application/pdf",
        };
        if (!headers["x-archive-meta-source"]) delete headers["x-archive-meta-source"];

        const res = await fetch(uploadUrl, { method: "PUT", headers, body: pdfBytes });

        if (!res.ok) {
          const text = (await res.text()).slice(0, 500);
          throw new Error(`Archive.org ${res.status}: ${text}`);
        }
        await res.text().catch(() => "");

        const detailsUrl = `https://archive.org/details/${identifier}`;
        const downloadUrl = `https://archive.org/download/${identifier}/${filename}`;
        const elapsed = Date.now() - started;

        await admin.from("format_deployments").update({
          archive_org_identifier: identifier,
          archive_org_url: detailsUrl,
          archive_org_pdf_url: downloadUrl,
          archive_org_uploaded_at: new Date().toISOString(),
          archive_org_status: "processing",
          archive_org_error: null,
        }).eq("id", dep.id);

        log(`identifier=${identifier} status=uploaded pdf_size=${pdfBytes.length}bytes elapsed=${elapsed}ms`);

        try {
          await admin.from("activation_events").insert({
            user_id: eco.user_id, event_name: "archive_org_upload_completed", session_id: "server",
            metadata: { type_slug: typeSlug, elapsed_ms: elapsed, pdf_size_bytes: pdfBytes.length, identifier },
          });
        } catch { /* noop */ }

        results.push({ id: dep.id, ok: true, identifier, url: detailsUrl, pdf_url: downloadUrl });
      } catch (e: any) {
        const message = (e?.message || String(e)).slice(0, 500);
        console.error(`[ARCHIVE-ORG] format_deployment_id=${dep.id} status=error message="${message}"`);
        await admin.from("format_deployments").update({
          archive_org_status: "error",
          archive_org_error: message,
        }).eq("id", dep.id);
        try {
          await admin.from("activation_events").insert({
            user_id: userId, event_name: "archive_org_upload_failed", session_id: "server",
            metadata: { deployment_id: dep.id, error_code: message.slice(0, 120) },
          });
        } catch { /* noop */ }
        results.push({ id: dep.id, ok: false, error: message });
      }
    }

    const uploaded = results.filter((r) => r.ok).length;
    return jsonResponse({ ok: true, uploaded, results });
  } catch (err: any) {
    console.error("[ARCHIVE-ORG] fatal:", err?.message || err);
    return errorResponse(err?.message || String(err), 500);
  }
});