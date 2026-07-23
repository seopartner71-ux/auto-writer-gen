// Retries only the PDF-rendering step for a checklist format whose markdown
// content is already stored. Cheap — no LLM call. Used from the preview modal
// when status = 'partial' (markdown OK, PDF failed).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { buildChecklistPdf, uploadChecklistPdf } from "../_shared/checklistPdf.ts";

interface ReqBody { ecosystem_format_id: string }

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = (await req.json()) as ReqBody;
    if (!body?.ecosystem_format_id) return json({ error: "ecosystem_format_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: fmt, error: fErr } = await admin
      .from("ecosystem_formats")
      .select("id, ecosystem_id, format_type, content, status")
      .eq("id", body.ecosystem_format_id)
      .single();
    if (fErr || !fmt) return json({ error: "format not found" }, 404);
    if ((fmt as any).format_type !== "checklist") return json({ error: "not a checklist" }, 400);
    if (!(fmt as any).content) return json({ error: "no markdown content to render" }, 400);

    const { data: eco } = await admin
      .from("content_ecosystems")
      .select("id, user_id, articles(title), clients(name,brand_color,expert_name,domain)")
      .eq("id", (fmt as any).ecosystem_id)
      .single();
    if (!eco) return json({ error: "ecosystem not found" }, 404);
    if ((eco as any).user_id !== userId) return json({ error: "forbidden" }, 403);

    const title = ((eco as any).articles?.title || "Материал").slice(0, 200);
    const markdown: string = (fmt as any).content;
    const client = (eco as any).clients || null;

    try {
      console.log("[CHECKLIST-PDF] Retry started", { formatId: (fmt as any).id });
      const pdfStart = Date.now();
      const pdfBytes = await buildChecklistPdf({ title, markdown, client });
      console.log("[CHECKLIST-PDF] PDF rendered", { formatId: (fmt as any).id, ms: Date.now() - pdfStart });
      const targetPath = `${userId}/${(eco as any).id}/checklist/${Date.now()}.pdf`;
      console.log("[CHECKLIST-PDF] Storage upload started", { path: targetPath });
      const uploaded = await uploadChecklistPdf(admin, targetPath, pdfBytes);
      if (!uploaded.signedUrl) throw new Error("Не удалось получить подписанную ссылку на PDF");
      console.log("[CHECKLIST-PDF] Storage upload completed", { path: uploaded.path });

      await admin
        .from("ecosystem_formats")
        .update({
          status: "completed",
          pdf_url: uploaded.signedUrl,
          pdf_path: uploaded.path,
          error_reason: null,
        })
        .eq("id", (fmt as any).id);

      return json({ ok: true, pdf_url: uploaded.signedUrl }, 200);
    } catch (pdfErr) {
      const msg = (pdfErr as Error).message?.slice(0, 500) || "unknown";
      console.error("[CHECKLIST-PDF] Retry failed", { formatId: (fmt as any).id, error: msg });
      await admin
        .from("ecosystem_formats")
        .update({
          status: "partial",
          pdf_url: null,
          pdf_path: null,
          error_reason: `PDF generation failed: ${msg}`,
        })
        .eq("id", (fmt as any).id);
      return json({ error: msg }, 500);
    }
  } catch (e) {
    console.error("[retry-checklist-pdf] top", e);
    return json({ error: (e as Error).message || "internal error" }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}