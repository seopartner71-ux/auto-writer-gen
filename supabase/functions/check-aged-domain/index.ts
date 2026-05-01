import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DomainInput {
  domain: string;
  tf?: number;
  cf?: number;
  bl?: number;
  age_years?: number;
  raw?: Record<string, unknown>;
}

function normalizeDomain(d: string): string {
  return String(d || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

async function checkWayback(domain: string) {
  try {
    // available endpoint — last snapshot
    const lastRes = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(domain)}`);
    const lastJson = await lastRes.json().catch(() => ({}));
    const closest = lastJson?.archived_snapshots?.closest;
    const lastDate = closest?.timestamp ? closest.timestamp.slice(0, 8) : null;
    const hasSnap = !!closest?.available;

    // first snapshot — try year 1996
    let firstDate: string | null = null;
    if (hasSnap) {
      const firstRes = await fetch(
        `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&timestamp=19960101`
      );
      const firstJson = await firstRes.json().catch(() => ({}));
      firstDate = firstJson?.archived_snapshots?.closest?.timestamp?.slice(0, 8) ?? lastDate;
    }
    return { hasSnap, firstDate, lastDate };
  } catch {
    return { hasSnap: false, firstDate: null, lastDate: null };
  }
}

async function checkGoogleIndex(domain: string): Promise<{ indexed: boolean; count: number }> {
  try {
    const url = `https://relay.seo-modul.pro/?q=${encodeURIComponent("site:" + domain)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOModulBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { indexed: false, count: 0 };
    const html = await res.text();
    // Heuristic: presence of result anchors + absence of "did not match"
    const noResults = /did not match any documents|ничего не найдено|нет результатов/i.test(html);
    if (noResults) return { indexed: false, count: 0 };
    const m = html.match(/Результатов:?\s*(?:примерно\s*)?([\d\s.,]+)|About\s+([\d,\.]+)\s+results/i);
    const raw = (m?.[1] || m?.[2] || "").replace(/[^\d]/g, "");
    const count = raw ? parseInt(raw, 10) : 0;
    const hasLinks = /<a[^>]+href="[^"]*\/url\?q=/i.test(html) || /href="https?:\/\/[^"]*\/[^"]*"/i.test(html);
    return { indexed: count > 0 || hasLinks, count };
  } catch {
    return { indexed: false, count: 0 };
  }
}

function calcScore(d: {
  tf: number; cf: number; bl: number; age_years: number;
  archive_has_snapshots: boolean; google_indexed: boolean;
}) {
  const score =
    d.tf * 3 +
    d.cf * 1 +
    Math.min(d.bl, 100) * 0.5 +
    Math.min(d.age_years * 5, 50) +
    (d.archive_has_snapshots ? 10 : 0) +
    (d.google_indexed ? 20 : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Decode user from JWT
    const token = auth.replace(/^Bearer\s+/i, "");
    const payloadPart = token.split(".")[1];
    const padded = payloadPart + "=".repeat((4 - payloadPart.length % 4) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload?.sub;
    if (!userId) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const domains: DomainInput[] = Array.isArray(body?.domains) ? body.domains : [];
    if (!domains.length) {
      return new Response(JSON.stringify({ error: "domains required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const results: any[] = [];

    // batches of 5 with 1s pause
    for (let i = 0; i < domains.length; i += 5) {
      const batch = domains.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(async (item) => {
        const domain = normalizeDomain(item.domain);
        if (!domain) return null;

        // cache lookup
        const { data: cached } = await supabase
          .from("domain_checks")
          .select("*")
          .eq("user_id", userId)
          .eq("domain", domain)
          .gte("checked_at", cutoff)
          .order("checked_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cached) return cached;

        const wb = await checkWayback(domain);
        const g = await checkGoogleIndex(domain);

        const tf = Number(item.tf) || 0;
        const cf = Number(item.cf) || 0;
        const bl = Number(item.bl) || 0;
        const age_years = Number(item.age_years) || 0;

        const score = calcScore({
          tf, cf, bl, age_years,
          archive_has_snapshots: wb.hasSnap,
          google_indexed: g.indexed,
        });

        const row = {
          user_id: userId,
          domain,
          score,
          tf, cf, bl, age_years,
          archive_first_date: wb.firstDate,
          archive_last_date: wb.lastDate,
          archive_has_snapshots: wb.hasSnap,
          google_indexed: g.indexed,
          google_results_count: g.count,
          spam_listed: false,
          status: "available",
          raw_csv_data: item.raw || {},
          checked_at: new Date().toISOString(),
        };

        const { data: inserted } = await supabase
          .from("domain_checks")
          .insert(row)
          .select()
          .single();

        // cost log
        await supabase.from("cost_log").insert({
          user_id: userId,
          operation_type: "domain_check",
          model: null,
          tokens_input: 0,
          tokens_output: 0,
          cost_usd: 0,
          metadata: { domain },
        }).then(() => {}, () => {});

        return inserted ?? row;
      }));

      results.push(...batchResults.filter(Boolean));
      if (i + 5 < domains.length) await new Promise(r => setTimeout(r, 1000));
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});