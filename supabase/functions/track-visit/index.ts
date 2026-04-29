// GET pixel tracker for PBN sites.
// Usage: <img src="https://<project>.supabase.co/functions/v1/track-visit?site=<project_id>">
// Returns a 1x1 transparent GIF and inserts a row in analytics_logs.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// 1x1 transparent GIF
const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

function pixelResponse() {
  return new Response(GIF_BYTES, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const siteId = url.searchParams.get("site") || url.searchParams.get("p") || "";
    const pageUrl = url.searchParams.get("u") || req.headers.get("referer") || "";

    if (!UUID_RE.test(siteId)) return pixelResponse();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fire and forget — never block the pixel response.
    supabase.from("analytics_logs").insert({
      project_id: siteId,
      url: (pageUrl || "").substring(0, 2000),
    }).then(() => {}, () => {});

    supabase.rpc("increment_project_views", { p_project_id: siteId }).then(() => {}, () => {});
  } catch (_e) {
    // ignore
  }
  return pixelResponse();
});