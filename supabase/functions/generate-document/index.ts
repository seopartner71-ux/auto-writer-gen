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
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const formatId = body.ecosystem_format_id || body.format_id;
    if (!formatId) return json({ error: "ecosystem_format_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: fmt, error: fErr } = await admin
      .from("ecosystem_formats")
      .select("id, ecosystem_id, format_type, document_type_id, status, content_ecosystems!inner(user_id)")
      .eq("id", formatId)
      .maybeSingle();
    if (fErr || !fmt) return json({ error: "format not found" }, 404);
    if ((fmt as any).content_ecosystems?.user_id !== userId) {
      return json({ error: "forbidden" }, 403);
    }

    const ecosystemId: string = (fmt as any).ecosystem_id;
    const formatType: string = (fmt as any).format_type;
    const documentTypeId: string | null = (fmt as any).document_type_id;

    // Regenerate-PDF-only flag: reuse retry-checklist-pdf (no LLM cost).
    if (body.regenerate_pdf_only) {
      return await forward(req, "retry-checklist-pdf", { ecosystem_format_id: formatId });
    }

    // Load document type config if present.
    let slug: string | null = null;
    if (documentTypeId) {
      const { data: dt } = await admin
        .from("document_types")
        .select("slug, is_active")
        .eq("id", documentTypeId)
        .maybeSingle();
      if (!dt) return json({ error: "document_type not found" }, 404);
      if (!(dt as any).is_active) return json({ error: "document_type inactive" }, 400);
      slug = (dt as any).slug;
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
    const effectiveSlug = slug || formatType;
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
        return json({ error: `no generator for document type "${effectiveSlug}"` }, 400);
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