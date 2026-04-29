// Cloudflare Pages analytics aggregator.
// Returns per-project view counts for 24h / 7d / 30d using Cloudflare GraphQL Analytics API.
// Falls back gracefully if Cloudflare is not configured or returns an error.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwt(token: string): any | null {
  try {
    const p = token.split(".")[1];
    const json = atob(p.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch { return null; }
}

function isoDaysAgo(d: number): string {
  const dt = new Date(Date.now() - d * 86400_000);
  return dt.toISOString();
}

async function gqlQuery(token: string, accountTag: string, sinceIso: string, untilIso: string, hostname: string) {
  // pagesViewsAdaptiveGroups gives requests/visits per hostname
  const query = `query($acc:String!,$since:Time!,$until:Time!,$host:String!){
    viewer{
      accounts(filter:{accountTag:$acc}){
        pagesViewsAdaptiveGroups(
          filter:{date_geq:$since,date_leq:$until,requestHost:$host},
          limit:10000
        ){
          sum{requests visits}
        }
      }
    }
  }`;
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { acc: accountTag, since: sinceIso, until: untilIso, host: hostname } }),
  });
  const json = await res.json().catch(() => null) as any;
  const groups = json?.data?.viewer?.accounts?.[0]?.pagesViewsAdaptiveGroups || [];
  let requests = 0, visits = 0;
  for (const g of groups) {
    requests += g?.sum?.requests || 0;
    visits += g?.sum?.visits || 0;
  }
  return { requests, visits, ok: !!json?.data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const decoded = token ? decodeJwt(token) : null;
    const userId = decoded?.sub;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: projects } = await supabase
      .from("projects")
      .select("id, domain, hosting_platform")
      .eq("user_id", userId)
      .eq("hosting_platform", "cloudflare");

    const { data: keys } = await supabase
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);
    const map = Object.fromEntries((keys || []).map((k: any) => [k.provider, k.api_key]));
    const accountId = map["cloudflare_account_id"];
    const apiToken = map["cloudflare_api_token"];

    const out: Record<string, { requests_24h: number; requests_7d: number; requests_30d: number; configured: boolean }> = {};

    if (!accountId || !apiToken) {
      for (const p of projects || []) {
        out[p.id] = { requests_24h: 0, requests_7d: 0, requests_30d: 0, configured: false };
      }
      return new Response(JSON.stringify({ stats: out, configured: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const since24 = isoDaysAgo(1);
    const since7  = isoDaysAgo(7);
    const since30 = isoDaysAgo(30);

    for (const p of projects || []) {
      const host = (p.domain || "").replace(/^https?:\/\//, "").split("/")[0];
      if (!host) {
        out[p.id] = { requests_24h: 0, requests_7d: 0, requests_30d: 0, configured: true };
        continue;
      }
      try {
        const [r24, r7, r30] = await Promise.all([
          gqlQuery(apiToken, accountId, since24, now, host),
          gqlQuery(apiToken, accountId, since7,  now, host),
          gqlQuery(apiToken, accountId, since30, now, host),
        ]);
        out[p.id] = {
          requests_24h: r24.requests,
          requests_7d: r7.requests,
          requests_30d: r30.requests,
          configured: true,
        };
      } catch (_e) {
        out[p.id] = { requests_24h: 0, requests_7d: 0, requests_30d: 0, configured: true };
      }
    }

    return new Response(JSON.stringify({ stats: out, configured: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});