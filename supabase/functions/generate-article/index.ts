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
    const { keyword_id, author_profile_id, outline, lsi_keywords, competitor_tables, competitor_lists, deep_analysis_context, optimize_instructions, existing_content, miralinks_links, gogetlinks_links, expert_insights, include_expert_quote, include_comparison_table, anchor_links, seo_keywords, geo_location, custom_instructions, language: bodyLanguage, project_id: rawProjectId, source_page_url: rawSourceUrl } = body;
    const project_id = (rawProjectId && rawProjectId !== "none") ? rawProjectId : null;
    console.log("[generate-article] author_profile_id received:", author_profile_id, "| language override:", bodyLanguage || "none", "| project_id:", project_id || "none");
    if (!keyword_id || typeof keyword_id !== "string") throw new Error("keyword_id is required");

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
        return new Response(JSON.stringify({ error: "Превышен лимит генераций. Попробуйте позже." }), {
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
      return new Response(JSON.stringify({ error: "Недостаточно кредитов. Пополните баланс." }), {
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

    // Get keyword
    const { data: keyword } = await supabase.from("keywords").select("*").eq("id", keyword_id).single();
    if (!keyword) throw new Error("Keyword not found");

    // Get SERP results (include deep_analysis for entities)
    const { data: serpResults } = await supabase
      .from("serp_results")
      .select("title, snippet, url, deep_analysis")
      .eq("keyword_id", keyword_id)
      .order("position", { ascending: true })
      .limit(10);

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

    // ─── Smart-model routing for long EN articles ──────────────────────
    // Gemini Flash / Flash-Lite reliably code-switch (Cyrillic bleed) on
    // long English generations. Sonnet is virtually immune. Route
    // EN + difficulty >= 60 to Sonnet regardless of plan; short EN and
    // all RU keep the assignment model. Skipped on humanize/polish (own
    // model) and platform overrides above.
    {
      const kwLangEarly = String(
        bodyLanguage || keyword.language || (/[а-яё]/i.test(keyword.seed_keyword) ? "ru" : "en"),
      ).toLowerCase();
      const diff = Number(keyword.difficulty || 0);
      const flashish = /gemini-.*(flash|flash-lite)/i.test(model);
      if (
        kwLangEarly === "en" &&
        diff >= 60 &&
        !isHumanizePolish &&
        !project_id &&
        flashish
      ) {
        const prev = model;
        model = "anthropic/claude-sonnet-4";
        logModel = model;
        console.log("[generate-article] EN long-article model override:", prev, "->", model, "(difficulty=", diff, ")");
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

    const systemPrompt = (lexiconBlock ? `${baseSystemPrompt}\n\n${lexiconBlock}` : baseSystemPrompt)
      + buildSerpClusterDisciplineAddon(articleLang)
      + antiTurgBlock
      + serpEntityBlock
      + sourcePageBlock;

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

    // Use author's temperature if set, otherwise default
    const authorTemperature = authorData?.temperature ? Number(authorData.temperature) : 0.85;

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
            // drift into token-salad ("плуминиума", mixed scripts) past
            // ~8-10k tokens. RU tokenizes ~2x denser than EN, so a full
            // PRO article (1700-2100 words + FAQ) ≈ 8-10k RU tokens.
            // 12000 leaves a safety cushion above legitimate length; anything
            // beyond that is almost always the runaway tail.
            max_tokens: 12000,
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
        const decoder = new TextDecoder();
        const reader = upstream.getReader();
        let closed = false;
        let sseBuf = "";
        let realIn = 0;
        let realOut = 0;
        let realCostUsd: number | null = null;
        let genId: string | null = null;
        let assistantText = "";
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
                        max_tokens: 12000,
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
                  metadata: {
                    context: "writer_stream",
                    source: costSource,
                    estimated,
                    generation_id: genId,
                    ...(realCostUsd !== null ? { openrouter_cost_usd: realCostUsd } : {}),
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
