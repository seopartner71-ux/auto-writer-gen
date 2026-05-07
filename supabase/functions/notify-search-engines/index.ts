// Notify search engines (Google sitemap ping, Yandex sitemap ping, IndexNow batch)
// Logs every attempt to public.search_engine_pings.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  project_id: string;
  urls?: string[];        // page URLs (article publish, etc). Optional.
  article_id?: string | null;
  reason?: string;        // 'deploy' | 'article_publish' | 'article_update'
}

interface PingResult {
  provider: "google" | "yandex" | "indexnow";
  status: "success" | "error" | "deprecated";
  code?: number;
  message?: string;
}

async function withTimeout(p: Promise<Response>, ms = 8000): Promise<Response> {
  return await Promise.race([
    p,
    new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const body = await req.json() as Body;
    if (!body.project_id) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project } = await admin
      .from("projects")
      .select("id, user_id, domain, indexnow_key")
      .eq("id", body.project_id)
      .maybeSingle();
    if (!project || project.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const host = (project.domain || "").replace(/^https?:\/\//, "").split("/")[0];
    if (!host) {
      return new Response(JSON.stringify({ error: "Project has no domain" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const origin = `https://${host}`;
    const sitemapUrl = `${origin}/sitemap.xml`;
    const indexNowKey = project.indexnow_key || "";

    const results: PingResult[] = [];
    const logs: any[] = [];

    // 1. Google sitemap ping (deprecated June 2023 — kept for archival/lighter engines)
    try {
      const r = await withTimeout(fetch(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`));
      const status: PingResult["status"] = r.status === 404 ? "deprecated" : (r.ok ? "success" : "error");
      results.push({ provider: "google", status, code: r.status, message: r.status === 404 ? "Google sitemap ping deprecated" : `HTTP ${r.status}` });
    } catch (e: any) {
      results.push({ provider: "google", status: "error", message: e?.message || "fetch failed" });
    }

    // 2. Yandex sitemap ping
    try {
      const r = await withTimeout(fetch(`https://webmaster.yandex.ru/ping?sitemap=${encodeURIComponent(sitemapUrl)}`));
      results.push({
        provider: "yandex",
        status: r.ok ? "success" : "error",
        code: r.status,
        message: `HTTP ${r.status}`,
      });
    } catch (e: any) {
      results.push({ provider: "yandex", status: "error", message: e?.message || "fetch failed" });
    }

    // 3. IndexNow (Bing, Yandex, Naver, Seznam etc.)
    if (indexNowKey) {
      const urlList: string[] = (body.urls && body.urls.length > 0)
        ? body.urls
        : [origin + "/", sitemapUrl];
      try {
        const r = await withTimeout(fetch("https://api.indexnow.org/indexnow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host,
            key: indexNowKey,
            keyLocation: `${origin}/${indexNowKey}.txt`,
            urlList,
          }),
        }));
        results.push({
          provider: "indexnow",
          status: (r.status >= 200 && r.status < 300) ? "success" : "error",
          code: r.status,
          message: `HTTP ${r.status} (${urlList.length} url${urlList.length === 1 ? "" : "s"})`,
        });
      } catch (e: any) {
        results.push({ provider: "indexnow", status: "error", message: e?.message || "fetch failed" });
      }
    } else {
      results.push({ provider: "indexnow", status: "error", message: "No IndexNow key" });
    }

    // Persist logs
    for (const r of results) {
      logs.push({
        user_id: user.id,
        project_id: project.id,
        article_id: body.article_id || null,
        url: sitemapUrl,
        provider: r.provider,
        status: r.status,
        response_code: r.code ?? null,
        response_message: r.message || null,
      });
    }
    if (logs.length > 0) {
      await admin.from("search_engine_pings").insert(logs);
    }

    // Update project summary
    const anyError = results.some((r) => r.status === "error");
    await admin.from("projects").update({
      last_search_ping_at: new Date().toISOString(),
      last_search_ping_status: anyError ? "partial" : "success",
    }).eq("id", project.id);

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});