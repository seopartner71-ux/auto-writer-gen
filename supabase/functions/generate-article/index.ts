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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Prompt builder logic moved to ../_shared/promptBuilder.ts so bulk-generate
// can use the IDENTICAL prompt without duplicating ~900 lines of stealth rules.


// ─── Main Handler ───────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    const { keyword_id, author_profile_id, outline, lsi_keywords, competitor_tables, competitor_lists, deep_analysis_context, optimize_instructions, existing_content, miralinks_links, gogetlinks_links, expert_insights, include_expert_quote, include_comparison_table, anchor_links, seo_keywords, geo_location, custom_instructions, language: bodyLanguage, project_id: rawProjectId } = body;
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
      console.log("[generate-article] No author selected, using default style");
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
    const systemPrompt = lexiconBlock ? `${baseSystemPrompt}\n\n${lexiconBlock}` : baseSystemPrompt;

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

    // Stream AI response with retry on 429
    let aiResponse: Response | null = null;
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: true,
          temperature: authorTemperature,
        }),
      });

      if (aiResponse.status === 429 && attempt < maxRetries) {
        const delay = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s
        console.log(`[generate-article] 429 rate limited, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await aiResponse.text(); // consume body
        await new Promise((r) => setTimeout(r, delay));
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

    // Cost log (estimate — streaming response, true tokens unavailable here).
    // Input is estimated from prompt char count (1 token ~= 4 chars), output
    // assumed at ~3000 tokens (typical long-form article). Best-effort, never throws.
    try {
      const promptChars = (systemPrompt?.length || 0) + (userPrompt?.length || 0);
      const estIn  = Math.max(0, Math.ceil(promptChars / 4));
      const estOut = 3000;
      void logCost(supabaseAdmin, {
        project_id: project_id || null,
        user_id: user.id,
        operation_type: "article_generation",
        model: String(model),
        tokens_input: estIn,
        tokens_output: estOut,
        metadata: { context: "writer_stream", estimated: true, source: (req.headers.get("x-bulk-user-id") ? "bulk" : "writer") },
      });
    } catch (_) { /* ignore */ }

    return new Response(aiResponse.body, {
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
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
