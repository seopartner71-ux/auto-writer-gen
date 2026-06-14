// Create a vc.ru batch (5-15 articles), insert items, kick the worker.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { pickVcModel, isVcFormat, isFunnelStage } from "../_shared/vcWriterCore.ts";

interface BatchItemInput {
  format?: string;
  topic?: string;
  thesis?: string;
  audience?: string;
  tone?: string;
  length?: number;
  funnel_stage?: string;
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const items: BatchItemInput[] = Array.isArray(body.items) ? body.items : [];
    if (items.length < 1) return errorResponse("items[] required (1-15)", 400);
    if (items.length > 15) return errorResponse("max 15 items per batch", 400);

    const model = pickVcModel(body.model);
    const generate_cover = !!body.generate_cover;
    const defAudience = String(body.audience || "").slice(0, 200);
    const defTone = String(body.tone || "").slice(0, 100);
    const defLength = Math.min(8000, Math.max(2500, Number(body.length) || 5500));
    const defFormat = isVcFormat(body.default_format) ? body.default_format : "guide";
    const defFunnel = isFunnelStage(body.default_funnel_stage) ? body.default_funnel_stage : "auto";

    const normalized = items.map((it, idx) => {
      const topic = String(it.topic || "").trim();
      if (topic.length < 5) throw new Error(`item ${idx + 1}: topic too short`);
      const stage = isFunnelStage(it.funnel_stage) ? it.funnel_stage : defFunnel;
      return {
        position: idx,
        format: isVcFormat(it.format) ? it.format : defFormat,
        topic: topic.slice(0, 300),
        thesis: String(it.thesis || "").slice(0, 600) || null,
        audience: (String(it.audience || "") || defAudience).slice(0, 200) || null,
        tone: (String(it.tone || "") || defTone).slice(0, 100) || null,
        length: Math.min(8000, Math.max(2500, Number(it.length) || defLength)),
        funnel_stage: stage,
      };
    });

    const admin = adminClient();
    const { data: batch, error: batchErr } = await admin
      .from("vc_writer_batches")
      .insert({
        user_id: userId,
        model,
        generate_cover,
        total: normalized.length,
        status: "processing",
      })
      .select("id")
      .single();
    if (batchErr || !batch) return errorResponse(`Failed to create batch: ${batchErr?.message}`, 500);

    const rows = normalized.map((n) => ({ batch_id: batch.id, user_id: userId, ...n }));
    const { error: itemsErr } = await admin.from("vc_writer_batch_items").insert(rows);
    if (itemsErr) return errorResponse(`Failed to enqueue items: ${itemsErr.message}`, 500);

    // Fire-and-forget worker kickoff
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/vc-writer-worker`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, "x-queue-user-id": userId },
      body: JSON.stringify({ batch_id: batch.id }),
    }).catch((e) => console.error("[vc-writer-batch] worker kickoff failed:", e?.message));

    return jsonResponse({ ok: true, batch_id: batch.id, total: normalized.length });
  } catch (e: any) {
    console.error("[vc-writer-batch]", e?.message || e);
    return errorResponse(e?.message || "Unknown error", 500);
  }
});