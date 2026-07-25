// Import client site pages by discovering robots.txt / sitemap.xml,
// then fetching each URL to extract <title>, <meta description>, <h1>.
// Synchronous — returns final list. Cap: 200 URLs per import.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout, TIMEOUTS } from "../_shared/withTimeout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_URLS = 200;
const FETCH_CONCURRENCY = 8;

function normalizeDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

function belongsToDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch { return false; }
}

async function tryFetchText(url: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(url, { timeoutMs: TIMEOUTS.standard, redirect: "follow" });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

async function discoverSitemapUrls(domain: string): Promise<string[]> {
  const base = `https://${domain}`;
  const sitemaps: string[] = [];
  const robots = await tryFetchText(`${base}/robots.txt`);
  if (robots) {
    for (const line of robots.split(/\r?\n/)) {
      const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
      if (m) sitemaps.push(m[1].trim());
    }
  }
  if (sitemaps.length === 0) {
    for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/wp-sitemap.xml"]) {
      sitemaps.push(base + p);
    }
  }
  return sitemaps;
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

async function collectUrlsFromSitemaps(seeds: string[], domain: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...seeds];
  const found: string[] = [];
  let processed = 0;
  while (queue.length && processed < 20 && found.length < MAX_URLS) {
    const sm = queue.shift()!;
    processed++;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await tryFetchText(sm);
    if (!xml) continue;
    const locs = extractLocs(xml);
    for (const l of locs) {
      if (/\.xml($|\?)/i.test(l)) {
        if (!seen.has(l)) queue.push(l);
      } else if (belongsToDomain(l, domain)) {
        if (!found.includes(l)) found.push(l);
        if (found.length >= MAX_URLS) break;
      }
    }
  }
  return found.slice(0, MAX_URLS);
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .trim();
}

function extractMeta(html: string): { title: string; description: string; h1: string } {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const strip = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).slice(0, 300);
  return {
    title: titleM ? strip(titleM[1]) : "",
    description: descM ? strip(descM[1]) : "",
    h1: h1M ? strip(h1M[1]) : "",
  };
}

async function fetchMeta(url: string): Promise<{ url: string; title: string; description: string; h1: string }> {
  const html = await tryFetchText(url);
  if (!html) return { url, title: "", description: "", h1: "" };
  return { url, ...extractMeta(html) };
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseSrv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) throw new Error("Unauthorized");

    const admin = createClient(supabaseUrl, supabaseSrv);
    const body = await req.json();
    const clientId = String(body?.client_id || "");
    if (!clientId) throw new Error("client_id required");

    const { data: c, error: cerr } = await admin
      .from("clients")
      .select("id,user_id,domain,client_pages")
      .eq("id", clientId)
      .maybeSingle();
    if (cerr || !c) throw new Error("client_not_found");
    if (c.user_id !== user.id) throw new Error("forbidden");
    if (!c.domain) throw new Error("domain_required");

    const { data: profile } = await admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();
    const plan = (profile?.plan as string) || "nano";
    const limit = plan === "pro" ? 1000 : plan === "basic" ? 100 : 0;
    if (limit === 0) throw new Error("plan_not_allowed");

    const domain = normalizeDomain(c.domain);
    const existing = Array.isArray(c.client_pages) ? (c.client_pages as any[]) : [];
    const existingUrls = new Set(existing.map((p) => String(p?.url || "").toLowerCase()));

    const sitemaps = await discoverSitemapUrls(domain);
    const rawUrls = await collectUrlsFromSitemaps(sitemaps, domain);
    const uniqueNew = rawUrls.filter((u) => !existingUrls.has(u.toLowerCase()));
    const slots = Math.max(0, limit - existing.length);
    const toFetch = uniqueNew.slice(0, Math.min(slots, MAX_URLS));

    const metas = await mapConcurrent(toFetch, FETCH_CONCURRENCY, fetchMeta);
    const nowIso = new Date().toISOString();
    const added = metas.map((m) => ({
      id: crypto.randomUUID(),
      url: m.url,
      title: m.title,
      description: m.description,
      h1: m.h1,
      priority: "medium",
      category: "",
      added_at: nowIso,
      source: "sitemap",
    }));
    const merged = [...existing, ...added];

    const { error: uerr2 } = await admin.from("clients").update({ client_pages: merged }).eq("id", clientId);
    if (uerr2) throw uerr2;

    return new Response(JSON.stringify({
      ok: true,
      discovered: rawUrls.length,
      added: added.length,
      total: merged.length,
      limit,
      truncated: rawUrls.length > slots,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = (e as Error).message || "error";
    const status = msg === "Unauthorized" ? 401
      : msg === "forbidden" ? 403
      : msg === "plan_not_allowed" ? 402
      : msg === "domain_required" ? 400
      : msg === "client_not_found" ? 404
      : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});