// Receives raw hits from a client-site collector (PHP snippet or VPS log shipper).
// Auth: per-site secret key in header `x-monitor-key` (only its SHA-256 hash is stored).
// The server classifies hits itself; only known bots and AI referrals are stored.
import { z } from "npm:zod@3.23.8";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-monitor-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const Hit = z.object({
  url: z.string().min(1).max(2000),
  status: z.number().int().min(100).max(599).optional(),
  ua: z.string().max(1000).optional().default(""),
  referrer: z.string().max(2000).optional().default(""),
  ip: z.string().max(100).optional().default(""),
  ts: z.string().max(40).optional(),
});
const Body = z.object({
  method: z.enum(["php", "access_log"]),
  test: z.boolean().optional().default(false),
  hits: z.array(Hit).min(1).max(500),
});

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = req.headers.get("x-monitor-key") || "";
  if (key.length < 20 || key.length > 200) return json({ error: "invalid key" }, 401);

  const raw = await req.text();
  if (raw.length > 1_000_000) return json({ error: "payload too large" }, 413);
  let parsed;
  try { parsed = Body.safeParse(JSON.parse(raw)); } catch { return json({ error: "invalid json" }, 400); }
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: keyRow } = await db.from("monitor_ingest_keys")
    .select("id, site_id, revoked_at, monitor_sites(domain)")
    .eq("key_hash", await sha256(key)).maybeSingle();
  if (!keyRow || keyRow.revoked_at) return json({ error: "invalid key" }, 401);
  const domain = String((keyRow as any).monitor_sites?.domain || "").toLowerCase();

  const [{ data: bots }, { data: sources }] = await Promise.all([
    db.from("monitor_bot_signatures").select("id,name,ua_pattern,category").eq("is_active", true).order("priority"),
    db.from("monitor_ai_sources").select("id,name,referrer_pattern,utm_pattern").eq("is_active", true),
  ]);

  const day = new Date().toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];
  let skippedDomain = 0;
  for (const h of body.hits) {
    // Reject hits for a foreign domain (absolute URLs only; paths are accepted).
    const uh = hostOf(h.url);
    if (uh && uh !== domain && !uh.endsWith("." + domain)) { skippedDomain++; continue; }
    const ts = h.ts && !isNaN(Date.parse(h.ts)) ? new Date(h.ts) : new Date();
    if (ts.getTime() > Date.now() + 5 * 60_000) continue;
    const base = {
      site_id: keyRow.site_id, url: h.url, http_status: h.status ?? null,
      user_agent: h.ua.slice(0, 1000), ingest_method: body.method, is_test: body.test,
      occurred_at: ts.toISOString(),
    };
    const ua = h.ua.toLowerCase();
    const bot = (bots ?? []).find((b) => ua.includes(b.ua_pattern.toLowerCase()));
    if (bot) {
      rows.push({ ...base, kind: "bot", bot_id: bot.id, bot_name: bot.name, bot_category: bot.category, detection: "user_agent" });
      continue;
    }
    const rh = hostOf(h.referrer);
    let src = rh ? (sources ?? []).find((s) => rh === s.referrer_pattern || rh.endsWith("." + s.referrer_pattern)) : undefined;
    let detection = "referrer";
    if (!src) {
      const m = /[?&]utm_source=([^&#]+)/i.exec(h.url);
      const utm = m ? decodeURIComponent(m[1]).toLowerCase() : "";
      if (utm) { src = (sources ?? []).find((s) => s.utm_pattern && utm.includes(s.utm_pattern.toLowerCase())); detection = "utm_source"; }
    }
    if (src) {
      rows.push({
        ...base, kind: "referral", source_id: src.id, source_name: src.name, detection,
        referrer: h.referrer.slice(0, 2000),
        visitor_hash: h.ip || h.ua ? (await sha256(`${day}|${h.ip}|${h.ua}`)).slice(0, 32) : null,
      });
    }
  }

  if (rows.length) {
    const { error } = await db.from("monitor_events").insert(rows);
    if (error) return json({ error: "store failed" }, 500);
  }
  const now = new Date().toISOString();
  await db.from("monitor_ingest_keys").update({ last_used_at: now }).eq("id", keyRow.id);
  await db.from("monitor_sites").update({
    status: "connected", ...(rows.length && !body.test ? { last_event_at: now } : {}), last_verified_at: now,
  }).eq("id", keyRow.site_id);

  return json({ ok: true, received: body.hits.length, stored: rows.length, skipped_domain: skippedDomain });
});
