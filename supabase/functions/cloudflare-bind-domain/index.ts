import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDomain(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function rootZone(host: string): string {
  // Strip leading "www." but keep other subdomains for Pages binding.
  // For zone creation use the registrable apex (last 2 labels for common TLDs,
  // last 3 for known multi-part like .co.uk). Best-effort heuristic.
  const h = host.replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const twoPartTlds = new Set(["co.uk", "com.ua", "com.ru", "org.uk", "co.il", "com.au"]);
  const last2 = parts.slice(-2).join(".");
  const last3 = parts.slice(-3).join(".");
  if (twoPartTlds.has(last2)) return last3;
  return last2;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId: string = body?.project_id;
    const domainRaw: string = body?.domain;
    if (!projectId || !domainRaw) return json({ error: "Missing project_id or domain" }, 400);

    const domain = normalizeDomain(domainRaw);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return json({ error: "Invalid domain" }, 400);
    const zoneName = rootZone(domain);

    // Verify project ownership and fetch cf project name
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, domain, custom_domain, hosting_platform")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (projErr || !project) return json({ error: "Project not found" }, 404);

    // Resolve Cloudflare credentials (server-side)
    const { data: apiKeys } = await admin
      .from("api_keys")
      .select("provider, api_key")
      .in("provider", ["cloudflare_account_id", "cloudflare_api_token"]);
    const keyMap = Object.fromEntries((apiKeys || []).map((k: any) => [k.provider, k.api_key]));
    const accountId = keyMap["cloudflare_account_id"];
    const apiToken = keyMap["cloudflare_api_token"];
    if (!accountId || !apiToken) {
      return json({ error: "Cloudflare credentials not configured (account_id/api_token)." }, 400);
    }

    const cfHeaders = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    // Resolve Pages project name from project.domain (xxx.pages.dev)
    const host = String(project.domain || "").replace(/^https?:\/\//, "").split("/")[0];
    const m = host.match(/^([a-z0-9-]+)\.pages\.dev$/i);
    const cfProjectName = m?.[1] || "";
    if (!cfProjectName) {
      return json({
        error: "Cloudflare Pages project not deployed yet. Deploy site first, then bind domain.",
      }, 400);
    }

    // === Step 1: Create zone (or fetch existing) to get NS servers ===
    let nameServers: string[] = [];
    let zoneStatus = "unknown";
    const createZoneRes = await fetch("https://api.cloudflare.com/client/v4/zones", {
      method: "POST",
      headers: cfHeaders,
      body: JSON.stringify({
        name: zoneName,
        account: { id: accountId },
        jump_start: true,
      }),
    });
    const createZoneJson = await createZoneRes.json().catch(() => ({} as any));

    if (createZoneRes.ok && createZoneJson?.success) {
      nameServers = createZoneJson?.result?.name_servers || [];
      zoneStatus = createZoneJson?.result?.status || "pending";
    } else {
      // Likely zone already exists -> look it up
      const lookupRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`,
        { headers: cfHeaders },
      );
      const lookupJson = await lookupRes.json().catch(() => ({} as any));
      const zone = lookupJson?.result?.[0];
      if (zone) {
        nameServers = zone.name_servers || [];
        zoneStatus = zone.status || "unknown";
      } else {
        const msg = createZoneJson?.errors?.map((e: any) => e.message).join("; ") || "Failed to create zone";
        return json({ error: `Cloudflare zone error: ${msg}` }, 400);
      }
    }

    // === Step 2: Attach domain to Pages project ===
    const attachRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${cfProjectName}/domains`,
      { method: "POST", headers: cfHeaders, body: JSON.stringify({ name: domain }) },
    );
    const attachJson = await attachRes.json().catch(() => ({} as any));
    if (!attachRes.ok && !(attachJson?.errors || []).some((e: any) => /already|exists/i.test(String(e?.message)))) {
      const msg = attachJson?.errors?.map((e: any) => e.message).join("; ") || "Failed to attach domain";
      return json({ error: `Cloudflare Pages domain error: ${msg}`, name_servers: nameServers, zone: zoneName }, 400);
    }

    // === Step 3: Status of the Pages domain ===
    let domainStatus = "pending";
    try {
      const statusRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${cfProjectName}/domains/${encodeURIComponent(domain)}`,
        { headers: cfHeaders },
      );
      const statusJson = await statusRes.json().catch(() => ({} as any));
      domainStatus = statusJson?.result?.status || "pending";
    } catch { /* ignore */ }

    // Save on project (use service role to bypass column protections if any)
    await admin.from("projects").update({ custom_domain: domain }).eq("id", projectId);

    return json({
      success: true,
      domain,
      zone: zoneName,
      name_servers: nameServers,
      zone_status: zoneStatus,
      domain_status: domainStatus,
      cf_project: cfProjectName,
      message: `Домен привязан. Пропишите NS-серверы у регистратора: ${nameServers.join(", ")}. Сайт заработает через 30 минут - 24 часа.`,
    });
  } catch (err: any) {
    console.error("[cloudflare-bind-domain] error:", err);
    return json({ error: String(err?.message || err) }, 500);
  }
});