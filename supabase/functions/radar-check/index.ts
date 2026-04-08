import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALL_AI_MODELS = [
  { key: "gemini_flash", model: "google/gemini-2.5-flash", label: "Gemini Flash" },
  { key: "chatgpt", model: "openai/gpt-4.1-nano", label: "ChatGPT" },
  { key: "perplexity", model: "perplexity/sonar", label: "Perplexity" },
  { key: "claude", model: "anthropic/claude-sonnet-4", label: "Claude" },
];

// ─── Brand / Domain Detection ───────────────────────────────────────────

function generateBrandVariants(brandName: string, domain: string): string[] {
  const variants = new Set<string>();
  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const domainBase = cleanDomain.replace(/\.[a-z]{2,}$/, "");

  variants.add(brandName.toLowerCase());
  variants.add(domainBase);

  const withSpaces = domainBase.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (withSpaces !== domainBase) variants.add(withSpaces);

  variants.add(brandName.toLowerCase().replace(/[-_]/g, " "));
  variants.add(brandName.toLowerCase().replace(/[-_\s]/g, ""));

  if (domainBase.length >= 4 && domainBase.length <= 15 && !domainBase.includes(" ")) {
    for (let i = 2; i <= domainBase.length - 2; i++) {
      variants.add(domainBase.slice(0, i) + " " + domainBase.slice(i));
    }
  }

  if (/[а-яё]/i.test(brandName)) {
    const stem = brandName.toLowerCase().replace(/(ы|и|а|я|у|ю|ом|ой|ем|ей|ов|ев|ам|ям|ах|ях|ами|ями)$/i, "");
    if (stem.length >= 3) variants.add(stem);
  }

  return Array.from(variants).filter(v => v.length >= 3);
}

function verifyBrandMention(
  text: string, brandName: string, domain: string,
): { is_brand_found: boolean; is_domain_found: boolean; matched_snippets: string[] } {
  const lower = text.toLowerCase();
  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const brandVariants = generateBrandVariants(brandName, domain);

  const domainBase = cleanDomain.replace(/\.[a-z]{2,}$/, "");
  const domainRegex = new RegExp(
    domainBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\.[a-z]{2,})?", "gi"
  );
  const is_domain_found = domainRegex.test(text) || lower.includes(cleanDomain);

  const is_brand_found = brandVariants.some(v => {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      const re = new RegExp(`(?:^|[\\s,.;:!?()"'«»—–\\-])${escaped}(?:[\\s,.;:!?()"'«»—–\\-]|$)`, "i");
      return re.test(text);
    } catch {
      return lower.includes(v);
    }
  });

  const matched_snippets: string[] = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase();
    if (brandVariants.some(v => sLower.includes(v)) || domainRegex.test(sentence) || sLower.includes(cleanDomain)) {
      matched_snippets.push(sentence.trim());
    }
  }

  return { is_brand_found, is_domain_found, matched_snippets: matched_snippets.slice(0, 8) };
}

// ─── Source Extraction ──────────────────────────────────────────────────

function extractSources(text: string): { url: string; domain: string; type: string }[] {
  const sources: Map<string, { url: string; domain: string; type: string }> = new Map();
  
  // Extract URLs
  const urlRegex = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s,)}\]"'<>]*/gi;
  let m;
  while ((m = urlRegex.exec(text)) !== null) {
    const url = m[0].replace(/[.,:;!?]+$/, "");
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, "");
      if (!sources.has(domain)) {
        const type = categorizeSource(domain);
        sources.set(domain, { url, domain, type });
      }
    } catch { /* ignore invalid URLs */ }
  }

  // Extract bare domains
  const domainPattern = /\b([a-zA-Z0-9][-a-zA-Z0-9]*\.(?:ru|com|net|org|io|co|de|fr|uk|pro|shop|store|online|site|info|biz|ai|dev|app))\b/gi;
  while ((m = domainPattern.exec(text)) !== null) {
    const domain = m[1].toLowerCase();
    if (!sources.has(domain)) {
      sources.set(domain, { url: `https://${domain}`, domain, type: categorizeSource(domain) });
    }
  }

  return Array.from(sources.values());
}

function categorizeSource(domain: string): string {
  const d = domain.toLowerCase();
  if (/ozon|wildberries|amazon|ebay|aliexpress/.test(d)) return "marketplace";
  if (/reddit|pikabu|quora|stackexchange|stackoverflow/.test(d)) return "ugc";
  if (/vc\.ru|habr|rb\.ru|techcrunch|forbes|wired|theverge|bbc|cnn/.test(d)) return "media";
  if (/sravni|price|compare|agregator|yandex\.ru/.test(d)) return "aggregator";
  if (/shop|store|магазин/.test(d)) return "store";
  if (/blog|wiki|medium|substack|spark/.test(d)) return "content";
  return "service";
}

// ─── Competitor Extraction ──────────────────────────────────────────────

function extractCompetitorDomains(text: string, ownDomain: string): string[] {
  const ownBase = ownDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.[a-z]{2,}$/, "");
  const domains = new Set<string>();

  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let m;
  while ((m = urlRegex.exec(text)) !== null) {
    const d = m[1].toLowerCase().replace(/^www\./, "");
    if (!d.includes(ownBase)) domains.add(d);
  }

  const domainPattern = /\b([a-zA-Z0-9][-a-zA-Z0-9]*\.(?:ru|com|net|org|io|co|de|fr|uk|pro|shop|store|online|site|info|biz|ai|dev|app))\b/gi;
  while ((m = domainPattern.exec(text)) !== null) {
    const d = m[1].toLowerCase();
    if (!d.includes(ownBase)) domains.add(d);
  }

  return Array.from(domains);
}

// ─── AI Sentiment Validation ────────────────────────────────────────────

async function validateSentiment(
  apiKey: string, aiResponseText: string, brandName: string,
  is_brand_found: boolean, is_domain_found: boolean,
): Promise<"positive" | "neutral" | "negative" | "not_found"> {
  if (!is_brand_found && !is_domain_found) return "not_found";

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4.1-nano",
        messages: [
          { role: "system", content: `You are a brand sentiment classifier. Reply with EXACTLY one word: POSITIVE, NEUTRAL, or NEGATIVE.` },
          { role: "user", content: `Brand: "${brandName}"\n\nAI Response:\n${aiResponseText.slice(0, 2000)}` },
        ],
        max_tokens: 10,
      }),
    });

    if (!resp.ok) return "neutral";
    const data = await resp.json();
    const answer = (data.choices?.[0]?.message?.content || "").trim().toUpperCase();
    if (answer.includes("POSITIVE")) return "positive";
    if (answer.includes("NEGATIVE")) return "negative";
    return "neutral";
  } catch {
    return "neutral";
  }
}

function determineStatus(
  is_brand_found: boolean, is_domain_found: boolean,
  competitorDomains: string[],
): "captured" | "displaced" | "opportunity" {
  if (is_brand_found || is_domain_found) return "captured";
  if (competitorDomains.length > 0) return "displaced";
  return "opportunity";
}

function buildSystemPrompt(language: string, brandName: string, dataNuggets: string[]): string {
  const nuggetText = dataNuggets.filter(n => n).join("; ");
  if (language === "ru") {
    return `Действуй как объективный пользователь поисковой системы. Изучи запрос и дай развёрнутый ответ с конкретными названиями компаний и сайтов. Упомяни бренд "${brandName}", если это уместно. Если бренд не подходит, назови топ-3 конкурента или альтернативы в данной нише с указанием их доменов. ${nuggetText ? `Учти: ${nuggetText}.` : ""} Ответ должен быть информативным с конкретными рекомендациями.`;
  }
  return `Act as an objective search engine user. Research the query and provide a detailed response with specific company names and websites. Mention "${brandName}" if relevant. If not, list top 3 competitors with domains. ${nuggetText ? `Consider: ${nuggetText}.` : ""} Response should include specific recommendations.`;
}

async function queryAIModel(apiKey: string, model: string, prompt: string, systemPrompt: string): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`AI model ${model} error: ${resp.status}`, errText);
    throw new Error(`AI model error: ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Main Handler ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("No auth token");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: orKey } = await supabaseAdmin.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseUser.from("profiles").select("plan").eq("id", user.id).single();
    if (profile?.plan !== "pro") {
      return new Response(JSON.stringify({ error: "GEO Radar is available on PRO plan only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { keyword_id, project_id, run_id, prompt_id, prompt_text } = body;

    if (!project_id || typeof project_id !== "string") throw new Error("project_id is required");

    // Rate limit
    const { data: rateLimitOk } = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: user.id, p_action: "radar_check", p_max_requests: 50, p_window_minutes: 60,
    });
    if (rateLimitOk === false) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Deduct 1 credit for this scan
    const { data: creditOk } = await supabaseAdmin.rpc("deduct_credit", { p_user_id: user.id });
    if (!creditOk) {
      return new Response(JSON.stringify({ error: "Insufficient credits" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: project } = await supabaseUser.from("radar_projects").select("*").eq("id", project_id).single();
    if (!project) throw new Error("Project not found");

    // Determine what text to query AI with
    let queryText = prompt_text || "";
    if (keyword_id) {
      const { data: kw } = await supabaseUser.from("radar_keywords").select("*").eq("id", keyword_id).single();
      if (!kw) throw new Error("Keyword not found");
      queryText = kw.keyword;
    }
    if (!queryText) throw new Error("No query text provided");

    const projectLanguage = (project as any).language || "en";
    const systemPrompt = buildSystemPrompt(projectLanguage, project.brand_name, project.data_nuggets || []);

    const results: any[] = [];
    const checkedAt = new Date().toISOString();

    for (const aiModel of ALL_AI_MODELS) {
      // Update run progress if run_id is provided
      if (run_id) {
        await supabaseAdmin.from("radar_analysis_runs").update({
          current_model: aiModel.label,
          current_prompt_text: queryText.slice(0, 100),
        }).eq("id", run_id);
      }

      try {
        const responseText = await queryAIModel(OPENROUTER_API_KEY, aiModel.model, queryText, systemPrompt);

        const { is_brand_found, is_domain_found, matched_snippets } = verifyBrandMention(
          responseText, project.brand_name, project.domain
        );

        const compDomains = extractCompetitorDomains(responseText, project.domain);
        const sources = extractSources(responseText);
        const status = determineStatus(is_brand_found, is_domain_found, compDomains);
        const sentiment = await validateSentiment(
          OPENROUTER_API_KEY, responseText, project.brand_name, is_brand_found, is_domain_found
        );

        const result = {
          user_id: user.id,
          keyword_id: keyword_id || null,
          prompt_id: prompt_id || null,
          run_id: run_id || null,
          model: aiModel.key,
          status,
          sentiment,
          brand_mentioned: is_brand_found,
          domain_linked: is_domain_found,
          is_brand_found,
          is_domain_found,
          competitor_domains: compDomains.slice(0, 15),
          ai_response_text: responseText.slice(0, 5000),
          matched_snippets: matched_snippets.slice(0, 8),
          sources,
          checked_at: checkedAt,
        };
        results.push(result);

        const { error: insertError } = await supabaseAdmin.from("radar_results").insert(result);
        if (insertError) console.error(`Failed to save result for ${aiModel.key}:`, insertError);
      } catch (e) {
        console.error(`Error checking ${aiModel.key}:`, e);
        const errorResult = {
          user_id: user.id,
          keyword_id: keyword_id || null,
          prompt_id: prompt_id || null,
          run_id: run_id || null,
          model: aiModel.key,
          status: "opportunity",
          sentiment: "not_found",
          brand_mentioned: false,
          domain_linked: false,
          is_brand_found: false,
          is_domain_found: false,
          competitor_domains: [],
          ai_response_text: `Error: ${e instanceof Error ? e.message : "Unknown"}`,
          matched_snippets: [],
          sources: [],
          checked_at: checkedAt,
        };
        results.push(errorResult);
        await supabaseAdmin.from("radar_results").insert(errorResult);
      }

      // Increment completed prompts in run
      if (run_id) {
        await supabaseAdmin.rpc("check_credits", { p_user_id: user.id }); // just to avoid unused
        // We increment completed_prompts atomically
        const { data: currentRun } = await supabaseAdmin.from("radar_analysis_runs").select("completed_prompts").eq("id", run_id).single();
        if (currentRun) {
          await supabaseAdmin.from("radar_analysis_runs").update({
            completed_prompts: (currentRun.completed_prompts || 0) + 1,
          }).eq("id", run_id);
        }
      }
    }

    if (keyword_id) {
      await supabaseAdmin.from("radar_keywords").update({ last_checked_at: checkedAt }).eq("id", keyword_id);
    }

    return new Response(
      JSON.stringify({ results, checked_at: checkedAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("radar-check error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
