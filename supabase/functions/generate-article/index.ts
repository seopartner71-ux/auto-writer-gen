import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost, tokensToUsd } from "../_shared/costLogger.ts";
import { resolveOpenRouterModel } from "../_shared/aiModel.ts";
import { buildRareLexiconAddon } from "../_shared/stealth.ts";
import {
  generateStealthPrompt,
  buildOptimizeUserPrompt,
  buildNewArticleUserPrompt,
  type StealthPromptInput,
} from "../_shared/promptBuilder.ts";
import { buildSerpClusterDisciplineAddon } from "../_shared/serpClusterPrompt.ts";
import { buildSerpEntityDisciplineAddon } from "../_shared/serpEntityDiscipline.ts";
import { ANTI_TURGENEV_ADDON, buildAntiTurgenevAddon } from "../_shared/antiTurgenevAddon.ts";
import { getStyleProfile } from "../_shared/styleProfile.ts";
import { resolveAutoAuthorByNiche } from "../_shared/authorAutoSelect.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";
import { assertPersonaLanguage } from "../_shared/personaLanguageGuard.ts";
import { detectContamination, buildLanguageEnforcementDirective } from "../_shared/languageGuard.ts";
import { sanitizeInventedBrands } from "../_shared/documentValidators.ts";
import {
  renderApprovedStructureBlock,
  validateStructure,
  buildStructureRetryDirective,
  type OutlineItem,
} from "../_shared/structureValidator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Prompt builder logic moved to ../_shared/promptBuilder.ts so bulk-generate
// can use the IDENTICAL prompt without duplicating ~900 lines of stealth rules.


// ─── Main Handler ───────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const elapsed = startTimer();
  let logUserId: string | undefined;
  let logModel: string | undefined;
  let logArticleId: string | undefined;
  try {
    const supabaseAdmin0 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: orKey } = await supabaseAdmin0.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const { keyword_id, author_profile_id, outline: outlineFromBody, lsi_keywords, competitor_tables, competitor_lists, deep_analysis_context, optimize_instructions, existing_content, miralinks_links, gogetlinks_links, expert_insights, include_expert_quote, include_comparison_table, anchor_links, seo_keywords, geo_location, custom_instructions, language: bodyLanguage, project_id: rawProjectId, source_page_url: rawSourceUrl, narration_person, client_id: rawClientId, mode: rawMode, quick_topic, quick_focus, quick_length, structure_strictness: rawStrictness } = body;
    let outline: any = outlineFromBody;
    const mode: "full" | "quick" = rawMode === "quick" ? "quick" : "full";
    // strict = enforce approved outline (default, retries on deviation);
    // flexible = allow the model to reorder / rename H2s freely (no retry).
    const structureStrictness: "strict" | "flexible" =
      rawStrictness === "flexible" ? "flexible" : "strict";
    console.log("[generate-article] structure_strictness:", structureStrictness);
    const project_id = (rawProjectId && rawProjectId !== "none") ? rawProjectId : null;
    const client_id = (rawClientId && typeof rawClientId === "string" && rawClientId !== "none") ? rawClientId : null;
    console.log("[generate-article] author_profile_id received:", author_profile_id, "| language override:", bodyLanguage || "none", "| project_id:", project_id || "none", "| client_id:", client_id || "none", "| mode:", mode);
    console.log("[generate-article] narration_person received:", narration_person ?? "null (default)");
    if (mode !== "quick") {
      if (!keyword_id || typeof keyword_id !== "string") throw new Error("keyword_id is required");
    } else {
      if (!quick_topic || typeof quick_topic !== "string" || !quick_topic.trim()) {
        throw new Error("quick_topic is required in quick mode");
      }
      if (quick_topic.length > 500) throw new Error("quick_topic too long");
      if (quick_focus && (typeof quick_focus !== "string" || quick_focus.length > 2000)) throw new Error("Invalid quick_focus");
      if (quick_length && !["short", "medium", "long"].includes(String(quick_length))) throw new Error("Invalid quick_length");
    }

    // Input sanitization: validate types and lengths
    if (outline && !Array.isArray(outline)) throw new Error("Invalid outline format");
    if (lsi_keywords && !Array.isArray(lsi_keywords)) throw new Error("Invalid lsi_keywords format");
    if (optimize_instructions && typeof optimize_instructions !== "string") throw new Error("Invalid optimize_instructions");
    if (optimize_instructions && optimize_instructions.length > 10000) throw new Error("optimize_instructions too long");
    if (existing_content && typeof existing_content !== "string") throw new Error("Invalid existing_content");
    if (existing_content && existing_content.length > 100000) throw new Error("existing_content too long (max 100k chars)");
    if (deep_analysis_context && typeof deep_analysis_context === "string" && deep_analysis_context.length > 50000) throw new Error("deep_analysis_context too long");

    // Check if user is admin early (admins bypass all limits)
    const { data: adminRoleEarly } = await supabaseAdmin0
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!adminRoleEarly;

    // Per-user rate limiting: max 10 article generations per hour (skip for admins)
    if (!isAdmin) {
      const { data: rateLimitOk } = await supabaseAdmin0.rpc("check_rate_limit", {
        p_user_id: user.id,
        p_action: "generate_article",
        p_max_requests: 10,
        p_window_minutes: 60,
      });
      if (rateLimitOk === false) {
        return new Response(JSON.stringify({ error: "Превышен лимит генераций. Попробуйте позже.", error_key: "edge.rateLimitGenerations" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get user profile for tier and credits
    const { data: profile } = await supabase.from("profiles").select("plan, credits_amount").eq("id", user.id).single();
    const rawPlan = profile?.plan || "basic";
    const userPlan = String(rawPlan).toLowerCase().trim().replace(/[^a-z]/g, "");
    const credits = profile?.credits_amount ?? 0;
    console.log("[generate-article][plan-check] user:", user.id, "plan:", rawPlan, "key:", userPlan, "credits:", credits);

    // isAdmin already checked above

    // Check credits before generation (skip for admins)
    if (!isAdmin && credits <= 0) {
      return new Response(JSON.stringify({ error: "Недостаточно кредитов. Пополните баланс.", error_key: "edge.notEnoughCredits" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hard monthly $-cap per plan (admins/staff bypass via SQL function).
    try {
      const { data: budget } = await supabaseAdmin.rpc("check_ai_budget", { _user_id: user.id, _model: null });
      if (budget && budget.allowed === false) {
        console.warn("[generate-article] budget block:", budget);
        return new Response(JSON.stringify({
          error: "Месячный лимит расходов AI исчерпан. Лимит обновится в начале месяца или повысьте тариф.",
          error_key: "edge.monthlyBudgetExhausted",
          budget,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Soft 80% nudge: notify user once per month when monthly cost crosses 80% of cap.
      try {
        const cost = Number((budget as any)?.monthly_cost ?? 0);
        const cap = Number((budget as any)?.cost_cap ?? 0);
        const reason = String((budget as any)?.reason ?? "");
        if (reason !== "privileged" && cap > 0 && cost / cap >= 0.8) {
          const monthStart = new Date();
          monthStart.setUTCDate(1);
          monthStart.setUTCHours(0, 0, 0, 0);
          const { data: existing } = await supabaseAdmin
            .from("notifications")
            .select("id")
            .eq("user_id", user.id)
            .eq("title", "AI-бюджет: израсходовано 80%")
            .gte("created_at", monthStart.toISOString())
            .maybeSingle();
          if (!existing) {
            const pct = Math.round((cost / cap) * 100);
            const msg = `Вы израсходовали ${pct}% месячного AI-бюджета ($${cost.toFixed(2)} из $${cap.toFixed(2)}). При достижении 100% генерация будет приостановлена до начала следующего месяца. Рассмотрите апгрейд тарифа, если планируете писать больше.`;
            await supabaseAdmin.from("notifications").insert({
              user_id: user.id,
              title: "AI-бюджет: израсходовано 80%",
              message: msg,
            });
            // Технический TG-алерт по AI-бюджету убран по политике уведомлений.
          }
        }
      } catch (e) {
        console.warn("[generate-article] budget 80% nudge failed:", (e as Error).message);
      }
    } catch (e) {
      console.warn("[generate-article] check_ai_budget failed (allowing):", (e as Error).message);
    }

    // Get model assignment
    // Humanize / Auto-fix loop sends optimize_instructions starting with the marker
    // "ЗАДАЧА: Исправь ТОЛЬКО указанную проблему" + the humanize text. Route those
    // through the dedicated humanize_polish slot so admins can pick a stronger
    // model (e.g. Claude Opus) for the final polish without slowing main generation.
    const isHumanizePolish =
      typeof optimize_instructions === "string" &&
      /UNIVERSAL STEALTH BYPASS|0% AI TARGET|0% AI detection|elite human editor/i.test(optimize_instructions);
    const writerTask = isHumanizePolish
      ? "humanize_polish"
      : (userPlan === "pro" ? "writer_pro" : "writer_basic");
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", writerTask)
      .maybeSingle();
    const fallbackModel = isHumanizePolish
      ? "anthropic/claude-sonnet-4"
      : (userPlan === "pro" ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash-lite");
    let model = assignment?.model_key || fallbackModel;
    logUserId = user.id;
    logModel = model;
    if (isHumanizePolish) console.log("[generate-article] humanize_polish route ->", model);

    // ── Hybrid FREE-tier: first article of a NANO/FREE user → Claude Opus 4.
    // Rationale: showcase flagship quality on the very first generation to
    // increase PRO conversion. Applies only to the main writer route
    // (not humanize_polish which has its own assignment).
    let isFirstFreeOpus = false;
    if (!isHumanizePolish && userPlan === "nano") {
      try {
        const { data: stats } = await supabaseAdmin
          .from("user_stats")
          .select("total_articles_created")
          .eq("user_id", user.id)
          .maybeSingle();
        const created = Number(stats?.total_articles_created ?? 0);
        if (created === 0) {
          model = "anthropic/claude-opus-4";
          logModel = model;
          isFirstFreeOpus = true;
          console.log("[generate-article] FREE first-article override -> Claude Opus 4 for user", user.id);
        }
      } catch (e) {
        console.warn("[generate-article] first-free-opus check failed:", (e as Error).message);
      }
    }

    // Site Factory project override: respect project.ai_model preference.
    if (project_id) {
      try {
        const { data: projForModel } = await supabaseAdmin
          .from("projects")
          .select("ai_model")
          .eq("id", project_id)
          .maybeSingle();
        if (projForModel?.ai_model) {
          model = resolveOpenRouterModel(projForModel.ai_model);
          console.log("[generate-article] project ai_model override:", projForModel.ai_model, "->", model);
        }
      } catch (e) { /* ignore - keep assignment model */ }
    }

    // ─── QUICK MODE (additive) ───────────────────────────────────────
    // Skips SERP research, LSI, persona autoselect, cluster / entity /
    // source-page discipline addons. Streams a single LLM call with a
    // compact system+user prompt. Cost logging + language guard identical
    // to the full pipeline. Introduced without touching the full branch.
    if (mode === "quick") {
      const qLang = (bodyLanguage === "en" || bodyLanguage === "ru")
        ? bodyLanguage
        : (/[а-яё]/i.test(String(quick_topic || ""))) ? "ru" : "en";
      const qLength = String(quick_length || "medium");
      const targetWords = qLength === "short" ? "800-1200" : qLength === "long" ? "2200-2800" : "1400-1800";

      const qNarrationSystem = narration_person === "ya"
        ? (qLang === "ru"
            ? `\n\n## Лицо повествования (обязательно)\nПиши строго от первого лица единственного числа: 'я', 'мой', 'меня', 'в моей практике', 'я рекомендую', 'я считаю'.\nЗАПРЕЩЕНО использовать 'мы/наш/нам/наша команда' в любых разделах (включая введение, выводы, FAQ, цитаты). Не переключайся между 'я' и 'мы' внутри статьи.`
            : `\n\n## Narrative voice (strict)\nWrite strictly in first person singular: 'I', 'my', 'me', 'in my experience', 'I recommend', 'I think'.\nDO NOT use 'we/our/us/our team' in any section (intro, conclusions, FAQ, quotes). Never switch between 'I' and 'we' inside the article.`)
        : narration_person === "my"
          ? (qLang === "ru"
              ? `\n\n## Лицо повествования (обязательно)\nПиши строго от первого лица множественного числа: 'мы', 'наш', 'нам', 'наша команда', 'в нашей практике', 'мы рекомендуем'.\nЗАПРЕЩЕНО использовать 'я/мой/меня/в моей практике' в любых разделах (включая введение, выводы, FAQ, цитаты). Не переключайся между 'мы' и 'я' внутри статьи.`
              : `\n\n## Narrative voice (strict)\nWrite strictly in first person plural: 'we', 'our', 'us', 'our team', 'in our practice', 'we recommend'.\nDO NOT use 'I/my/me' in any section (intro, conclusions, FAQ, quotes). Never switch between 'we' and 'I' inside the article.`)
          : "";

      const qSystem = (qLang === "ru"
        ? `Ты - опытный редактор. Пишешь развёрнутую статью в формате Markdown без SERP-исследования, опираясь на общие знания и здравый смысл.
Требования:
- Один H1 в начале (# Заголовок).
- Логичная структура H2/H3, без списков-обёрток вокруг всего текста.
- Целевой объём: ${targetWords} слов.
- Без выдумок про конкретные компании, продукты, статистику. Числа - только общеизвестные ориентиры или диапазоны.
- Пиши живым конкретным языком. Никакого "в современном мире", "в наше время".
- Только короткое тире "-", НЕ длинное.
- Никаких ** (жирного).
- Формат вывода: чистый Markdown, без пояснений до или после.`
        : `You are an experienced editor. Write a full article in Markdown without SERP research, using general knowledge and common sense.
Requirements:
- One H1 at the start (# Title).
- Logical H2/H3 structure, no list-wrapping the whole article.
- Target length: ${targetWords} words.
- No fabricated companies, products or statistics. Use only widely-known ranges or benchmarks.
- Concrete, plain language. Avoid "in today's world", "in the modern era".
- Only short hyphen "-", never em-dash.
- No ** bold.
- Output format: clean Markdown only, no wrapper explanations.`) + qNarrationSystem;

      const focusBlock = quick_focus && String(quick_focus).trim()
        ? (qLang === "ru"
            ? `\n\nОбязательно раскрой следующие аспекты:\n${String(quick_focus).trim()}`
            : `\n\nMake sure to cover the following aspects:\n${String(quick_focus).trim()}`)
        : "";
      const narrationTail = narration_person === "ya"
        ? (qLang === "ru"
            ? `\n\nЛицо повествования: строго от первого лица единственного числа (я, мой, меня). Никаких "мы/наш/нам". Не переключайся между "я" и "мы" внутри статьи.`
            : `\n\nNarrative voice: strictly first person singular (I, my, me). No 'we/our/us'. Do not switch between 'I' and 'we' inside the article.`)
        : narration_person === "my"
          ? (qLang === "ru"
              ? `\n\nЛицо повествования: строго от первого лица множественного числа (мы, наш, нам). Никаких "я/мой/меня". Не переключайся между "мы" и "я" внутри статьи.`
              : `\n\nNarrative voice: strictly first person plural (we, our, us). No 'I/my/me'. Do not switch between 'we' and 'I' inside the article.`)
          : "";
      const customTail = (custom_instructions && String(custom_instructions).trim())
        ? `\n\n${qLang === "ru" ? "Дополнительные пожелания:" : "Additional instructions:"}\n${String(custom_instructions).trim()}`
        : "";
      const qUser = (qLang === "ru"
        ? `Тема статьи: ${quick_topic}${focusBlock}`
        : `Article topic: ${quick_topic}${focusBlock}`)
        + customTail
        + narrationTail;

      // Quick mode always uses a fast/cheap model unless admin already
      // overrode via task_model_assignments. Force Gemini Flash for the
      // NANO/basic writer default; leave PRO/humanize/site-factory picks.
      if (!isHumanizePolish && !project_id) {
        model = "google/gemini-2.5-flash";
        logModel = model;
      }

      logPipelineEvent({
        stage: "generate",
        user_id: user.id,
        verdict: "pass",
        duration_ms: 0,
        model: String(model),
        meta: { mode: "quick", lang: qLang, length: qLength },
      });

      let quickResp: Response | null = null;
      for (let attempt = 0; attempt <= 2; attempt++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 120_000);
        try {
          quickResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://seo-modul.pro",
              "X-Title": "SEO-Modul generate-article quick",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: qSystem },
                { role: "user", content: qUser },
              ],
              stream: true,
              stream_options: { include_usage: true },
              usage: { include: true },
              temperature: 0.8,
              max_tokens: 8000,
            }),
            signal: ctrl.signal,
          });
        } finally { clearTimeout(t); }
        if (quickResp && quickResp.status === 429 && attempt < 2) {
          await quickResp.text();
          await new Promise((r) => setTimeout(r, [1500, 3000][attempt] ?? 0));
          continue;
        }
        break;
      }
      if (!quickResp || !quickResp.ok) {
        const st = quickResp?.status || 502;
        const txt = quickResp ? await quickResp.text().catch(() => "") : "";
        console.error("[generate-article][quick] AI error:", st, txt);
        return new Response(JSON.stringify({ error: st === 402 ? "AI credits exhausted" : "AI gateway error" }), {
          status: st === 402 ? 402 : (st === 429 ? 429 : 502),
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const upstream = quickResp.body!;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          try {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ lovable_meta: true, model: String(model), mode: "quick" })}\n\n`,
            ));
          } catch { /* ignore */ }
          const decoder = new TextDecoder();
          const reader = upstream.getReader();
          let closed = false;
          let sseBuf = "";
          let realIn = 0, realOut = 0;
          let realCostUsd: number | null = null;
          let genId: string | null = null;
          const ping = setInterval(() => {
            if (closed) return;
            try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* ignore */ }
          }, 20000);
          (async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
                try {
                  sseBuf += decoder.decode(value, { stream: true });
                  let nl: number;
                  while ((nl = sseBuf.indexOf("\n")) !== -1) {
                    const line = sseBuf.slice(0, nl).trim();
                    sseBuf = sseBuf.slice(nl + 1);
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;
                    const j = JSON.parse(payload);
                    if (!genId && typeof j?.id === "string") genId = j.id;
                    if (j?.usage) {
                      realIn = Number(j.usage.prompt_tokens || 0) || realIn;
                      realOut = Number(j.usage.completion_tokens || 0) || realOut;
                      const c = Number(j.usage.cost);
                      if (Number.isFinite(c) && c > 0) realCostUsd = c;
                    }
                  }
                } catch { /* ignore */ }
              }
            } catch (err) {
              try { controller.error(err); } catch { /* ignore */ }
            } finally {
              closed = true;
              clearInterval(ping);
              try { controller.close(); } catch { /* ignore */ }
              (async () => {
                try {
                  const tokens_input = realIn || Math.ceil((qSystem.length + qUser.length) / 4);
                  const tokens_output = realOut || 1500;
                  await logCost(supabaseAdmin, {
                    project_id: project_id || null,
                    user_id: user.id,
                    operation_type: "article_generation_quick",
                    model: String(model),
                    tokens_input,
                    tokens_output,
                    cost_usd: realCostUsd ?? undefined,
                    metadata: {
                      context: "writer_quick",
                      source: "writer",
                      estimated: !(realIn && realOut),
                      generation_id: genId,
                      quick_length: qLength,
                    },
                  });
                } catch (e) {
                  console.error("[generate-article][quick] cost log failed", e);
                }
              })();
            }
          })();
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Get keyword
    const { data: keyword } = await supabase.from("keywords").select("*").eq("id", keyword_id).single();
    if (!keyword) throw new Error("Keyword not found");

    // Server-side outline recovery. The approved database outline wins over
    // a shorter client payload, because stale Writer state was the source of
    // dropped Smart Research headings.
    const normalizeOutline = (items: any[] | null | undefined): Array<{ level: string; text: string }> => {
      if (!Array.isArray(items)) return [];
      return items
        .filter((o: any) => o && typeof o.text === "string" && o.text.trim())
        .map((o: any) => {
          const level = String(o.level || "h2").toLowerCase();
          return {
            level: ["h1", "h2", "h3"].includes(level) ? level : "h2",
            text: String(o.text).trim(),
          };
        });
    };
    const withSeedH1 = (items: Array<{ level: string; text: string }>) => {
      if (!items.length || items.some((o) => o.level === "h1")) return items;
      const seed = String((keyword as any).seed_keyword || "").trim();
      if (!seed) return items;
      return [{ level: "h1", text: seed.charAt(0).toUpperCase() + seed.slice(1) }, ...items];
    };
    const approvedOutlineFromKeyword = withSeedH1(normalizeOutline((keyword as any).approved_outline));
    const recommendedOutlineFromKeyword = withSeedH1(
      Array.isArray((keyword as any).recommended_headings)
        ? ((keyword as any).recommended_headings as string[])
            .filter((h) => typeof h === "string" && h.trim())
            .map((h) => ({ level: "h2", text: h.trim() }))
        : [],
    );
    const questionOutlineFromKeyword = withSeedH1(
      Array.isArray((keyword as any).questions)
        ? ((keyword as any).questions as string[])
            .filter((q) => typeof q === "string" && q.trim())
            .map((q) => ({ level: "h2", text: q.trim() }))
        : [],
    );
    const dbOutline = approvedOutlineFromKeyword.length > 0
      ? { source: "approved_outline", items: approvedOutlineFromKeyword }
      : recommendedOutlineFromKeyword.length > 0
        ? { source: "recommended_headings", items: recommendedOutlineFromKeyword }
        : questionOutlineFromKeyword.length > 0
          ? { source: "questions", items: questionOutlineFromKeyword }
          : null;
    const clientOutline = normalizeOutline(outline);
    if (dbOutline && dbOutline.items.length > clientOutline.length) {
      outline = dbOutline.items;
      console.log(
        `[GENERATE-STRUCTURE] outline recovered from keyword (${dbOutline.items.length} elements, source=${dbOutline.source}, client=${clientOutline.length})`,
      );
    } else if (clientOutline.length > 0) {
      outline = withSeedH1(clientOutline);
    }

    // Get SERP results (include deep_analysis for entities).
    // Fetch is_excluded so user-marked URLs are dropped from all downstream
    // analysis (structure, LSI, medians, entities).
    const { data: serpResultsRaw } = await supabase
      .from("serp_results")
      .select("title, snippet, url, deep_analysis, is_excluded, position")
      .eq("keyword_id", keyword_id)
      .order("position", { ascending: true })
      .limit(10);
    const totalSerp = (serpResultsRaw || []).length;
    const serpResults = (serpResultsRaw || []).filter((r: any) => !r.is_excluded);
    console.log(
      `[SERP-FILTER] processing ${serpResults.length}/${totalSerp} urls (excluded: ${totalSerp - serpResults.length})`,
    );

    // Extract entities from deep_analysis across all SERP results
    const allEntities: string[] = [];
    (serpResults || []).forEach((r: any) => {
      if (r.deep_analysis?.entities) {
        r.deep_analysis.entities.forEach((e: any) => {
          const name = typeof e === "string" ? e : e?.name || e?.entity;
          if (name && !allEntities.includes(name)) allEntities.push(name);
        });
      }
    });


    // Get author profile (use admin client for presets which have null user_id)
    let authorData: any = null;
    if (author_profile_id && author_profile_id !== "none") {
      const { data: author, error: authorErr } = await supabaseAdmin
        .from("author_profiles")
        .select("*")
        .eq("id", author_profile_id)
        .single();
      if (authorErr) {
        console.warn("[generate-article] Author profile not found:", author_profile_id, authorErr.message);
      } else {
        authorData = author;
        console.log("[generate-article] Using author:", author.name, "| type:", author.type, "| has system_instruction:", !!author.system_instruction);
      }
    } else {
      // Auto-select Persona by user's onboarding_niche so syntax_preset is
      // applied without manual UI selection. Skipped silently on humanize
      // passes (we want to preserve whatever style the original draft had).
      if (!isHumanizePolish) {
        const auto = await resolveAutoAuthorByNiche(supabaseAdmin, user.id);
        if (auto) {
          authorData = auto;
          console.log("[generate-article] Auto-selected persona by niche:", auto.name);
        } else {
          console.log("[generate-article] No author selected, using default style");
        }
      } else {
        console.log("[generate-article] No author selected (humanize pass) — keeping default");
      }
    }

    // ─── Persona language sanity-check ─────────────────────────────────
    // UI filters personas by locale, but the API accepts any author_profile_id.
    // If persona language ≠ target article language, drop the persona prompt
    // (fall back to plain style) and emit a pipeline_events warning.
    {
      const intendedLang = String(
        bodyLanguage || keyword.language || (/[а-яё]/i.test(keyword.seed_keyword) ? "ru" : "en"),
      ).toLowerCase();
      const kept = assertPersonaLanguage({
        authorProfile: authorData,
        articleLang: intendedLang,
        context: {
          fn: "generate-article",
          userId: user.id,
          keywordId: keyword_id ?? null,
        },
      });
      if (authorData && !kept) authorData = null;
    }

    // Fast-model override for low-quality publishing targets (Telegraph / Miralinks / GoGetLinks).
    // For these platforms users care about speed/cost more than nuance. Skip if it's a
    // humanize/polish pass (quality-critical) or a Site Factory project (already overridden).
    if (
      authorData &&
      !isHumanizePolish &&
      !project_id &&
      (authorData.is_telegraph_author ||
        authorData.name === "Телеграф" ||
        authorData.is_miralinks_profile ||
        authorData.is_gogetlinks_profile)
    ) {
      const prevModel = model;
      model = "google/gemini-2.5-flash";
      console.log(
        "[generate-article] platform fast-model override:",
        authorData.name,
        prevModel,
        "->",
        model,
      );
    }

    // ─── HARD language routing: EN writer NEVER on Flash/Mistral ─────
    // Gemini Flash / Flash-Lite / Mistral reliably code-switch (Cyrillic
    // bleed, RU template phrases) on English generations of any length.
    // Sonnet is the only safe default. Applied AFTER platform overrides
    // (Telegraph/Miralinks/SEO) so EN wins even for those authors.
    // Skipped only on humanize/polish (own model pipeline).
    {
      const kwLangEarly = String(
        bodyLanguage || keyword.language || (/[а-яё]/i.test(keyword.seed_keyword) ? "ru" : "en"),
      ).toLowerCase();
      const unsafeForEn = /(gemini-.*(flash|flash-lite)|mistral)/i.test(model);
      if (kwLangEarly === "en" && !isHumanizePolish && unsafeForEn) {
        const prev = model;
        model = "anthropic/claude-sonnet-4";
        logModel = model;
        console.log("[generate-article] EN hard model override:", prev, "->", model);
      }
    }

    // Build interlinking context if project_id is provided
    let interlinkingContext: StealthPromptInput["interlinkingContext"] = null;
    if (project_id) {
      const { data: project } = await supabaseAdmin.from("projects").select("*").eq("id", project_id).single();
      if (project && project.auto_interlinking) {
        const { data: projectArticles } = await supabaseAdmin
          .from("articles")
          .select("title, id, published_url")
          .eq("project_id", project_id)
          .in("status", ["completed", "published"])
          .not("title", "is", null)
          .order("created_at", { ascending: false })
          .limit(30);
        
        const domainBase = project.domain ? `https://${project.domain.replace(/^https?:\/\//, "")}` : "";
        const articleLinks = (projectArticles || [])
          .filter((a: any) => a.published_url && a.published_url.trim() !== "")
          .map((a: any) => ({
            title: a.title || "",
            url: a.published_url.trim(),
          }));
        
        if (articleLinks.length > 0) {
          interlinkingContext = {
            projectName: project.name,
            domain: project.domain,
            articles: articleLinks,
          };
          console.log(`[generate-article] Interlinking context: ${articleLinks.length} articles from project "${project.name}"`);
        }
      }
    }

    // Build stealth prompt via server-side function
    const stealthInput: StealthPromptInput = {
      authorProfile: authorData,
      serpData: (serpResults || []).map((r: any) => ({ title: r.title || "", snippet: r.snippet || "", url: r.url || "" })),
      lsiKeywords: lsi_keywords || keyword.lsi_keywords || [],
      userStructure: outline || [],
      keyword: {
        seed_keyword: keyword.seed_keyword,
        intent: keyword.intent,
        difficulty: keyword.difficulty,
        questions: keyword.questions,
        language: bodyLanguage || keyword.language || null,
        geo: keyword.geo || null,
      },
      competitorTables: competitor_tables,
      competitorLists: competitor_lists,
      deepAnalysisContext: deep_analysis_context,
      miralinksLinks: miralinks_links,
      gogetlinksLinks: gogetlinks_links,
      includeExpertQuote: include_expert_quote,
      includeComparisonTable: include_comparison_table,
      dataNuggets: body.data_nuggets || [],
      seoKeywords: seo_keywords || null,
      geoLocation: geo_location || null,
      customInstructions: custom_instructions || null,
      interlinkingContext,
    };

    const { system: baseSystemPrompt } = generateStealthPrompt(stealthInput);

    // Rare-lexicon perplexity boost: merge top SERP entities + LSI keywords.
    const lexiconTerms = Array.from(new Set([
      ...(allEntities || []),
      ...((lsi_keywords || keyword.lsi_keywords || []) as string[]),
    ])).slice(0, 25);
    const lexiconBlock = buildRareLexiconAddon(
      lexiconTerms,
      bodyLanguage || keyword.language || (/[а-яё]/i.test(keyword.seed_keyword) ? "ru" : "en"),
    );
    const articleLang = (bodyLanguage || keyword.language || (/[а-яё]/i.test(keyword.seed_keyword) ? "ru" : "en")).toLowerCase();
    // StyleProfile-aware addon: HARD_RULES берутся из пресета Persona, а не
    // из статической константы. Это убирает конфликт «Persona хочет рваный
    // синтаксис, antiTurgenev требует 18-30 слов».
    const stylePreset = (authorData as any)?.style_analysis?.syntax_profile
      ?? (authorData as any)?._auto_rule_syntax
      ?? null;
    const styleProfile = getStyleProfile(stylePreset);
    const antiTurgBlock = articleLang === "ru" ? buildAntiTurgenevAddon(styleProfile) : "";
    const serpEntityBlock = buildSerpEntityDisciplineAddon(serpResults || [], articleLang);
    // Source-page facts: pull cached facts for the user's own page so the writer
    // uses concrete details from THEIR site (e.g. "5-day hike") instead of generic
    // competitor numbers. Falls back to project.source_page_url if not provided.
    let sourcePageBlock = "";
    try {
      let resolvedUrl: string | null = (typeof rawSourceUrl === "string" && rawSourceUrl.trim()) ? rawSourceUrl.trim() : null;
      if (!resolvedUrl && project_id) {
        const { data: proj } = await supabaseAdmin.from("projects").select("source_page_url").eq("id", project_id).maybeSingle();
        if (proj?.source_page_url) resolvedUrl = proj.source_page_url;
      }
      if (resolvedUrl) {
        const { data: cached } = await supabaseAdmin
          .from("source_page_cache")
          .select("facts")
          .eq("user_id", user.id)
          .eq("url", resolvedUrl)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        const facts = cached?.facts;
        if (facts && typeof facts === "object") {
          const isEn = articleLang === "en";
          const L = isEn
            ? {
                service_name: "Service/product",
                usp: "USP",
                key_numbers: "Key numbers",
                features: "Features",
                brands: "Brands/models",
                audience: "Audience",
                location: "Location",
                pricing: "Pricing/format",
                guarantees: "Guarantees/certifications",
                delivery: "Delivery/installation",
                contacts: "Contacts/hours",
                must_mention: "Must mention",
              }
            : {
                service_name: "Услуга/продукт",
                usp: "УТП",
                key_numbers: "Ключевые цифры",
                features: "Особенности",
                brands: "Бренды/модели",
                audience: "Аудитория",
                location: "Гео",
                pricing: "Цены/формат",
                guarantees: "Гарантии/сертификаты",
                delivery: "Доставка/монтаж",
                contacts: "Контакты/режим",
                must_mention: "Обязательно упомянуть",
              };
          const lines: string[] = [];
          if (facts.service_name) lines.push(`${L.service_name}: ${facts.service_name}`);
          if (facts.usp) lines.push(`${L.usp}: ${facts.usp}`);
          if (Array.isArray(facts.key_numbers) && facts.key_numbers.length) lines.push(`${L.key_numbers}: ${facts.key_numbers.join("; ")}`);
          if (Array.isArray(facts.features) && facts.features.length) lines.push(`${L.features}: ${facts.features.join("; ")}`);
          if (Array.isArray(facts.brands) && facts.brands.length) lines.push(`${L.brands}: ${facts.brands.join("; ")}`);
          if (facts.audience) lines.push(`${L.audience}: ${facts.audience}`);
          if (facts.location) lines.push(`${L.location}: ${facts.location}`);
          if (facts.pricing) lines.push(`${L.pricing}: ${facts.pricing}`);
          if (facts.guarantees) lines.push(`${L.guarantees}: ${facts.guarantees}`);
          if (facts.delivery) lines.push(`${L.delivery}: ${facts.delivery}`);
          if (facts.contacts) lines.push(`${L.contacts}: ${facts.contacts}`);
          if (Array.isArray(facts.must_mention) && facts.must_mention.length) lines.push(`${L.must_mention}: ${facts.must_mention.join("; ")}`);
          if (lines.length) {
            if (isEn) {
              sourcePageBlock = `\n\nUser's website facts (URL: ${resolvedUrl}) — HIGHEST PRIORITY\nThese facts override any TOP-10 competitor data. On any conflict between competitor data and the facts below, the facts below win.\n- If the page says "5 days", write "5 days", not "1 to 10".\n- All numbers, service names, brands, prices, guarantees, and contacts must match this specific site.\n- At least 3 facts below must be woven naturally into the main body (not just the FAQ).\n- The USP and key numbers must appear in the intro or the first H2 section.\n- "Must mention" items must each appear at least once.\n\n${lines.join("\n")}\nEnd of website facts.`;
            } else {
              sourcePageBlock = `\n\n═══════════════════════════════════════════\n🔴 ФАКТЫ С САЙТА ПОЛЬЗОВАТЕЛЯ (URL: ${resolvedUrl}) — ВЫСШИЙ ПРИОРИТЕТ\n═══════════════════════════════════════════\nКРИТИЧНО: эти факты ПЕРЕБИВАЮТ данные ТОП-10 конкурентов. При любом конфликте между фактами конкурентов и фактами ниже — выигрывают факты ниже.\n- Если на странице указано "5 дней" — пиши "5 дней", а не "от 1 до 10".\n- Все цифры, названия услуг, бренды, цены, гарантии, контакты должны соответствовать ИМЕННО этому сайту.\n- Минимум 3 факта из списка ниже должны быть органично вплетены в основной текст статьи (не в FAQ).\n- УТП и ключевые цифры должны прозвучать во введении или в первом H2-разделе.\n- "Обязательно упомянуть" — упомянуть КАЖДЫЙ пункт из этого подсписка минимум один раз.\n\n${lines.join("\n")}\n═══════════════════════════════════════════\nКОНЕЦ ФАКТОВ С САЙТА\n═══════════════════════════════════════════`;
            }
            console.log("[generate-article] injected source page facts from", resolvedUrl, "lang:", articleLang);
          }
        } else {
          console.log("[generate-article] source_page_url provided but no cached facts:", resolvedUrl);
        }
      }
    } catch (e) {
      console.warn("[generate-article] source page facts inject failed:", (e as Error).message);
    }

    // ─── Client context block ─────────────────────────────────────────
    // If caller passed a client_id, validate ownership and render a
    // "brand voice + expert" block that is prepended BEFORE the SEO
    // discipline addons. This is the source of tone / authorship.
    let clientBlock = "";
    let clientRow: any = null;
    if (client_id) {
      try {
        const { data: c } = await supabaseAdmin
          .from("clients")
          .select("*")
          .eq("id", client_id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (c) {
          clientRow = c;
          const isEn = articleLang === "en";
          const lines: string[] = [];
          if (isEn) {
            lines.push("## Client context");
            lines.push("You are writing this article on behalf of an expert representing the client.");
            lines.push(`Client: ${c.name}`);
            if (c.domain) lines.push(`Domain: https://${String(c.domain).replace(/^https?:\/\//, "")}`);
            if (c.description) lines.push(`What they do: ${c.description}`);
            if (c.expert_name) lines.push(`Expert author: ${c.expert_name}`);
            if (c.expert_bio) lines.push(`Expert bio: ${c.expert_bio}`);
            if (c.brand_voice) {
              lines.push("");
              lines.push("## Brand voice");
              lines.push("Keep the following brand voice throughout the whole article:");
              lines.push(c.brand_voice);
            }
            lines.push("");
            lines.push("Important:");
            lines.push("- Preserve the brand voice in every section, including the FAQ.");
            if (c.expert_name) lines.push(`- The article's author is ${c.expert_name}. If "we"/"our" fits the style, tie it to ${c.name}, not an abstract "we".`);
            lines.push("- Do not use phrases that contradict the brand voice.");
            lines.push("- If brand_voice lists specific phrases or bans - follow them exactly.");
          } else {
            lines.push("## Контекст клиента");
            lines.push("Ты пишешь эту статью от лица эксперта, представляющего клиента.");
            lines.push(`Клиент: ${c.name}`);
            if (c.domain) lines.push(`Домен: https://${String(c.domain).replace(/^https?:\/\//, "")}`);
            if (c.description) lines.push(`Чем занимается: ${c.description}`);
            if (c.expert_name) lines.push(`Эксперт-автор материала: ${c.expert_name}`);
            if (c.expert_bio) lines.push(`Био эксперта: ${c.expert_bio}`);
            if (c.brand_voice) {
              lines.push("");
              lines.push("## Тональность бренда");
              lines.push("Придерживайся следующей тональности при написании статьи:");
              lines.push(c.brand_voice);
            }
            lines.push("");
            lines.push("Важно:");
            lines.push("- Сохраняй голос бренда во всех разделах статьи, включая FAQ.");
            if (c.expert_name) lines.push(`- Автор статьи - ${c.expert_name}. Если по стилю уместно упоминание \"мы\" / \"наш опыт\" - привязывай к бренду ${c.name}, а не абстрактному \"мы\".`);
            lines.push("- Не используй фразы, которые противоречат описанной тональности.");
            lines.push("- Если в brand_voice указаны конкретные обороты или запреты - соблюдай их точно.");
          }
          clientBlock = "\n\n" + lines.join("\n") + "\n";
          console.log("[generate-article] injected client context for", c.name);

          // ─── Internal linking (client_pages) ──────────────────────────
          const rawPages = Array.isArray((c as any).client_pages) ? (c as any).client_pages : [];
          const pages = rawPages
            .filter((p: any) => p && typeof p === "object" && typeof p.url === "string" && /^https?:\/\//i.test(p.url))
            .map((p: any) => ({
              url: String(p.url),
              title: String(p.title || "").slice(0, 200),
              description: String(p.description || "").slice(0, 300),
              priority: p.priority === "high" ? "high" : p.priority === "low" ? "low" : "medium",
            }));
          if (pages.length > 0) {
            const utmSource = String(c.default_utm_source || c.name || "brand").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
            const highPri = pages.filter((p: any) => p.priority === "high").slice(0, 30);
            const rest = pages.filter((p: any) => p.priority !== "high").slice(0, 70);
            const catalog = [...highPri, ...rest]
              .map((p: any) => `- ${p.url} — ${p.title || "(без заголовка)"}${p.description ? ` — ${p.description}` : ""}${p.priority === "high" ? " [PRIORITY]" : ""}`)
              .join("\n");
            const utmTemplate = `?utm_source=${utmSource}&utm_medium=article&utm_campaign=internal_link`;
            const linkBlock = articleLang === "en"
              ? `\n\n## Internal linking (HARD RULE)\nYou MUST insert 2 to 4 relevant links to the client's own pages listed below. Rules:\n- Use only URLs from the catalog. NEVER invent URLs.\n- Choose pages that are topically relevant to the current H2 section.\n- Prefer pages marked [PRIORITY] when equally relevant.\n- Use natural anchor text — never bare URL or "click here".\n- Distribute links across different H2 sections; do NOT stack them in one paragraph.\n- Each URL used at most once per article.\n- Append UTM to every link: ${utmTemplate}\n- Format: [anchor text](URL${utmTemplate})\n\nCatalog of client pages:\n${catalog}\n`
              : `\n\n## Внутренняя перелинковка (ЖЁСТКОЕ ПРАВИЛО)\nОбязательно вставь от 2 до 4 релевантных ссылок на страницы клиента из каталога ниже. Правила:\n- Используй ТОЛЬКО URL из каталога. Никогда не выдумывай ссылки.\n- Подбирай страницы, тематически подходящие к текущему H2.\n- При равной релевантности выбирай страницы с меткой [PRIORITY].\n- Анкор — естественная фраза, не "здесь", не голый URL.\n- Раскидывай ссылки по разным H2, не собирай в одном абзаце.\n- Один URL — максимум 1 раз в статье.\n- К каждой ссылке добавляй UTM: ${utmTemplate}\n- Формат: [текст анкора](URL${utmTemplate})\n\nКаталог страниц клиента:\n${catalog}\n`;
            clientBlock += linkBlock;
            console.log("[generate-article] injected", pages.length, "client pages for internal linking");
          }
          // ──────────────────────────────────────────────────────────────
        } else {
          console.warn("[generate-article] client_id supplied but not owned by user:", client_id);
        }
      } catch (e) {
        console.warn("[generate-article] client context inject failed:", (e as Error).message);
      }
    }

    const systemPrompt = (lexiconBlock ? `${baseSystemPrompt}\n\n${lexiconBlock}` : baseSystemPrompt)
      + clientBlock
      + (articleLang === "en"
          ? `\n\n=== CRITICAL BAN: NO INVENTED BRANDS OR MODEL NAMES ===\nNEVER invent brand names, product model names or alphanumeric model indexes (e.g. "Fighter T-15", "Scout T-654", "MTZ 152").\nYou may mention a specific brand or model ONLY if it literally appears in the provided research data (SERP snippets, competitor data, entities, client pages).\nIf you have no verified model name - write a generic description instead: "a machine of this class", "an entry-level model", "equipment in this price range".\nThis rule overrides any stylistic instruction about specificity. A fabricated model name is a critical error.`
          : `\n\n=== КРИТИЧЕСКИЙ ЗАПРЕТ: НИКАКИХ ВЫДУМАННЫХ БРЕНДОВ И МОДЕЛЕЙ ===\nНИКОГДА не выдумывай названия брендов, моделей техники и буквенно-цифровые индексы (например «Файтер Т-15», «Скаут Т-654», «Кентавр Т-654», «Беларус МТЗ 152»).\nУпоминать конкретный бренд или модель можно ТОЛЬКО если он дословно присутствует в предоставленных исходных данных (сниппеты SERP, данные конкурентов, сущности, страницы клиента).\nЕсли проверенного названия нет - пиши обобщенно: «модель этого класса», «базовая комплектация», «техника в этом ценовом сегменте».\nЭто правило важнее любых требований к конкретике. Выдуманная модель - критическая ошибка.`)
      + buildSerpClusterDisciplineAddon(articleLang)
      + antiTurgBlock
      + serpEntityBlock
      + sourcePageBlock
      + (narration_person === "ya"
          ? (articleLang === "ru"
              ? `\n\n=== ЛИЦО ПОВЕСТВОВАНИЯ (ЖЁСТКОЕ ПРАВИЛО, ПЕРЕОПРЕДЕЛЯЕТ ГОЛОС АВТОРА) ===\nВсё повествование - строго от первого лица единственного числа: я, мой, меня, мне, я считаю, я рекомендую, в моей практике.\nЗАПРЕЩЕНО: мы, наш, нам, наша команда, наши клиенты, у нас в компании - и любые формы множественного числа автора.\nНЕ переключайся между 'я' и 'мы' внутри статьи - выдерживай единое лицо от H1 до последнего FAQ.\nЕсли в стиле автора встречаются 'мы/наш' - заменяй на 'я/мой'. Правило действует в введении, всех разделах, примерах, выводах, FAQ и цитатах автора.`
              : `\n\n=== NARRATIVE VOICE (HARD RULE, OVERRIDES AUTHOR VOICE) ===\nAll prose is strictly first person singular: I, my, me, in my experience, I recommend, I think.\nFORBIDDEN: we, our, us, our team, our clients, at our company - and any first-person-plural author references.\nDO NOT switch between 'I' and 'we' inside the article - hold a single voice from H1 to the last FAQ.\nIf the author style sample uses 'we/our', rewrite to 'I/my'. Rule applies to intro, all sections, examples, conclusions, FAQ and author quotes.`)
          : narration_person === "my"
            ? (articleLang === "ru"
                ? `\n\n=== ЛИЦО ПОВЕСТВОВАНИЯ (ЖЁСТКОЕ ПРАВИЛО, ПЕРЕОПРЕДЕЛЯЕТ ГОЛОС АВТОРА) ===\nВсё повествование - строго от первого лица множественного числа: мы, наш, нам, наша команда, наши клиенты, в нашей практике, мы рекомендуем.\nЗАПРЕЩЕНО: я, мой, меня, мне, в моей практике - и любые формы единственного числа автора.\nНЕ переключайся между 'мы' и 'я' внутри статьи - выдерживай единое лицо от H1 до последнего FAQ.\nЕсли в стиле автора встречаются 'я/мой' - заменяй на 'мы/наш'. Правило действует в введении, всех разделах, примерах, выводах, FAQ и цитатах автора.`
                : `\n\n=== NARRATIVE VOICE (HARD RULE, OVERRIDES AUTHOR VOICE) ===\nAll prose is strictly first person plural: we, our, us, our team, our clients, in our practice, we recommend.\nFORBIDDEN: I, my, me, in my experience - and any first-person-singular author references.\nDO NOT switch between 'we' and 'I' inside the article - hold a single voice from H1 to the last FAQ.\nIf the author style sample uses 'I/my', rewrite to 'we/our'. Rule applies to intro, all sections, examples, conclusions, FAQ and author quotes.`)
            : "");

    // Build user prompt
    const lsiStr = (lsi_keywords || keyword.lsi_keywords || []).join(", ");
    const questionsStr = (keyword.questions || []).join("\n- ");
    const outlineStr = (outline || [])
      .map((o: any) => `${{ h1: "#", h2: "##", h3: "###" }[o.level] || "##"} ${o.text}`)
      .join("\n");
    const competitorStr = (serpResults || [])
      .map((r: any, i: number) => `${i + 1}. "${r.title}" - ${r.snippet || ""}`)
      .join("\n");

    let userPrompt: string;
    if (optimize_instructions && existing_content) {
      userPrompt = buildOptimizeUserPrompt(keyword, lsiStr, questionsStr, existing_content, optimize_instructions, deep_analysis_context);
    } else {
      userPrompt = buildNewArticleUserPrompt(
        keyword, outlineStr, competitorStr, lsiStr, questionsStr,
        miralinks_links, gogetlinks_links,
        keyword.must_cover_topics || [],
        keyword.content_gaps || [],
        allEntities,
        expert_insights || [],
        anchor_links,
        seo_keywords,
        geo_location,
        custom_instructions
      );
    }

    // ─── HARD-REQUIREMENT structure block ─────────────────────────────
    // Prepend the approved H1/H2/H3 outline (from Smart Research) to the
    // user prompt as an XML-tagged HARD requirement so the model cannot
    // paraphrase it away or drop sections. The existing "ПЛАН СТАТЬИ:"
    // block below stays as a secondary reminder.
    const structureLang: "ru" | "en" = articleLang === "en" ? "en" : "ru";
    const approvedOutline: OutlineItem[] = Array.isArray(outline)
      ? (outline as any[])
          .filter((o) => o && typeof o === "object" && o.text && o.level)
          .map((o) => ({ level: String(o.level).toLowerCase() as any, text: String(o.text) }))
      : [];
    const approvedStructureBlock = renderApprovedStructureBlock(approvedOutline, structureLang);
    if (approvedStructureBlock) {
      const flexNoteRu = "\n\nПРИМЕЧАНИЕ РЕДАКТОРА: разрешены умеренные вариации - можно объединять смежные H2, менять формулировки заголовков и слегка переставлять разделы, если это улучшает логику. Основные темы плана должны быть раскрыты.";
      const flexNoteEn = "\n\nEDITOR NOTE: moderate variations are allowed - you may merge adjacent H2s, rephrase headings, and lightly reorder sections when it improves flow. All main topics from the plan must still be covered.";
      const structureBlockFinal = structureStrictness === "flexible"
        ? approvedStructureBlock + (structureLang === "en" ? flexNoteEn : flexNoteRu)
        : approvedStructureBlock;
      userPrompt = `${structureBlockFinal}\n${userPrompt}\n\n${structureBlockFinal}`;
    }

    const approvedH2Count = approvedOutline.filter((o) => o.level === "h2").length;
    const approvedH3Count = approvedOutline.filter((o) => o.level === "h3").length;
    console.log(
      `[GENERATE-STRUCTURE] approved: ${approvedOutline.length} elements`,
      `(H1=${approvedOutline.filter((o) => o.level === "h1").length}, H2=${approvedH2Count}, H3=${approvedH3Count})`,
      `| in_prompt=${approvedStructureBlock ? "yes" : "no"}`,
      `| lang=${structureLang}`,
    );
    console.log(
      `[GENERATE-STRUCTURE] passed to prompt: ${approvedStructureBlock ? approvedOutline.length : 0} elements`,
      `| prompt_chars=${userPrompt.length}`,
    );

    // Reinforce narration voice at the very end of the user prompt so it wins
    // over the author-profile style sample (which may itself be written in a
    // different person). Recency + explicit ban list is what actually holds.
    if (narration_person === "ya") {
      userPrompt += articleLang === "ru"
        ? `\n\n---\nФИНАЛЬНОЕ НАПОМИНАНИЕ О ЛИЦЕ: пиши только от 'я/мой/меня'. Ни одного 'мы/наш/нам' во всём тексте (включая FAQ, выводы, цитаты). Если стиль автора использует 'мы' - переписывай на 'я'.`
        : `\n\n---\nFINAL VOICE REMINDER: write only in 'I/my/me'. Not a single 'we/our/us' anywhere in the article (including FAQ, conclusions, quotes). If the author style uses 'we', rewrite to 'I'.`;
    } else if (narration_person === "my") {
      userPrompt += articleLang === "ru"
        ? `\n\n---\nФИНАЛЬНОЕ НАПОМИНАНИЕ О ЛИЦЕ: пиши только от 'мы/наш/нам/наша команда'. Ни одного 'я/мой/меня' во всём тексте (включая FAQ, выводы, цитаты). Если стиль автора использует 'я' - переписывай на 'мы'.`
        : `\n\n---\nFINAL VOICE REMINDER: write only in 'we/our/us/our team'. Not a single 'I/my/me' anywhere in the article (including FAQ, conclusions, quotes). If the author style uses 'I', rewrite to 'we'.`;
    }

    // Use author's temperature if set, otherwise default
    const authorTemperature = authorData?.temperature ? Number(authorData.temperature) : 0.85;

    // Dynamic max_tokens by approved structure size. Long SERP-derived plans
    // need enough room for all H2/H3 sections, otherwise the tail of the plan
    // is cut and validation can only report missing headings after the fact.
    const dynamicMaxTokens = approvedOutline.length > 0
      ? Math.min(
          32000,
          Math.max(
            16000,
            3000 + approvedH2Count * 900 + approvedH3Count * 450,
          ),
        )
      : 12000;
    console.log(
      `[GENERATE-STRUCTURE] max_tokens=${dynamicMaxTokens}`,
      `(elements=${approvedOutline.length})`,
    );

    // Stream AI response with retry on 429.
    // Hard 120s timeout on connection open prevents stuck "processing" tasks
    // when OpenRouter hangs (separate from streaming read which has no timer).
    let aiResponse: Response | null = null;
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const openCtrl = new AbortController();
      const openTimer = setTimeout(() => openCtrl.abort(), 120_000);
      try {
        aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://seo-modul.pro",
            "X-Title": req.headers.get("x-bulk-user-id") ? "SEO-Modul bulk-generate" : "SEO-Modul generate-article",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: true,
            // Ask OpenRouter to include real usage (prompt/completion tokens
            // and upstream cost) in the final SSE chunk so we can log actuals
            // instead of the 3000-token estimate.
            stream_options: { include_usage: true },
            usage: { include: true },
            temperature: authorTemperature,
            // Hard cap output length: prevents runaway Opus generations that
            // drift into token-salad past ~8-10k tokens. Scaled to the
            // approved outline size (see dynamicMaxTokens above) so long
            // plans (20+ H2/H3) get enough room to actually finish.
            max_tokens: dynamicMaxTokens,
          }),
          signal: openCtrl.signal,
        });
      } finally {
        clearTimeout(openTimer);
      }

      if (aiResponse && aiResponse.status === 429 && attempt < maxRetries) {
        // Tightened backoff: 2s, 4s, 0s — frees ~27s of the 150s edge budget for actual generation.
        const delays = [2000, 4000, 0];
        const delay = delays[attempt] ?? 0;
        console.log(`[generate-article] 429 rate limited, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await aiResponse.text(); // consume body
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    if (!aiResponse || !aiResponse.ok) {
      if (aiResponse?.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded after retries, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse?.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = aiResponse ? await aiResponse.text() : "No response";
      console.error("AI error:", aiResponse?.status, errText);
      throw new Error(`AI gateway error: ${aiResponse?.status || "unknown"}`);
    }

    // Credit is now deducted on save, not on generation

    // Log usage
    supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "generate_article",
      model_used: model,
      tokens_used: 0,
    }).then(() => {});

    // Cost log is written AFTER the stream ends using real usage from
    // OpenRouter (stream_options.include_usage=true → usage arrives in the
    // final SSE chunk). If usage is missing, fall back to GET /generation?id=
    // with a short backoff. Only if both fail do we log an estimate.
    const costSource = req.headers.get("x-bulk-user-id") ? "bulk" : "writer";

    logPipelineEvent({
      stage: "generate",
      user_id: user.id,
      verdict: "pass",
      duration_ms: elapsed(),
      model: String(model),
      meta: { project_id: project_id || null, stream: true },
    });

    // Wrap upstream stream with keep-alive pings every 20s. Prevents Cloudflare
    // idle-timeout from killing the connection when the model thinks silently.
    // SSE comment lines (starting with ":") are ignored by clients.
    const upstream = aiResponse.body!;
    const keepAlive = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        // Announce model selection so the client can render "Powered by …" badges.
        try {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ lovable_meta: true, model: String(model), first_free_opus: isFirstFreeOpus })}\n\n`,
          ));
        } catch { /* ignore */ }
        const decoder = new TextDecoder();
        const reader = upstream.getReader();
        let closed = false;
        let sseBuf = "";
        let realIn = 0;
        let realOut = 0;
        let realCostUsd: number | null = null;
        let genId: string | null = null;
        let assistantText = "";
        // Best-known final text: updated by lang/structure retries so the
        // brand sanitizer runs on the version the client actually keeps.
        let finalText = "";
        const ping = setInterval(() => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* ignore */ }
        }, 20000);
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
              // Tap SSE payload to extract generation id + final usage frame.
              try {
                sseBuf += decoder.decode(value, { stream: true });
                let nl: number;
                while ((nl = sseBuf.indexOf("\n")) !== -1) {
                  const line = sseBuf.slice(0, nl).trim();
                  sseBuf = sseBuf.slice(nl + 1);
                  if (!line.startsWith("data:")) continue;
                  const payload = line.slice(5).trim();
                  if (!payload || payload === "[DONE]") continue;
                  const j = JSON.parse(payload);
                  if (!genId && typeof j?.id === "string") genId = j.id;
                  if (j?.usage) {
                    realIn = Number(j.usage.prompt_tokens || 0) || realIn;
                    realOut = Number(j.usage.completion_tokens || 0) || realOut;
                    const c = Number(j.usage.cost);
                    if (Number.isFinite(c) && c > 0) realCostUsd = c;
                  }
                  const delta = j?.choices?.[0]?.delta?.content;
                  if (typeof delta === "string" && delta) assistantText += delta;
                }
              } catch { /* ignore parse errors mid-stream */ }
            }
          } catch (err) {
            try { controller.error(err); } catch { /* ignore */ }
          } finally {
            closed = true;
            clearInterval(ping);
            // ─── Language contamination post-check ────────────────────
            // Runs on ANY model. If EN body came back with Cyrillic — do
            // a single silent retry inline (non-stream) and append the
            // clean version as a synthesized SSE frame with a control
            // marker so the client replaces the tainted buffer. RU with
            // heavy latin drift: log-only (safer threshold).
            try {
              const langForGuard = String(
                bodyLanguage || keyword.language || (/[а-яё]/i.test(keyword.seed_keyword) ? "ru" : "en"),
              ).toLowerCase() === "ru" ? "ru" : "en";
              const report = detectContamination(assistantText, langForGuard);
              if (report.contaminated) {
                console.warn(
                  "[generate-article][lang-guard] contamination detected:",
                  "lang=", langForGuard,
                  "foreign=", report.foreignChars,
                  "ratio=", report.ratio.toFixed(3),
                  "sample=", report.sample.slice(0, 160),
                );
                logPipelineEvent({
                  stage: "generate",
                  user_id: user.id,
                  verdict: "fail",
                  duration_ms: elapsed(),
                  model: String(model),
                  error_kind: "language_contamination",
                  error_message: `foreign_chars=${report.foreignChars} ratio=${report.ratio.toFixed(3)}`,
                  meta: {
                    lang: langForGuard,
                    sample: report.sample.slice(0, 240),
                  },
                });
                if (langForGuard === "en") {
                  try {
                    // Notify client — hint to show "regenerating" state.
                    controller.enqueue(new TextEncoder().encode(
                      `data: ${JSON.stringify({ lovable_language_retry: true, reason: "cyrillic_in_en" })}\n\n`,
                    ));
                  } catch { /* ignore */ }
                  // Non-streaming retry with strengthened language lock.
                  const retryModel = /gemini-.*(flash|flash-lite)/i.test(String(model))
                    ? "anthropic/claude-sonnet-4"
                    : String(model);
                  const retrySystem = systemPrompt + buildLanguageEnforcementDirective("en");
                  try {
                    const rr = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://seo-modul.pro",
                        "X-Title": "SEO-Modul generate-article lang-retry",
                      },
                      body: JSON.stringify({
                        model: retryModel,
                        messages: [
                          { role: "system", content: retrySystem },
                          { role: "user", content: userPrompt },
                        ],
                        temperature: authorTemperature,
                        max_tokens: dynamicMaxTokens,
                      }),
                    });
                    if (rr.ok) {
                      const rj = await rr.json();
                      const clean = String(rj?.choices?.[0]?.message?.content || "");
                      const rep2 = detectContamination(clean, "en");
                      // Cost log for retry attempt.
                      try {
                        const rIn = Number(rj?.usage?.prompt_tokens || 0);
                        const rOut = Number(rj?.usage?.completion_tokens || 0);
                        await logCost(supabaseAdmin, {
                          project_id: project_id || null,
                          user_id: user.id,
                          operation_type: "article_generation_lang_retry",
                          model: String(retryModel),
                          tokens_input: rIn,
                          tokens_output: rOut,
                          metadata: { context: "writer_lang_retry", original_model: String(model) },
                        });
                      } catch (_) {}
                      if (clean && !rep2.contaminated) {
                        try {
                          finalText = clean;
                          controller.enqueue(new TextEncoder().encode(
                            `data: ${JSON.stringify({
                              lovable_language_retry: true,
                              status: "success",
                              clean_content: clean,
                              retry_model: retryModel,
                            })}\n\n`,
                          ));
                        } catch { /* ignore */ }
                        logPipelineEvent({
                          stage: "generate",
                          user_id: user.id,
                          verdict: "pass",
                          duration_ms: elapsed(),
                          model: String(retryModel),
                          meta: { context: "lang_retry_success", original_model: String(model) },
                        });
                      } else {
                        try {
                          controller.enqueue(new TextEncoder().encode(
                            `data: ${JSON.stringify({
                              lovable_language_retry: true,
                              status: "failed",
                              reason: "still_contaminated_after_retry",
                            })}\n\n`,
                          ));
                        } catch { /* ignore */ }
                        logPipelineEvent({
                          stage: "generate",
                          user_id: user.id,
                          verdict: "fail",
                          duration_ms: elapsed(),
                          model: String(retryModel),
                          error_kind: "language_contamination_after_retry",
                          error_message: `foreign_chars=${rep2.foreignChars}`,
                        });
                      }
                    } else {
                      console.warn("[generate-article][lang-retry] upstream failed:", rr.status);
                    }
                  } catch (retryErr) {
                    console.warn("[generate-article][lang-retry] threw:", (retryErr as Error).message);
                  }
                }
              }
            } catch (guardErr) {
              console.warn("[generate-article][lang-guard] threw:", (guardErr as Error).message);
            }
            // ─── Structure validation post-check ──────────────────────
            // Parse the streamed article and compare its H1/H2/H3 with the
            // approved Smart Research outline. In strict mode, every H2/H3
            // must match, order must be preserved and extra H2 headings are
            // blocked. If not - run ONE silent non-stream retry with the
            // concrete missing/extra sections. On success, push a
            // `lovable_structure_retry` SSE frame so the client replaces
            // the tainted buffer (same pattern as lang-guard).
            // Skipped entirely when no approved outline was provided.
            try {
              if (approvedOutline.length > 0 && assistantText.length > 0) {
                const validateOpts = structureStrictness === "flexible"
                  ? { simThreshold: 0.4, passRatio: 0.5, h3PassRatio: 0.5, extraToleranceRatio: 0.6, allowReorder: true }
                  : { simThreshold: 0.5, passRatio: 1, h3PassRatio: 1, extraTolerance: 0, allowReorder: false };
                const report = validateStructure(approvedOutline, assistantText, validateOpts);
                console.log(
                  `[STRUCTURE-VALIDATION] mode=${structureStrictness} passed=${report.passed}`,
                  `h2_match=${(report.h2_match_ratio * 100).toFixed(0)}%`,
                  `h3_match=${(report.h3_match_ratio * 100).toFixed(0)}%`,
                  `missing_h2=${report.missing_h2.length}`,
                  `missing_h3=${report.missing_h3.length}`,
                  `extra=${report.extra_h2.length}`,
                  `order_ok=${!report.wrong_order}`,
                  `gen_h2=${report.generated_h2_count}/${report.approved_h2_count}`,
                  `gen_h3=${report.generated_h3_count}/${report.approved_h3_count}`,
                );
                // Retry only in strict mode. Flexible mode logs the report
                // and lets the draft through as-is.
                if (!report.passed && structureStrictness === "strict") {
                  logPipelineEvent({
                    stage: "generate",
                    user_id: user.id,
                    verdict: "fail",
                    duration_ms: elapsed(),
                    model: String(model),
                    error_kind: "structure_deviation",
                    error_message: `h2_match=${(report.h2_match_ratio * 100).toFixed(0)}% h3_match=${(report.h3_match_ratio * 100).toFixed(0)}% missing_h2=${report.missing_h2.length} missing_h3=${report.missing_h3.length} extra=${report.extra_h2.length} order_ok=${!report.wrong_order}`,
                    meta: {
                      missing_sample: report.missing_h2.slice(0, 5),
                      missing_h3_sample: report.missing_h3.slice(0, 5),
                      extra_sample: report.extra_h2.slice(0, 5),
                    },
                  });
                  try {
                    controller.enqueue(new TextEncoder().encode(
                      `data: ${JSON.stringify({ lovable_structure_retry: true, reason: "outline_mismatch", missing: report.missing_h2.length, missing_h3: report.missing_h3.length, extra: report.extra_h2.length })}\n\n`,
                    ));
                  } catch { /* ignore */ }
                  const retryUserPrompt = userPrompt + buildStructureRetryDirective(report, structureLang);
                  try {
                    const rr = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://seo-modul.pro",
                        "X-Title": "SEO-Modul generate-article structure-retry",
                      },
                      body: JSON.stringify({
                        model,
                        messages: [
                          { role: "system", content: systemPrompt },
                          { role: "user", content: retryUserPrompt },
                        ],
                        temperature: authorTemperature,
                        max_tokens: dynamicMaxTokens,
                      }),
                    });
                    if (rr.ok) {
                      const rj = await rr.json();
                      const clean = String(rj?.choices?.[0]?.message?.content || "");
                      try {
                        const rIn = Number(rj?.usage?.prompt_tokens || 0);
                        const rOut = Number(rj?.usage?.completion_tokens || 0);
                        await logCost(supabaseAdmin, {
                          project_id: project_id || null,
                          user_id: user.id,
                          operation_type: "article_generation_structure_retry",
                          model: String(model),
                          tokens_input: rIn,
                          tokens_output: rOut,
                          metadata: { context: "writer_structure_retry" },
                        });
                      } catch (_) {}
                      if (clean) {
                        const rep2 = validateStructure(approvedOutline, clean, validateOpts);
                        console.log(
                          `[STRUCTURE-VALIDATION][retry] passed=${rep2.passed}`,
                          `h2_match=${(rep2.h2_match_ratio * 100).toFixed(0)}%`,
                          `h3_match=${(rep2.h3_match_ratio * 100).toFixed(0)}%`,
                          `missing_h2=${rep2.missing_h2.length}`,
                          `missing_h3=${rep2.missing_h3.length}`,
                        );
                        if (rep2.passed || rep2.h2_match_ratio + rep2.h3_match_ratio > report.h2_match_ratio + report.h3_match_ratio) {
                          try {
                            controller.enqueue(new TextEncoder().encode(
                              `data: ${JSON.stringify({
                                lovable_structure_retry: true,
                                status: "success",
                                clean_content: clean,
                                match_ratio: rep2.h2_match_ratio,
                              })}\n\n`,
                            ));
                          } catch { /* ignore */ }
                          logPipelineEvent({
                            stage: "generate",
                            user_id: user.id,
                            verdict: "pass",
                            duration_ms: elapsed(),
                            model: String(model),
                            meta: { context: "structure_retry_success", before: report.h2_match_ratio, after: rep2.h2_match_ratio },
                          });
                        } else {
                          try {
                            controller.enqueue(new TextEncoder().encode(
                              `data: ${JSON.stringify({ lovable_structure_retry: true, status: "failed", reason: "no_improvement" })}\n\n`,
                            ));
                          } catch { /* ignore */ }
                        }
                      }
                    } else {
                      console.warn("[generate-article][structure-retry] upstream failed:", rr.status);
                    }
                  } catch (retryErr) {
                    console.warn("[generate-article][structure-retry] threw:", (retryErr as Error).message);
                  }
                }
              }
            } catch (structErr) {
              console.warn("[generate-article][structure-guard] threw:", (structErr as Error).message);
            }
            try { controller.close(); } catch { /* ignore */ }
            // Post-stream cost log with real usage. Backoff-poll OpenRouter
            // /generation if usage was not in the stream. Never throws.
            (async () => {
              try {
                if ((!realIn || !realOut) && genId) {
                  for (const wait of [800, 1500, 2500]) {
                    await new Promise((r) => setTimeout(r, wait));
                    try {
                      const gr = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(genId)}`, {
                        headers: {
                          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                          "HTTP-Referer": "https://seo-modul.pro",
                          "X-Title": "SEO-Modul generate-article",
                        },
                      });
                      if (!gr.ok) { await gr.text().catch(() => ""); continue; }
                      const gj = await gr.json();
                      const d = gj?.data || gj;
                      const nIn = Number(d?.tokens_prompt ?? d?.native_tokens_prompt ?? 0);
                      const nOut = Number(d?.tokens_completion ?? d?.native_tokens_completion ?? 0);
                      const nCost = Number(d?.total_cost ?? d?.cost);
                      if (nIn || nOut) { realIn = nIn || realIn; realOut = nOut || realOut; }
                      if (Number.isFinite(nCost) && nCost > 0) realCostUsd = nCost;
                      if (realIn && realOut) break;
                    } catch { /* keep polling */ }
                  }
                }
                const estimated = !(realIn && realOut);
                const tokens_input = realIn || Math.max(0, Math.ceil(((systemPrompt?.length || 0) + (userPrompt?.length || 0)) / 4));
                const tokens_output = realOut || 3000;
                await logCost(supabaseAdmin, {
                  project_id: project_id || null,
                  user_id: user.id,
                  operation_type: "article_generation",
                  model: String(model),
                  tokens_input,
                  tokens_output,
                  // Prefer OpenRouter's actual billed cost when it comes back
                  // in the SSE usage frame — bypasses stale PRICE_TABLE math
                  // that was producing $0 for Sonnet/Opus aliases.
                  cost_usd: realCostUsd ?? undefined,
                  metadata: {
                    context: "writer_stream",
                    source: costSource,
                    estimated,
                    generation_id: genId,
                    ...(realCostUsd !== null ? { openrouter_cost_usd: realCostUsd } : {}),
                    ...(isFirstFreeOpus ? { first_free_opus: true, subsidized: true } : {}),
                  },
                });
              } catch (e) {
                console.error("[generate-article] post-stream cost log failed", e);
              }
            })();
          }
        })();
      },
    });

    return new Response(keepAlive, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("generate-article error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    logPipelineEvent({
      stage: "generate",
      user_id: logUserId,
      article_id: logArticleId,
      verdict: "fail",
      duration_ms: elapsed(),
      model: logModel,
      error_kind: status === 401 ? "auth" : "upstream",
      error_message: msg,
    });
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
