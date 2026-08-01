// Cron-friendly monitor: re-checks indexing status of ecosystem publications.
// Best-effort: queries Google and Yandex with an exact URL search.
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

function normalizeUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return null;
  }
}

function resultLinks(html: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let href = match[1].replace(/&amp;/g, "&");
    try { href = decodeURIComponent(href); } catch { /* malformed URL - ignore decoding */ }

    // Google wraps organic links in /url?q=<target>; Yandex may put the
    // destination in a query parameter. Direct result links are also accepted.
    if (href.startsWith("/url?")) {
      try { href = new URL(href, "https://www.google.com").searchParams.get("q") || ""; } catch { href = ""; }
    } else if (!/^https?:\/\//i.test(href)) {
      try {
        const wrapper = new URL(href, "https://yandex.ru");
        href = wrapper.searchParams.get("url") || wrapper.searchParams.get("target") || "";
      } catch { href = ""; }
    }
    if (/^https?:\/\//i.test(href)) links.push(href);
  }
  return links;
}

function hit(html: string | null, url: string): "indexed" | "pending" | "unknown" {
  if (html === null) return "unknown";
  const expected = normalizeUrl(url);
  if (!expected) return "unknown";
  return resultLinks(html).some((link) => normalizeUrl(link) === expected) ? "indexed" : "pending";
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
      .select("id, published_url, indexing_status, indexing_status_google, indexing_status_yandex, indexing_status_checked_at")
      .eq("status", "deployed")
      .not("published_url", "is", null)
      .order("indexing_status_checked_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (ids.length > 0) q = admin
      .from("format_deployments")
      .select("id, published_url, indexing_status, indexing_status_google, indexing_status_yandex, indexing_status_checked_at")
      .in("id", ids);

    const { data: rows, error } = await q;
    if (error) throw error;

    const checked: any[] = [];
    for (const row of (rows || []) as any[]) {
      const url: string = row.published_url;
      const [g, y] = await Promise.all([
        fetchText(`https://www.google.com/search?q=${encodeURIComponent(`"${url}"`)}`),
        fetchText(`https://yandex.ru/search/?text=${encodeURIComponent(`url:${url}`)}`),
      ]);
      const google = hit(g, url);
      const yandex = hit(y, url);
      const overall = google === "indexed" || yandex === "indexed"
        ? "indexed"
        : google === "pending" || yandex === "pending"
          ? "pending"
          : "submitted";

      const { error: updateError } = await admin.from("format_deployments").update({
        indexing_status_google: google === "unknown" ? "submitted" : google,
        indexing_status_yandex: yandex === "unknown" ? "submitted" : yandex,
        indexing_status: overall,
        indexing_status_checked_at: new Date().toISOString(),
      }).eq("id", row.id);
      if (updateError) throw updateError;

      checked.push({ id: row.id, url, google, yandex, overall });
    }

    return jsonResponse({ ok: true, checked: checked.length, results: checked });
  } catch (err: any) {
    console.error("[check-indexing-status] error:", err?.message || err);
    return errorResponse(err?.message || String(err), 500);
  }
});
