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

const SEARCH_DEPTH = 30;

function findPosition(items: Array<{ link?: string; url?: string; position?: number }>, target: string): { pos: number | null; url: string | null } {
  const t = normalizeDomain(target);
  for (let i = 0; i < items.length; i++) {
    const link = items[i].link || items[i].url || "";
    if (normalizeDomain(link).endsWith(t) || normalizeDomain(link) === t) {
      return { pos: typeof items[i].position === "number" && Number.isFinite(items[i].position) ? items[i].position : i + 1, url: link };
    }
  }
  return { pos: null, url: null };
}

async function checkGoogle(serperKey: string, kw: string, region: string, city: string | null): Promise<{ results: Array<{ link: string; position: number }> }> {
  const body: Record<string, unknown> = {
    q: kw,
    gl: region.toLowerCase() || "ru",
    hl: region.toLowerCase() || "ru",
    num: SEARCH_DEPTH,
  };
  if (city) body.location = city;
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Serper Google ${res.status}`);
  const data = await res.json();
  const organic = Array.isArray(data.organic)
    ? data.organic.slice(0, SEARCH_DEPTH).map((r: { link?: string; position?: number }, index: number) => ({
      link: r.link || "",
      position: typeof r.position === "number" && Number.isFinite(r.position) ? r.position : index + 1,
    }))
    : [];
  return { results: organic };
}

async function checkYandex(apiKey: string, folderId: string, kw: string, region: string): Promise<{ results: Array<{ link: string; position: number }> }> {
  // New Yandex Cloud Search API (synchronous). Returns base64-encoded XML in `rawData`.
  // Docs: https://yandex.cloud/ru/docs/search-api/operations/web-search
  const body = {
    query: {
      searchType: "SEARCH_TYPE_RU",
      queryText: kw,
      familyMode: "FAMILY_MODE_NONE",
      page: "0",
      fixTypoMode: "FIX_TYPO_MODE_ON",
    },
    sortSpec: { sortMode: "SORT_MODE_BY_RELEVANCE" },
    groupSpec: {
      groupMode: "GROUP_MODE_DEEP",
      groupsOnPage: SEARCH_DEPTH,
      docsInGroup: 1,
    },
    region: /^\d+$/.test(region) ? region : "213",
    l10N: "LOCALIZATION_RU",
    folderId,
    responseFormat: "FORMAT_XML",
  };
  const res = await fetch("https://searchapi.api.cloud.yandex.net/v2/web/search", {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Yandex Cloud Search ${res.status}: ${txt.slice(0, 300)}`);
  let raw = "";
  try {
    const json = JSON.parse(txt);
    if (json.rawData) {
      // base64 -> XML
      try { raw = atob(json.rawData); } catch { raw = json.rawData; }
    } else {
      raw = txt;
    }
  } catch {
    raw = txt;
  }
  const urls = [...raw.matchAll(/<url>([^<]+)<\/url>/g)]
    .map((m, index) => ({ link: m[1], position: index + 1 }))
    .slice(0, SEARCH_DEPTH);
  return { results: urls };
}

async function processRow(admin: ReturnType<typeof createClient>, row: TrackedRow, keys: { serper?: string; yandexApiKey?: string; yandexFolderId?: string }) {
  let pos: number | null = null;
  let url: string | null = null;
  let top10: unknown[] = [];
  try {
    if (row.engine === "google") {
      if (!keys.serper) throw new Error("Serper key missing");
      const g = await checkGoogle(keys.serper, row.keyword, row.region, row.city);
      top10 = g.results;
      const found = findPosition(g.results, row.target_domain);
      pos = found.pos; url = found.url;
    } else {
      if (!keys.yandexApiKey || !keys.yandexFolderId) throw new Error("Yandex Cloud credentials missing");
      const y = await checkYandex(keys.yandexApiKey, keys.yandexFolderId, row.keyword, row.region);
      top10 = y.results;
      const found = findPosition(y.results, row.target_domain);
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
    const { data: keyRows } = await admin.from("api_keys").select("provider, api_key, is_valid").in("provider", ["serper", "yandex_cloud_api_key", "yandex_folder_id"]);
    const keys: { serper?: string; yandexApiKey?: string; yandexFolderId?: string } = {};
    for (const r of keyRows ?? []) {
      if (r.provider === "serper" && r.is_valid !== false) keys.serper = r.api_key;
      if (r.provider === "yandex_cloud_api_key") keys.yandexApiKey = r.api_key;
      if (r.provider === "yandex_folder_id") keys.yandexFolderId = r.api_key;
    }
    // Fallback env vars
    keys.serper = keys.serper || Deno.env.get("SERPER_API_KEY") || undefined;
    keys.yandexApiKey = keys.yandexApiKey || Deno.env.get("YANDEX_CLOUD_API_KEY") || undefined;
    keys.yandexFolderId = keys.yandexFolderId || Deno.env.get("YANDEX_FOLDER_ID") || undefined;

    let body: { user_id?: string; cron?: boolean; target_domain?: string } = {};
    try { body = await req.json(); } catch { /* empty body OK */ }

    let targetUserId: string | null = body.user_id ?? null;
    const authHeader = req.headers.get("Authorization");
    const isCron = body.cron === true && authHeader?.includes(SERVICE_KEY);

    if (!isCron) {
      const __auth = await verifyAuth(req);
      if (__auth instanceof Response) return __auth;
      targetUserId = __auth.userId;
    }

    let query = admin.from("tracked_keywords").select("id,user_id,keyword,target_domain,engine,region,city").eq("is_active", true);
    if (targetUserId) query = query.eq("user_id", targetUserId);
    if (body.target_domain) {
      const normDomain = body.target_domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
      query = query.eq("target_domain", normDomain);
    }
    const { data: rows, error: rowsErr } = await query.limit(500);
    if (rowsErr) throw rowsErr;

    let processed = 0;
    for (const r of (rows ?? []) as TrackedRow[]) {
      await processRow(admin, r, keys);
      processed++;
    }

    return new Response(JSON.stringify({ ok: true, processed, missing: { serper: !keys.serper, yandex: !keys.yandexApiKey || !keys.yandexFolderId } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[rank-tracker-run] error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});