// Deletes a content ecosystem, all its formats, and best-effort cleans up
// files in the 'ecosystem-formats' storage bucket.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

interface ReqBody { ecosystem_id?: string }

const BUCKET = "ecosystem-formats";

function pathFromPublicUrl(url: string): string | null {
  try {
    const pub = `/object/public/${BUCKET}/`;
    const sgn = `/object/sign/${BUCKET}/`;
    let i = url.indexOf(pub);
    if (i !== -1) return decodeURIComponent(url.slice(i + pub.length).split("?")[0]);
    i = url.indexOf(sgn);
    if (i !== -1) return decodeURIComponent(url.slice(i + sgn.length).split("?")[0]);
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    if (!body?.ecosystem_id) return errorResponse("ecosystem_id required", 400);

    const admin = adminClient();

    const { data: eco, error: ecoErr } = await admin
      .from("content_ecosystems")
      .select("id, user_id, status")
      .eq("id", body.ecosystem_id)
      .single();
    if (ecoErr || !eco) return errorResponse("Ecosystem not found", 404);
    if ((eco as any).user_id !== userId) return errorResponse("Forbidden", 403);

    const { data: formats, error: fmtErr } = await admin
      .from("ecosystem_formats")
      .select("id, pdf_path, image_urls, status")
      .eq("ecosystem_id", body.ecosystem_id);
    if (fmtErr) return errorResponse(fmtErr.message, 500);

    const paths: string[] = [];
    for (const f of (formats || []) as any[]) {
      if (f.pdf_path && typeof f.pdf_path === "string") {
        const p = f.pdf_path.startsWith("http") ? pathFromPublicUrl(f.pdf_path) : f.pdf_path;
        if (p) paths.push(p);
      }
      const imgs = Array.isArray(f.image_urls) ? f.image_urls : [];
      for (const u of imgs) {
        if (typeof u !== "string") continue;
        const p = u.startsWith("http") ? pathFromPublicUrl(u) : u;
        if (p) paths.push(p);
      }
    }

    if (paths.length > 0) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
      if (rmErr) console.warn("[delete-ecosystem] storage remove warning", rmErr.message);
    }

    const { error: delFmtErr } = await admin
      .from("ecosystem_formats")
      .delete()
      .eq("ecosystem_id", body.ecosystem_id);
    if (delFmtErr) console.warn("[delete-ecosystem] formats delete", delFmtErr.message);

    const { error: delEcoErr } = await admin
      .from("content_ecosystems")
      .delete()
      .eq("id", body.ecosystem_id);
    if (delEcoErr) return errorResponse(delEcoErr.message, 500);

    const wasCompleted = (eco as any).status === "completed";
    admin.from("activation_events").insert({
      user_id: userId,
      event_name: "ecosystem_deleted",
      session_id: "app",
      metadata: {
        ecosystem_id: body.ecosystem_id,
        formats_count: (formats || []).length,
        was_completed: wasCompleted,
      },
    }).then(() => {}, () => {});

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error("[delete-ecosystem] error", e);
    return errorResponse((e as Error).message || "Internal error", 500);
  }
});
