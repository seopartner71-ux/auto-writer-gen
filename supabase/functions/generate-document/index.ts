// Universal document dispatcher for the Content Ecosystem.
//
// Reads ecosystem_formats.document_type_id and routes to the concrete
// generator. This is the architectural seam introduced in the
// "format -> document_type" refactor. The concrete generators (currently
// only generate-checklist for the checklist slug) stay untouched — the
// dispatcher forwards the caller's Authorization header so background
// generation runs under the user's identity.
//
// Legacy behaviour: ecosystem_formats with format_type='dzen' and no
// document_type_id are routed to generate-dzen so old ecosystems keep
// working.
//
// Special flag: { regenerate_pdf_only: true } routes to
// retry-checklist-pdf and skips the LLM call.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

interface ReqBody {
  ecosystem_format_id?: string;
  format_id?: string;
  ecosystem_id?: string;
  regenerate_pdf_only?: boolean;
  force_new_version?: boolean;
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    let formatId = body.ecosystem_format_id || body.format_id;
    if (!formatId) return json({ error: "ecosystem_format_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let { data: fmt, error: fErr } = await admin
      .from("ecosystem_formats")
      .select("id, ecosystem_id, format_type, document_type_id, status, metadata, generation_version, archived, parent_ecosystem_format_id, content_ecosystems!inner(user_id)")
      .eq("id", formatId)
      .maybeSingle();
    if (fErr || !fmt) return json({ error: "format not found" }, 404);
    if ((fmt as any).content_ecosystems?.user_id !== userId) {
      return json({ error: "forbidden" }, 403);
    }

    // force_new_version: клонируем запись в новую версию, чтобы предыдущий
    // PDF/страница/URL не были перезаписаны. Дальнейший роутинг идёт по
    // новому format_id.
    if (body.force_new_version) {
      const cloned = await cloneFormatForNewVersion(admin, fmt as any, userId);
      if (cloned instanceof Response) return cloned;
      formatId = cloned.id;
      fmt = cloned;
    }

    const ecosystemId: string = (fmt as any).ecosystem_id;
    const formatType: string = (fmt as any).format_type;
    const documentTypeId: string | null = (fmt as any).document_type_id;

    // Load document type config if present.
    let slug: string | null = null;
    let generationPattern: "inline" | "background" = "inline";
    if (documentTypeId) {
      const { data: dt } = await admin
        .from("document_types")
        .select("slug, is_active, generation_pattern")
        .eq("id", documentTypeId)
        .maybeSingle();
      if (!dt) return json({ error: "document_type not found" }, 404);
      if (!(dt as any).is_active) return json({ error: "document_type inactive" }, 400);
      slug = (dt as any).slug;
      const gp = String((dt as any).generation_pattern || "inline").toLowerCase();
      generationPattern = gp === "background" ? "background" : "inline";
    }

    const effectiveSlug = slug || formatType;

    // Regenerate-PDF-only flag: checklist → legacy retry, остальные → универсальный движок с флагом.
    if (body.regenerate_pdf_only) {
      if (effectiveSlug === "checklist") {
        return await forward(req, "retry-checklist-pdf", { ecosystem_format_id: formatId });
      }
      return await forward(req, "generate-doc-universal", {
        ecosystem_format_id: formatId,
        regenerate_pdf_only: true,
      });
    }

    // Analytics — best effort.
    try {
      await admin.from("activation_events").insert({
        user_id: userId,
        event_name: "format_generation_started",
        session_id: "app",
        metadata: { ecosystem_id: ecosystemId, format_id: formatId, document_type_slug: slug, format_type: formatType },
      });
    } catch { /* noop */ }

    // Dispatch by slug (new architecture) with fallback by format_type (legacy).
    switch (effectiveSlug) {
      case "checklist":
        return await forward(req, "generate-checklist", {
          ecosystem_id: ecosystemId,
          format_id: formatId,
        });
      case "dzen":
        // Legacy path: existing Dzen rows keep working via generate-dzen.
        return await forward(req, "generate-dzen", {
          ecosystem_id: ecosystemId,
          format_id: formatId,
        });
      default:
        // Тяжёлые типы (whitepaper/catalog) — background pattern через очередь.
        // Фоновый воркер (cron) заберёт задачу и вызовет generate-doc-universal
        // с чистым 150-секундным бюджетом.
        if (generationPattern === "background") {
          try {
            await admin.from("ecosystem_formats").update({
              status: "queued", progress: 0, error_reason: null,
              started_at: null, updated_at: new Date().toISOString(),
            }).eq("id", formatId);
            await admin.from("document_generation_jobs")
              .update({
                status: "failed",
                last_error: "Superseded by a newer queued job",
                completed_at: new Date().toISOString(),
              })
              .eq("ecosystem_format_id", formatId)
              .in("status", ["queued", "processing"]);
            const { data: queuedJob, error: qErr } = await admin.from("document_generation_jobs").insert({
              ecosystem_format_id: formatId,
              user_id: userId,
              status: "queued",
              payload: { ecosystem_format_id: formatId, slug: effectiveSlug },
            }).select("id").single();
            if (qErr) throw qErr;
            nudgeDocumentWorker(userId, (queuedJob as any)?.id || null);
          } catch (e) {
            console.error("[generate-document] enqueue failed, falling back to inline", (e as Error).message);
            return await forward(req, "generate-doc-universal", { ecosystem_format_id: formatId });
          }
          return json({ ok: true, queued: true, format_id: formatId }, 202);
        }
        // Остальные типы (memo/howto/faq/case/...) — сразу в универсальный движок.
        return await forward(req, "generate-doc-universal", {
          ecosystem_format_id: formatId,
        });
    }
  } catch (e) {
    console.error("[generate-document] top", e);
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Plan-based cap on live (non-archived) versions per document type inside
// one ecosystem. Everything beyond the cap gets auto-archived (oldest first),
// so users below FACTORY can regenerate without breaking their limit.
const VERSION_LIMITS: Record<string, number> = {
  nano: 1,
  basic: 5,
  pro: -1,   // unlimited
};

// deno-lint-ignore no-explicit-any
async function cloneFormatForNewVersion(admin: any, source: any, userId: string): Promise<any | Response> {
  try {
    const grpFilter = source.document_type_id
      ? { column: "document_type_id", value: source.document_type_id }
      : { column: "format_type", value: source.format_type };

    // Compute next version = max(existing) + 1 within the same group.
    const { data: siblings } = await admin
      .from("ecosystem_formats")
      .select("id, generation_version, archived, created_at")
      .eq("ecosystem_id", source.ecosystem_id)
      .eq(grpFilter.column, grpFilter.value)
      .order("generation_version", { ascending: false });
    const nextVersion = ((siblings || [])[0]?.generation_version || 1) + 1;

    // Enforce plan limit — archive oldest active until under cap.
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();
    const plan = String((profile as any)?.plan || "nano").toLowerCase();
    const cap = VERSION_LIMITS[plan] ?? 1;
    if (cap > 0) {
      const active = (siblings || [])
        .filter((r: any) => !r.archived)
        .sort((a: any, b: any) => (a.generation_version || 0) - (b.generation_version || 0));
      // After insert we'll have active.length + 1 rows — trim overflow first.
      const overflow = Math.max(0, active.length + 1 - cap);
      for (let i = 0; i < overflow; i++) {
        await admin.from("ecosystem_formats")
          .update({ archived: true, archived_at: new Date().toISOString() })
          .eq("id", active[i].id);
      }
    }

    const { data: inserted, error: insErr } = await admin
      .from("ecosystem_formats")
      .insert({
        ecosystem_id: source.ecosystem_id,
        format_type: source.format_type,
        document_type_id: source.document_type_id,
        metadata: source.metadata || {},
        status: "pending",
        generation_version: nextVersion,
        parent_ecosystem_format_id: source.id,
        archived: false,
      })
      .select("id, ecosystem_id, format_type, document_type_id, status, metadata, generation_version, archived, parent_ecosystem_format_id, content_ecosystems!inner(user_id)")
      .single();
    if (insErr) throw insErr;

    // КРИТИЧНО: переносим RAG-источники на новую версию, иначе
    // перегенерация теряет контент страницы клиента и документ пишется
    // "по общим знаниям".
    try {
      let { data: refs } = await admin
        .from("document_source_references")
        .select("*")
        .eq("ecosystem_format_id", source.id);
      // Fallback: если у текущей версии источников нет (старый баг клонирования),
      // ищем их у родительской версии.
      if ((!refs || !refs.length) && source.parent_ecosystem_format_id) {
        const { data: parentRefs } = await admin
          .from("document_source_references")
          .select("*")
          .eq("ecosystem_format_id", source.parent_ecosystem_format_id);
        refs = parentRefs || [];
      }
      if (refs && refs.length) {
        const rows = refs.map((r: any) => {
          const { id: _id, created_at: _c, updated_at: _u, ...rest } = r;
          return { ...rest, ecosystem_format_id: (inserted as any).id };
        });
        const { error: copyErr } = await admin.from("document_source_references").insert(rows);
        if (copyErr) throw copyErr;
      }
      console.log(`[RAG-CLONE] from=${source.id} to=${(inserted as any).id} sources_copied=${refs?.length || 0}`);
    } catch (e) {
      console.error("[RAG-CLONE] failed", (e as Error).message);
    }
    return inserted;
  } catch (e) {
    console.error("[generate-document] clone failed", e);
    return json({ error: `clone_failed: ${(e as Error).message}` }, 500);
  }
}

async function forward(req: Request, fnName: string, body: unknown): Promise<Response> {
  const base = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const url = `${base}/functions/v1/${fnName}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { ...corsHeaders, "Content-Type": r.headers.get("Content-Type") || "application/json" },
  });
}

function nudgeDocumentWorker(userId: string, jobId: string | null): void {
  const base = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !serviceKey) return;
  const task = fetch(`${base}/functions/v1/document-jobs-worker`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "x-queue-user-id": userId,
    },
    body: JSON.stringify({ source: "generate-document", job_id: jobId }),
  }).catch((e) => console.error("[generate-document] worker nudge failed", (e as Error).message));
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
}