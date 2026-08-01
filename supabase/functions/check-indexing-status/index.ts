// Cron-friendly monitor: re-checks indexing status of ecosystem publications.
// Best-effort: queries Google and Yandex with a site: operator for each URL.
// Body (optional): { deployment_ids?: string[], limit?: number }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url: string, ms = 10000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru,en;q=0.8" }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function hit(html: string | null, url: string): "indexed" | "pending" | "unknown" {
  if (html === null) return "unknown";
  const bare = url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return html.includes(bare) ? "indexed" : "pending";
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.deployment_ids) ? body.deployment_ids.filter(Boolean) : [];
    const limit: number = Math.min(Number(body.limit) || 25, 50);

    let q = admin
      .from("format_deployments")
      .select("id, published_url, indexing_status, indexing_status_checked_at")
      .eq("status", "deployed")
      .not("published_url", "is", null)
      .order("indexing_status_checked_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (ids.length > 0) q = admin
      .from("format_deployments")
      .select("id, published_url, indexing_status, indexing_status_checked_at")
      .in("id", ids);

    const { data: rows, error } = await q;
    if (error) throw error;

    const checked: any[] = [];
    for (const row of (rows || []) as any[]) {
      const url: string = row.published_url;
      const [g, y] = await Promise.all([
        fetchText(`https://www.google.com/search?q=site:${encodeURIComponent(url)}`),
        fetchText(`https://yandex.ru/search/?text=site:${encodeURIComponent(url)}`),
      ]);
      const google = hit(g, url);
      const yandex = hit(y, url);
      const overall = (google === "indexed" || yandex === "indexed") ? "indexed" : row.indexing_status;

      await admin.from("format_deployments").update({
        indexing_status_google: google === "unknown" ? row.indexing_status_google ?? "submitted" : google,
        indexing_status_yandex: yandex === "unknown" ? row.indexing_status_yandex ?? "submitted" : yandex,
        indexing_status: overall,
        indexing_status_checked_at: new Date().toISOString(),
      }).eq("id", row.id);

      checked.push({ id: row.id, url, google, yandex, overall });
    }

    return jsonResponse({ ok: true, checked: checked.length, results: checked });
  } catch (err: any) {
    console.error("[check-indexing-status] error:", err?.message || err);
    return errorResponse(err?.message || String(err), 500);
  }
});
