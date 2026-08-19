// P7.11 - Custom domain verification for Site Factory projects.
//
// Read-only network check: resolves the domain over DNS-over-HTTPS and then
// fetches the live site to confirm it serves this project's bundle. Never
// touches the hosting platform bindings (Cloudflare/Vercel/GitHub keep their
// own flow) - it only records verification state on the project.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

interface DohAnswer { name: string; type: number; data: string }

async function resolve(name: string, type: "A" | "CNAME" | "AAAA"): Promise<string[]> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!res.ok) return [];
    const json = await res.json() as { Answer?: DohAnswer[] };
    return (json.Answer || []).map((a) => String(a.data).replace(/\.$/, ""));
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.project_id || "");
    if (!projectId) return errorResponse("project_id required", 400);

    const sb = adminClient();
    const { data: project } = await sb.from("projects")
      .select("id, user_id, domain, custom_domain, hosting_platform, indexnow_key")
      .eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("Project not found", 404);
    if ((project as Record<string, unknown>).user_id !== auth.userId) return errorResponse("Forbidden", 403);

    const host = String((project as Record<string, unknown>).custom_domain || "")
      .trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!host) return errorResponse("custom_domain is not set for this project", 400);

    const [a, cname] = await Promise.all([resolve(host, "A"), resolve(host, "CNAME")]);
    const dnsOk = a.length > 0 || cname.length > 0;

    let httpStatus = 0;
    let servesProject = false;
    let sitemapOk = false;
    let canonicalHostOk = false;
    let error: string | null = null;

    if (dnsOk) {
      try {
        const res = await fetch(`https://${host}/`, { redirect: "follow" });
        httpStatus = res.status;
        const html = await res.text();
        servesProject = res.ok && /<html/i.test(html);
        canonicalHostOk = !/rel=["']canonical["'][^>]*https:\/\/[^"']*(pages\.dev|vercel\.app|github\.io)/i.test(html);
        const sm = await fetch(`https://${host}/sitemap.xml`);
        sitemapOk = sm.ok && /<urlset|<sitemapindex/.test(await sm.text());
      } catch (e) {
        error = e instanceof Error ? e.message : "fetch failed";
      }
    } else {
      error = "DNS records not found";
    }

    const verified = dnsOk && servesProject && sitemapOk && canonicalHostOk;
    const status = verified ? "verified" : dnsOk ? "pending" : "unverified";

    await sb.from("projects").update({
      custom_domain_status: status,
      custom_domain_checked_at: new Date().toISOString(),
      custom_domain_error: verified ? null : (error || "Site is not served from the custom domain yet"),
    }).eq("id", projectId);

    return jsonResponse({
      success: true,
      host,
      status,
      verified,
      checks: {
        dns: dnsOk,
        a_records: a,
        cname_records: cname,
        http_status: httpStatus,
        serves_project: servesProject,
        sitemap: sitemapOk,
        canonical_uses_custom_domain: canonicalHostOk,
      },
      error,
    });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});