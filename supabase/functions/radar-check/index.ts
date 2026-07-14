// GEO Radar: scans a single keyword or prompt across 7 AI models via OpenRouter.
// Detects brand/domain mentions, sentiment, and competitor domains, then inserts
// one row per model into radar_results.
//
// Body: { keyword_id?: string, prompt_id?: string, prompt_text?: string,
//         project_id: string, run_id?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface ModelCfg { key: string; openrouter: string; }

const MODELS: ModelCfg[] = [
  { key: "gemini_flash", openrouter: "google/gemini-2.5-flash" },
  { key: "chatgpt",      openrouter: "openai/gpt-4o-mini" },
  { key: "perplexity",   openrouter: "perplexity/sonar" },
  { key: "claude",       openrouter: "anthropic/claude-3.5-haiku" },
  { key: "deepseek",     openrouter: "deepseek/deepseek-chat" },
  { key: "mistral",      openrouter: "mistralai/mistral-small-3.2-24b-instruct" },
  { key: "llama",        openrouter: "meta-llama/llama-3.3-70b-instruct" },
];

function normalizeDomain(d: string): string {
  return (d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}

/**
 * Branded query - запрос, в котором уже фигурирует название бренда или его домен.
 * Такие запросы дают ложную visibility: модель вынуждена упомянуть бренд,
 * brand_mentioned=true всегда. Помечаем их флагом и исключаем из общей метрики.
 */
function isBrandedQuery(query: string, brand: string, domainBase: string): boolean {
  const q = (query || "").toLowerCase();
  const b = (brand || "").toLowerCase().trim();
  const db = (domainBase || "").toLowerCase().trim();
  if (b && b.length >= 3 && q.includes(b)) return true;
  if (db && db.length >= 3 && q.includes(db)) return true;
  return false;
}

function extractDomains(text: string): string[] {
  const re = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s)]*)?/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = m[1].toLowerCase().replace(/^www\./, "");
    if (d.length > 4 && !d.endsWith(".md") && !d.endsWith(".txt")) out.add(d);
  }
  return [...out];
}

function findSnippets(text: string, term: string, maxCount = 3, ctx = 90): string[] {
  if (!term || term.length < 2) return [];
  const lc = text.toLowerCase();
  const lt = term.toLowerCase();
  const out: string[] = [];
  let from = 0;
  while (out.length < maxCount) {
    const i = lc.indexOf(lt, from);
    if (i < 0) break;
    const s = Math.max(0, i - ctx);
    const e = Math.min(text.length, i + lt.length + ctx);
    out.push((s > 0 ? "…" : "") + text.slice(s, e).trim() + (e < text.length ? "…" : ""));
    from = i + lt.length;
  }
  return out;
}

function detectSentiment(text: string, brand: string): "positive" | "neutral" | "negative" {
  if (!brand) return "neutral";
  const lc = text.toLowerCase();
  const i = lc.indexOf(brand.toLowerCase());
  if (i < 0) return "neutral";
  const window = lc.slice(Math.max(0, i - 120), Math.min(lc.length, i + brand.length + 120));
  const pos = /(лучш|рекоменд|надежн|качествен|популярн|выбор|лидер|премиум|отличн|плюс|преимущ|recommend|best|top|leading|excellent|popular|trusted|premium|quality)/i;
  const neg = /(плох|худш|избегай|пробле[мы]|жалоб|мошенн|обман|недостат|минус|разочаров|avoid|worst|scam|complaint|issue|problem|bad|poor)/i;
  const hasPos = pos.test(window);
  const hasNeg = neg.test(window);
  if (hasPos && !hasNeg) return "positive";
  if (hasNeg && !hasPos) return "negative";
  return "neutral";
}

async function queryOpenRouter(apiKey: string, model: string, prompt: string, lang: string, timeoutMs = 45_000): Promise<string> {
  const sys = lang === "ru"
    ? "Ты эксперт-консультант. Дай развёрнутый, полезный ответ на запрос пользователя. Если уместно — назови конкретные бренды, компании и сайты с доменами."
    : "You are an expert consultant. Give a thorough, useful answer to the user's query. When relevant, name specific brands, companies and websites with their domains.";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul radar-check",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 900,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`OpenRouter ${model} HTTP ${r.status}: ${t.slice(0, 200)}`);
    }
    const j = await r.json();
    try { logLLM({ functionName: "radar-check", model: ((j as any)?.model) as string, tokensIn: Number((j as any)?.usage?.prompt_tokens || 0), tokensOut: Number((j as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
    return (j?.choices?.[0]?.message?.content as string) || "";
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const { keyword_id, prompt_id, prompt_text, project_id, run_id } = body as {
      keyword_id?: string; prompt_id?: string; prompt_text?: string;
      project_id?: string; run_id?: string;
    };
    if (!project_id) return errorResponse("project_id required", 400);
    if (!keyword_id && !prompt_id) return errorResponse("keyword_id or prompt_id required", 400);

    const admin = adminClient();

    // Load project
    const { data: project, error: pErr } = await admin
      .from("radar_projects")
      .select("id, user_id, brand_name, domain, language")
      .eq("id", project_id)
      .maybeSingle();
    if (pErr || !project) return errorResponse("Project not found", 404);
    if (project.user_id !== userId) return errorResponse("Forbidden", 403);

    const brand: string = (project.brand_name || "").trim();
    const domain: string = normalizeDomain(project.domain || "");
    const domainBase = domain.replace(/\.[a-z]{2,}$/, "");
    const lang: string = project.language === "en" ? "en" : "ru";

    // Load brand entities (aliases, products, domain variants) for richer detection.
    // Fallback: if none exist, we stay on brand_name + domain only.
    let brandStrings: string[] = [];
    let domainStrings: string[] = [];
    try {
      const { data: ents } = await admin
        .from("radar_brand_entities")
        .select("entity_type, value")
        .eq("project_id", project_id);
      for (const e of ents || []) {
        const v = String((e as any).value || "").trim();
        if (!v) continue;
        const type = (e as any).entity_type as string;
        if (type === "brand_alias" || type === "product" || type === "legal_entity") {
          brandStrings.push(v);
        } else if (type === "domain_variant") {
          domainStrings.push(normalizeDomain(v));
        }
      }
    } catch (_) { /* fallback to brand_name + domain */ }
    if (brand) brandStrings.push(brand);
    if (domain) domainStrings.push(domain);
    // Dedup + case-normalise brand strings
    const brandNeedles = Array.from(new Set(
      brandStrings.map((s) => s.toLowerCase().trim()).filter((s) => s.length >= 2),
    ));
    const domainNeedles = Array.from(new Set(
      domainStrings.filter((s) => s && s.length >= 3),
    ));

    // Resolve prompt text
    let queryText = "";
    let originalKeyword = "";
    if (keyword_id) {
      const { data: kw } = await admin
        .from("radar_keywords").select("keyword, project_id, user_id")
        .eq("id", keyword_id).maybeSingle();
      if (!kw || kw.project_id !== project_id) return errorResponse("Keyword not found", 404);
      originalKeyword = kw.keyword || "";
      queryText = lang === "ru"
        ? `Назови лучшие компании и сервисы по запросу: ${kw.keyword}. Перечисли названия и сайты.`
        : `Name the best companies and services for query: ${kw.keyword}. List names and websites.`;
    } else if (prompt_id) {
      const { data: pr } = await admin
        .from("radar_prompts").select("text, project_id, user_id")
        .eq("id", prompt_id).maybeSingle();
      if (!pr || pr.project_id !== project_id) return errorResponse("Prompt not found", 404);
      queryText = pr.text || prompt_text || "";
      originalKeyword = queryText;
    }
    if (!queryText) return errorResponse("Empty prompt", 400);

    // Branded query detection: считаем по оригинальному keyword/prompt, не по обёртке
    const branded = isBrandedQuery(originalKeyword, brand, domainBase);

    // Resolve OpenRouter key (DB first, env fallback)
    let openrouterKey: string | null = null;
    try {
      const { data: kRow } = await admin
        .from("api_keys").select("api_key")
        .eq("provider", "openrouter").eq("is_valid", true)
        .limit(1).maybeSingle();
      openrouterKey = kRow?.api_key ?? null;
    } catch { /* ignore */ }
    openrouterKey = openrouterKey || Deno.env.get("OPENROUTER_API_KEY") || null;
    if (!openrouterKey) return errorResponse("OpenRouter API key not configured", 500);

    // Run all models in parallel
    const tasks = MODELS.map(async (m) => {
      const baseRow: Record<string, unknown> = {
        user_id: userId,
        model: m.key,
        run_id: run_id ?? null,
        checked_at: new Date().toISOString(),
        is_branded_query: branded,
      };
      if (keyword_id) baseRow.keyword_id = keyword_id;
      if (prompt_id) baseRow.prompt_id = prompt_id;

      try {
        // Llama 70B стабильно медленнее остальных - даём ей в 2 раза больше времени.
        const perModelTimeout = m.key === "llama" ? 90_000 : 45_000;
        const text = await queryOpenRouter(openrouterKey!, m.openrouter, queryText, lang, perModelTimeout);
        const lc = text.toLowerCase();
        const brandFound = brandNeedles.some((n) => lc.includes(n));
        const domainFound =
          domainNeedles.some((n) => lc.includes(n)) ||
          (domainBase.length >= 3 && lc.includes(domainBase));
        const allDomains = extractDomains(text);
        const competitors = allDomains.filter((d) =>
          !domainNeedles.includes(d) && !domainNeedles.some((own) => own && (d === own || d.endsWith("." + own)))
        );
        const snippets = [
          ...findSnippets(text, brand, 2),
          ...findSnippets(text, domain, 2),
        ].slice(0, 3);
        const sentiment = detectSentiment(text, brand);

        // Для branded-запросов visibility = domain_found (модель вынуждена упомянуть бренд,
        // но домен/сайт - это уже честный сигнал авторитета). Для обычных - brand_mentioned.
        const isVisible = branded ? domainFound : brandFound;

        return {
          ...baseRow,
          status: isVisible ? "captured" : "displaced",
          ai_response_text: text.slice(0, 8000),
          brand_mentioned: brandFound,
          domain_linked: domainFound,
          is_brand_found: brandFound,
          is_domain_found: domainFound,
          competitor_domains: competitors.slice(0, 20),
          matched_snippets: snippets,
          sentiment,
          sources: [],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[radar-check] ${m.key} failed:`, msg);
        return {
          ...baseRow,
          status: "displaced",
          ai_response_text: `Error: ${msg.slice(0, 500)}`,
          brand_mentioned: false,
          domain_linked: false,
          is_brand_found: false,
          is_domain_found: false,
          competitor_domains: [],
          matched_snippets: [],
          sentiment: "neutral",
          sources: [],
        };
      }
    });

    const rows = await Promise.all(tasks);
    const { error: insErr } = await admin.from("radar_results").insert(rows as any);
    if (insErr) {
      console.error("[radar-check] insert error:", insErr);
      return errorResponse(`Insert failed: ${insErr.message}`, 500);
    }

    // Update keyword.last_checked_at
    if (keyword_id) {
      await admin.from("radar_keywords")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", keyword_id);
    }

    // Update run progress
    if (run_id) {
      const { data: runRow } = await admin
        .from("radar_analysis_runs").select("completed_prompts").eq("id", run_id).maybeSingle();
      const done = (runRow?.completed_prompts ?? 0) + MODELS.length;
      await admin.from("radar_analysis_runs")
        .update({ completed_prompts: done, current_prompt_text: queryText.slice(0, 200) })
        .eq("id", run_id);
    }

    return jsonResponse({
      ok: true,
      inserted: rows.length,
      brand_mentioned_count: rows.filter((r: any) => r.brand_mentioned).length,
    });
  } catch (e) {
    console.error("[radar-check] fatal:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
