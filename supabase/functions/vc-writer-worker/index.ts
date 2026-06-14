// Worker: claims one queued item from a vc.ru batch, generates the article,
// saves the result, then self-invokes for the next item.
// Auth: service-role (Bearer SUPABASE_SERVICE_ROLE_KEY).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { adminClient } from "../_shared/auth.ts";
import { generateVcArticle, isVcFormat, pickVcModel, isFunnelStage } from "../_shared/vcWriterCore.ts";
import { validateVcArticle } from "../_shared/vcQualityGuard.ts";

function isServiceRole(req: Request): boolean {
  const auth = req.headers.get("Authorization") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!key && auth === `Bearer ${key}`;
}

async function chainNext(batchId: string, userId: string) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vc-writer-worker`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // fire and forget
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, "x-queue-user-id": userId },
    body: JSON.stringify({ batch_id: batchId }),
  }).catch((e) => console.error("[vc-writer-worker] chain failed:", e?.message));
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  if (!isServiceRole(req)) return errorResponse("Forbidden", 403);

  try {
    const body = await req.json().catch(() => ({}));
    const batchId = String(body.batch_id || "");
    if (!batchId) return errorResponse("batch_id required", 400);

    const admin = adminClient();

    // Load batch
    const { data: batch, error: batchErr } = await admin
      .from("vc_writer_batches")
      .select("id, user_id, model, generate_cover, status, total, completed, failed")
      .eq("id", batchId)
      .maybeSingle();
    if (batchErr || !batch) return errorResponse("batch not found", 404);
    if (batch.status === "done" || batch.status === "failed") {
      return jsonResponse({ ok: true, finished: true });
    }

    // Claim next item
    const { data: claimed, error: claimErr } = await admin.rpc("claim_vc_batch_item", { p_batch_id: batchId });
    if (claimErr) return errorResponse(`claim failed: ${claimErr.message}`, 500);
    if (!claimed || !claimed.id) {
      // No items left — finalize
      const status = (batch.failed || 0) > 0 && (batch.completed || 0) === 0 ? "failed" : "done";
      await admin.from("vc_writer_batches")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", batchId);
      return jsonResponse({ ok: true, finished: true });
    }

    const item = claimed as any;

    // Get OpenRouter key
    const { data: orRow } = await admin
      .from("api_keys").select("api_key")
      .eq("provider", "openrouter").eq("is_valid", true).maybeSingle();
    const apiKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      await admin.from("vc_writer_batch_items")
        .update({ status: "failed", error: "OpenRouter key not configured", updated_at: new Date().toISOString() })
        .eq("id", item.id);
      await admin.from("vc_writer_batches").update({ failed: (batch.failed || 0) + 1 }).eq("id", batchId);
      chainNext(batchId, batch.user_id);
      return errorResponse("OpenRouter key not configured", 500);
    }

    // Avoid repeating titles
    const { data: done } = await admin
      .from("vc_writer_batch_items")
      .select("result")
      .eq("batch_id", batchId)
      .eq("status", "done")
      .limit(20);
    const avoidTitles = (done || [])
      .map((d: any) => d?.result?.meta?.title)
      .filter((t: any) => typeof t === "string" && t.length > 0);

    const model = pickVcModel(batch.model);
    const format = isVcFormat(item.format) ? item.format : "guide";
    const funnelStage = isFunnelStage(item.funnel_stage) ? item.funnel_stage : "auto";

    try {
      const out = await generateVcArticle({
        apiKey, model, format,
        topic: item.topic,
        thesis: item.thesis || "",
        audience: item.audience || "",
        tone: item.tone || "",
        length: item.length || 5500,
        wantCover: false,
        avoidTitles,
        funnelStage,
      });

      // Quality guard before persisting batch result.
      const guard = validateVcArticle(out.markdown || "", format);
      if (guard.repaired) out.markdown = guard.markdown;
      (out as any).risk_report = { ...((out as any).risk_report ?? {}), quality_guard: guard.report };

      await admin.from("vc_writer_batch_items").update({
        status: "done",
        result: out,
        error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);

      await admin.from("vc_writer_batches")
        .update({ completed: (batch.completed || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", batchId);
    } catch (genErr: any) {
      console.error("[vc-writer-worker] gen failed:", genErr?.message);
      await admin.from("vc_writer_batch_items").update({
        status: "failed",
        error: String(genErr?.message || "generation failed").slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      await admin.from("vc_writer_batches")
        .update({ failed: (batch.failed || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", batchId);
    }

    // Chain to next item (fire-and-forget)
    chainNext(batchId, batch.user_id);
    return jsonResponse({ ok: true, processed_item: item.id });
  } catch (e: any) {
    console.error("[vc-writer-worker]", e?.message || e);
    return errorResponse(e?.message || "Unknown error", 500);
  }
});