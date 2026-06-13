// vc.ru Writer - generates an article tuned for vc.ru editorial format.
// Body: { format, topic, thesis?, audience?, tone?, length?, generate_cover? }
// Returns: { markdown, meta:{title,subtitle,tags[],ps_question}, checklist[{label,ok,hint}], cover_data_url? }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { generateVcArticle, isVcFormat, pickVcModel, ruEReplace, normalizeDashes } from "../_shared/vcWriterCore.ts";
import { withTimeout } from "../_shared/withTimeout.ts";

async function serperSuggest(apiKey: string, q: string): Promise<string[]> {
  try {
    const res = await withTimeout(
      fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, gl: "ru", hl: "ru", num: 10 }),
      }),
      10000, "serper",
    );
    if (!res.ok) return [];
    const j: any = await res.json();
    const out: string[] = [];
    for (const p of j?.peopleAlsoAsk ?? []) if (p?.question) out.push(String(p.question));
    for (const r of j?.relatedSearches ?? []) if (r?.query) out.push(String(r.query));
    return out.map((s) => ruEReplace(normalizeDashes(s)).trim()).filter((s) => s.length >= 6 && s.length <= 120).slice(0, 12);
  } catch { return []; }
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const format = body.format ?? "guide";
    if (!isVcFormat(format)) return errorResponse("invalid format", 400);
    const topic = String(body.topic || "").trim();
    if (topic.length < 5) return errorResponse("topic is required (min 5 chars)", 400);
    const thesis = String(body.thesis || "").slice(0, 600);
    const audience = String(body.audience || "").slice(0, 200);
    const tone = String(body.tone || "").slice(0, 100);
    const length = Math.min(8000, Math.max(2500, Number(body.length) || 5500));
    const wantCover = !!body.generate_cover;
    const model = pickVcModel(body.model);
    const seoMode = !!body.seo_mode;
    let targetQuery = ruEReplace(normalizeDashes(String(body.target_query || ""))).trim().slice(0, 120);

    const admin = adminClient();
    const { data: orRow } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .maybeSingle();
    const apiKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OpenRouter key not configured", 500);

    // SEO mode без явного target_query: вытаскиваем подсказки из Serper и берём топовую.
    let serperSuggestions: string[] = [];
    if (seoMode && !targetQuery) {
      const { data: serperRow } = await admin
        .from("api_keys").select("api_key")
        .eq("provider", "serper").eq("is_valid", true).maybeSingle();
      const serperKey = serperRow?.api_key || Deno.env.get("SERPER_API_KEY");
      if (serperKey) {
        serperSuggestions = await serperSuggest(serperKey, topic);
        if (serperSuggestions.length) {
          // Берём первый PAA-вариант как target_query, в нижнем регистре.
          targetQuery = serperSuggestions[0].toLowerCase().slice(0, 120);
        }
      }
    }

    const out = await generateVcArticle({
      apiKey, model, format, topic, thesis, audience, tone, length, wantCover,
      targetQuery: targetQuery || undefined,
    });
    return jsonResponse({ ok: true, ...out, seo: { mode: seoMode, target_query: targetQuery || null, suggestions: serperSuggestions } });
  } catch (e: any) {
    console.error("[vc-writer] error", e?.message || e);
    const msg = e?.message || "Unknown error";
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(msg, status);
  }
});