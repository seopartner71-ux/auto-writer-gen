// Rank Tracker: checks Google and Yandex positions for tracked_keywords.
// Modes:
//   POST { user_id }       — service-role daily cron (no JWT, run for all active users if user_id omitted)
//   POST {}                — authenticated user runs check for own keywords (manual refresh)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

interface TrackedRow {
  id: string;
  user_id: string;
  keyword: string;
  target_domain: string;
  engine: "google" | "yandex";
  region: string;
  city: string | null;
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}

function findPosition(items: Array<{ link?: string; url?: string }>, target: string): { pos: number | null; url: string | null } {
  const t = normalizeDomain(target);
  for (let i = 0; i < items.length; i++) {
    const link = items[i].link || items[i].url || "";
    if (normalizeDomain(link).endsWith(t) || normalizeDomain(link) === t) {
      return { pos: i + 1, url: link };
    }
  }
  return { pos: null, url: null };
}

async function checkGoogle(serperKey: string, kw: string, region: string, city: string | null): Promise<{ pos: number | null; url: string | null; top10: unknown[] }> {
  const body: Record<string, unknown> = {
    q: kw,
    gl: region.toLowerCase() || "ru",
    hl: region.toLowerCase() || "ru",
    num: 20,
  };
  if (city) body.location = city;
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Serper Google ${res.status}`);
  const data = await res.json();
  const organic = Array.isArray(data.organic) ? data.organic.slice(0, 10) : [];
  return { pos: null, url: null, top10: organic, ...{} } as never;
}

async function checkYandex(user: string, key: string, kw: string, region: string): Promise<{ top10: Array<{ link: string }> }> {
  // Yandex XML API. region: lr code (213 = Moscow). Default to RU/Moscow if non-numeric provided.
  const lr = /^\d+$/.test(region) ? region : "213";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <query>${kw.replace(/[<>&]/g, "")}</query>
  <page>0</page>
  <groupings><groupby attr="d" mode="deep" groups-on-page="10" docs-in-group="1"/></groupings>
</request>`;
  const url = `https://yandex.ru/search/xml?user=${encodeURIComponent(user)}&key=${encodeURIComponent(key)}&lr=${lr}&l10n=ru&sortby=rlv&filter=none`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/xml" }, body: xml });
  if (!res.ok) throw new Error(`Yandex XML ${res.status}`);
  const text = await res.text();
  // Extract <url>...</url> entries in document order.
  const urls = [...text.matchAll(/<url>([^<]+)<\/url>/g)].map(m => ({ link: m[1] })).slice(0, 10);
  return { top10: urls };
}

async function processRow(admin: ReturnType<typeof createClient>, row: TrackedRow, keys: { serper?: string; yandexUser?: string; yandexKey?: string }) {
  let pos: number | null = null;
  let url: string | null = null;
  let top10: unknown[] = [];
  try {
    if (row.engine === "google") {
      if (!keys.serper) throw new Error("Serper key missing");
      const g = await checkGoogle(keys.serper, row.keyword, row.region, row.city);
      top10 = g.top10;
      const found = findPosition(top10 as Array<{ link?: string }>, row.target_domain);
      pos = found.pos; url = found.url;
    } else {
      if (!keys.yandexUser || !keys.yandexKey) throw new Error("Yandex XML credentials missing");
      const y = await checkYandex(keys.yandexUser, keys.yandexKey, row.keyword, row.region);
      top10 = y.top10;
      const found = findPosition(y.top10, row.target_domain);
      pos = found.pos; url = found.url;
    }
  } catch (e) {
    console.error("[rank-tracker] row failed", row.id, (e as Error).message);
  }

  await admin.from("rank_history").insert({
    tracked_keyword_id: row.id,
    user_id: row.user_id,
    engine: row.engine,
    position: pos,
    url,
    raw_top10: top10,
  });
  await admin.from("tracked_keywords").update({
    last_checked_at: new Date().toISOString(),
    last_position: pos,
    last_url: url,
  }).eq("id", row.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Resolve serper + yandex creds
    const { data: keyRows } = await admin.from("api_keys").select("provider, api_key, is_valid").in("provider", ["serper", "yandex_xml_user", "yandex_xml_key"]);
    const keys: { serper?: string; yandexUser?: string; yandexKey?: string } = {};
    for (const r of keyRows ?? []) {
      if (r.provider === "serper" && r.is_valid !== false) keys.serper = r.api_key;
      if (r.provider === "yandex_xml_user") keys.yandexUser = r.api_key;
      if (r.provider === "yandex_xml_key") keys.yandexKey = r.api_key;
    }
    // Fallback env vars
    keys.serper = keys.serper || Deno.env.get("SERPER_API_KEY") || undefined;
    keys.yandexUser = keys.yandexUser || Deno.env.get("YANDEX_XML_USER") || undefined;
    keys.yandexKey = keys.yandexKey || Deno.env.get("YANDEX_XML_KEY") || undefined;

    let body: { user_id?: string; cron?: boolean } = {};
    try { body = await req.json(); } catch { /* empty body OK */ }

    let targetUserId: string | null = body.user_id ?? null;
    const authHeader = req.headers.get("Authorization");
    const isCron = body.cron === true && authHeader?.includes(SERVICE_KEY);

    if (!isCron) {
      // Authenticated path — manual refresh by user
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      targetUserId = user.id;
    }

    let query = admin.from("tracked_keywords").select("id,user_id,keyword,target_domain,engine,region,city").eq("is_active", true);
    if (targetUserId) query = query.eq("user_id", targetUserId);
    const { data: rows, error: rowsErr } = await query.limit(500);
    if (rowsErr) throw rowsErr;

    let processed = 0;
    for (const r of (rows ?? []) as TrackedRow[]) {
      await processRow(admin, r, keys);
      processed++;
    }

    return new Response(JSON.stringify({ ok: true, processed, missing: { serper: !keys.serper, yandex: !keys.yandexUser || !keys.yandexKey } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[rank-tracker-run] error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});