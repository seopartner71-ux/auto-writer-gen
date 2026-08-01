// Poll Archive.org for items stuck in "processing" and flip them to "available".
// Body: { deployment_ids?: string[], limit?: number }. Runs from cron or from the UI.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const MAX_PROCESSING_HOURS = 24;

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.deployment_ids) ? body.deployment_ids.filter(Boolean) : [];
    const limit = Math.min(Number(body.limit) || 50, 200);

    let q = admin
      .from("format_deployments")
      .select("id, archive_org_identifier, archive_org_status, archive_org_uploaded_at")
      .not("archive_org_identifier", "is", null)
      .limit(limit);
    q = ids.length > 0 ? q.in("id", ids) : q.in("archive_org_status", ["processing", "uploading"]);

    const { data: rows, error } = await q;
    if (error) throw error;

    let available = 0;
    let failed = 0;
    const results: any[] = [];

    for (const r of (rows || []) as any[]) {
      try {
        const res = await fetch(`https://archive.org/metadata/${r.archive_org_identifier}`);
        const meta = res.ok ? await res.json().catch(() => ({})) : {};
        const files: any[] = Array.isArray(meta?.files) ? meta.files : [];
        const hasPdf = files.some((f) => String(f?.name || "").toLowerCase().endsWith(".pdf"));
        const uploadedAt = r.archive_org_uploaded_at ? new Date(r.archive_org_uploaded_at).getTime() : 0;
        const ageH = uploadedAt ? (Date.now() - uploadedAt) / 3600000 : 0;

        if (hasPdf) {
          await admin.from("format_deployments")
            .update({ archive_org_status: "available", archive_org_error: null })
            .eq("id", r.id);
          available++;
          console.log(`[ARCHIVE-ORG] format_deployment_id=${r.id} identifier=${r.archive_org_identifier} status=available elapsed=${Math.round(ageH * 60)}min`);
          try {
            await admin.from("activation_events").insert({
              user_id: null, event_name: "archive_org_processing_completed", session_id: "server",
              metadata: { deployment_id: r.id, elapsed_ms: Math.round(ageH * 3600000) },
            });
          } catch { /* noop */ }
          results.push({ id: r.id, status: "available" });
        } else if (ageH > MAX_PROCESSING_HOURS) {
          await admin.from("format_deployments").update({
            archive_org_status: "error",
            archive_org_error: `Item не обработан Archive.org за ${MAX_PROCESSING_HOURS} ч`,
          }).eq("id", r.id);
          failed++;
          results.push({ id: r.id, status: "error" });
        } else {
          results.push({ id: r.id, status: "processing" });
        }
      } catch (e) {
        console.warn(`[ARCHIVE-ORG] check failed id=${r.id}:`, (e as Error).message);
        results.push({ id: r.id, status: "check_failed" });
      }
    }

    return jsonResponse({ ok: true, checked: (rows || []).length, available, failed, results });
  } catch (err: any) {
    console.error("[ARCHIVE-ORG] check fatal:", err?.message || err);
    return errorResponse(err?.message || String(err), 500);
  }
});