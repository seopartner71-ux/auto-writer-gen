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

  // camelCase split: "myBrand" → "my brand"
  const withSpaces = domainBase.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (withSpaces !== domainBase) variants.add(withSpaces);

  // hyphen/underscore split: "my-brand" → "my brand"
  variants.add(brandName.toLowerCase().replace(/[-_]/g, " "));
  variants.add(brandName.toLowerCase().replace(/[-_\s]/g, ""));

  // For short domains try all split points
  if (domainBase.length >= 4 && domainBase.length <= 15 && !domainBase.includes(" ")) {
    for (let i = 2; i <= domainBase.length - 2; i++) {
      variants.add(domainBase.slice(0, i) + " " + domainBase.slice(i));
    }
  }

  // Russian morphology – base stem without endings
  if (/[а-яё]/i.test(brandName)) {
    const stem = brandName.toLowerCase().replace(/(ы|и|а|я|у|ю|ом|ой|ем|ей|ов|ев|ам|ям|ах|ях|ами|ями)$/i, "");
    if (stem.length >= 3) variants.add(stem);
  }

  return Array.from(variants).filter(v => v.length >= 3);
}

function verifyBrandMention(
  text: string,
  brandName: string,
  domain: string,
): { is_brand_found: boolean; is_domain_found: boolean; matched_snippets: string[] } {
  const lower = text.toLowerCase();
  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const brandVariants = generateBrandVariants(brandName, domain);

  // Domain detection – flexible regex
  const domainBase = cleanDomain.replace(/\.[a-z]{2,}$/, "");
  const domainRegex = new RegExp(
    domainBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\.[a-z]{2,})?",
    "gi"
  );
  const is_domain_found = domainRegex.test(text) || lower.includes(cleanDomain);

  // Brand detection – check all variants
  const is_brand_found = brandVariants.some(v => {
    // word-boundary aware search
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      const re = new RegExp(`(?:^|[\\s,.;:!?()"'«»—–\\-])${escaped}(?:[\\s,.;:!?()"'«»—–\\-]|$)`, "i");
      return re.test(text);
    } catch {
      return lower.includes(v);
    }
  });

  // Extract matched sentences
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

// ─── Competitor Extraction ──────────────────────────────────────────────

function extractCompetitorDomains(text: string, ownDomain: string): string[] {
  const ownBase = ownDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.[a-z]{2,}$/, "");
  const domains = new Set<string>();

  // URL-based extraction
  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let m;
  while ((m = urlRegex.exec(text)) !== null) {
    const d = m[1].toLowerCase().replace(/^www\./, "");
    if (!d.includes(ownBase)) domains.add(d);
  }

  // Bare domain pattern
  const domainPattern = /\b([a-zA-Z0-9][-a-zA-Z0-9]*\.(?:ru|com|net|org|io|co|de|fr|uk|pro|shop|store|online|site|info|biz|ai|dev|app))\b/gi;
  while ((m = domainPattern.exec(text)) !== null) {
    const d = m[1].toLowerCase();
    if (!d.includes(ownBase)) domains.add(d);
  }

  return Array.from(domains);
}

function extractCompetitorBrands(text: string, ownBrand: string, ownDomain: string): string[] {
  const brands = new Set<string>();
  const ownLower = ownBrand.toLowerCase();
  const ownBase = ownDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.[a-z]{2,}$/, "");

  // Pattern: "конкурент", "альтернатив", etc.
  const patterns = [
    /(?:конкурент|альтернатив|аналог|также|другие бренды|другие производител|другие компани)[а-яё]*[:\s]+([^\n.]+)/gi,
    /(?:competitor|alternative|similar|also|other brands?|other companies|other providers?)[s]?[:\s]+([^\n.]+)/gi,
    /(?:лучши[еx]|top|best|popular)\s+\d*\s*(?:сервис|инструмент|tool|service|platform|product)[а-яё]*[:\s]+([^\n.]+)/gi,
  ];
  for (const pattern of patterns) {
    let pm;
    while ((pm = pattern.exec(text)) !== null) {
      const names = pm[1].match(/[A-ZА-ЯЁ][a-zа-яё]+(?:\s[A-ZА-ЯЁ][a-zа-яё]+)*/g) || [];
      for (const name of names) {
        const nl = name.toLowerCase();
        if (nl !== ownLower && !nl.includes(ownBase) && nl.length > 2) brands.add(name);
      }
    }
  }

  const stopWords = new Set(["the", "for", "and", "with", "this", "that", "from", "are", "was", "has", "have", "can", "will", "not", "all", "also", "может", "если", "при", "для", "или", "что", "как", "это", "все", "они", "его", "она"]);
  return Array.from(brands).filter(b => !stopWords.has(b.toLowerCase())).slice(0, 15);
}

// ─── AI Sentiment Validation ────────────────────────────────────────────

async function validateSentiment(
  apiKey: string,
  aiResponseText: string,
  brandName: string,
  is_brand_found: boolean,
  is_domain_found: boolean,
): Promise<"positive" | "neutral" | "negative" | "not_found"> {
  if (!is_brand_found && !is_domain_found) return "not_found";

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-nano",
        messages: [
          {
            role: "system",
            content: `You are a brand sentiment classifier. Given AI response text and a brand name, classify the sentiment of the brand mention. Reply with EXACTLY one word: POSITIVE, NEUTRAL, or NEGATIVE.
- POSITIVE: Brand is recommended, praised, or listed as a top choice.
- NEUTRAL: Brand is simply mentioned as a market player without clear recommendation or criticism.
- NEGATIVE: Brand is criticized, warned against, or mentioned in negative context.`,
          },
          {
            role: "user",
            content: `Brand: "${brandName}"\n\nAI Response:\n${aiResponseText.slice(0, 2000)}`,
          },
        ],
        max_tokens: 10,
      }),
    });

    if (!resp.ok) {
      console.error("Sentiment validation failed:", resp.status);
      return is_brand_found || is_domain_found ? "neutral" : "not_found";
    }

    const data = await resp.json();
    const answer = (data.choices?.[0]?.message?.content || "").trim().toUpperCase();

    if (answer.includes("POSITIVE")) return "positive";
    if (answer.includes("NEGATIVE")) return "negative";
    return "neutral";
  } catch (e) {
    console.error("Sentiment check error:", e);
    return is_brand_found || is_domain_found ? "neutral" : "not_found";
  }
}

// ─── Status Determination ───────────────────────────────────────────────

function determineStatus(
  is_brand_found: boolean,
  is_domain_found: boolean,
  competitorDomains: string[],
  competitorBrands: string[],
): "captured" | "displaced" | "opportunity" {
  if (is_brand_found || is_domain_found) return "captured";
  if (competitorDomains.length > 0 || competitorBrands.length > 0) return "displaced";
  return "opportunity";
}

// ─── Nugget Matching ────────────────────────────────────────────────────

function matchNuggets(text: string, nuggets: string[]): Record<string, boolean> {
  const lower = text.toLowerCase();
  const result: Record<string, boolean> = {};
  for (const nugget of nuggets) {
    if (!nugget) continue;
    const words = nugget.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const matchCount = words.filter(w => lower.includes(w)).length;
    result[nugget] = words.length > 0 && matchCount / words.length >= 0.5;
  }
  return result;
}

// ─── System Prompt Builder ──────────────────────────────────────────────

function buildSystemPrompt(language: string, brandName: string, dataNuggets: string[]): string {
  const nuggetText = dataNuggets.filter(n => n).join("; ");
  if (language === "ru") {
    return `Действуй как объективный пользователь поисковой системы. Изучи запрос и дай развёрнутый ответ с конкретными названиями компаний и сайтов. Упомяни бренд "${brandName}", если это уместно и релевантно запросу. Если бренд не подходит, назови топ-3 конкурента или альтернативы в данной нише с указанием их доменов. ${nuggetText ? `Учти следующие тезисы о бренде: ${nuggetText}.` : ""} Ответ должен быть информативным, объективным и содержать конкретные рекомендации с названиями компаний.`;
  }
  return `Act as an objective search engine user. Research the query and provide a detailed response with specific company names and websites. Mention the brand "${brandName}" if it is relevant and fits the context. If not, list the top 3 competitors or alternatives in this niche with their domains. ${nuggetText ? `Consider these brand data nuggets: ${nuggetText}.` : ""} The response should be informative, objective, and include specific recommendations with company names.`;
}

// ─── AI Model Query ─────────────────────────────────────────────────────

async function queryAIModel(apiKey: string, model: string, keyword: string, systemPrompt: string): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: keyword },
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

// ─── Save Result ────────────────────────────────────────────────────────

async function saveRadarResult(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: {
    user_id: string;
    keyword_id: string;
    model: string;
    status: string;
    brand_mentioned: boolean;
    domain_linked: boolean;
    is_brand_found: boolean;
    is_domain_found: boolean;
    sentiment: string;
    competitor_domains: string[];
    ai_response_text: string;
    matched_snippets: string[];
    checked_at: string;
  },
) {
  const { error } = await supabaseAdmin.from("radar_results").insert(payload);
  if (error) console.error(`Failed to save radar result for ${payload.model}:`, error);
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
      return new Response(
        JSON.stringify({ error: "GEO Radar is available on PRO plan only" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { keyword_id, project_id } = body;

    if (!keyword_id || typeof keyword_id !== "string") throw new Error("keyword_id is required");
    if (!project_id || typeof project_id !== "string") throw new Error("project_id is required");

    const { data: rateLimitOk } = await supabaseAdmin.rpc("check_rate_limit", {
      p_user_id: user.id, p_action: "radar_check", p_max_requests: 20, p_window_minutes: 60,
    });
    if (rateLimitOk === false) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project } = await supabaseUser.from("radar_projects").select("*").eq("id", project_id).single();
    if (!project) throw new Error("Project not found");

    const { data: kw } = await supabaseUser.from("radar_keywords").select("*").eq("id", keyword_id).single();
    if (!kw) throw new Error("Keyword not found");

    const projectLanguage = (project as any).language || "en";
    const systemPrompt = buildSystemPrompt(projectLanguage, project.brand_name, project.data_nuggets || []);

    const results: any[] = [];
    const checkedAt = new Date().toISOString();

    for (const aiModel of ALL_AI_MODELS) {
      try {
        const responseText = await queryAIModel(OPENROUTER_API_KEY, aiModel.model, kw.keyword, systemPrompt);

        // Detection
        const { is_brand_found, is_domain_found, matched_snippets } = verifyBrandMention(
          responseText, project.brand_name, project.domain
        );

        // Competitor extraction
        const compDomains = extractCompetitorDomains(responseText, project.domain);
        const compBrands = extractCompetitorBrands(responseText, project.brand_name, project.domain);
        const allCompetitors = [...compDomains, ...compBrands].filter((v, i, a) => a.indexOf(v) === i).slice(0, 15);

        // Status
        const status = determineStatus(is_brand_found, is_domain_found, compDomains, compBrands);

        // Sentiment (AI validation)
        const sentiment = await validateSentiment(
          OPENROUTER_API_KEY, responseText, project.brand_name, is_brand_found, is_domain_found
        );

        // Nugget matching
        const nuggetMatches = matchNuggets(responseText, project.data_nuggets || []);
        const nuggetSnippets = Object.entries(nuggetMatches)
          .filter(([_, matched]) => matched)
          .map(([nugget]) => `[Data Nugget] ${nugget}`);

        const allSnippets = [...matched_snippets, ...nuggetSnippets].slice(0, 8);

        const result = {
          model: aiModel.key, status, sentiment,
          brand_mentioned: is_brand_found, domain_linked: is_domain_found,
          is_brand_found, is_domain_found,
          competitor_domains: allCompetitors,
          ai_response_text: responseText.slice(0, 5000),
          matched_snippets: allSnippets,
        };
        results.push(result);

        await saveRadarResult(supabaseAdmin, {
          user_id: user.id, keyword_id, model: aiModel.key, status, sentiment,
          brand_mentioned: is_brand_found, domain_linked: is_domain_found,
          is_brand_found, is_domain_found,
          competitor_domains: allCompetitors,
          ai_response_text: responseText.slice(0, 5000),
          matched_snippets: allSnippets,
          checked_at: checkedAt,
        });
      } catch (e) {
        console.error(`Error checking ${aiModel.key}:`, e);
        const errorResult = {
          model: aiModel.key, status: "opportunity", sentiment: "not_found",
          brand_mentioned: false, domain_linked: false,
          is_brand_found: false, is_domain_found: false,
          competitor_domains: [],
          ai_response_text: `Error: ${e instanceof Error ? e.message : "Unknown"}`,
          matched_snippets: [],
        };
        results.push(errorResult);

        await saveRadarResult(supabaseAdmin, {
          user_id: user.id, keyword_id, model: aiModel.key,
          status: "opportunity", sentiment: "not_found",
          brand_mentioned: false, domain_linked: false,
          is_brand_found: false, is_domain_found: false,
          competitor_domains: [],
          ai_response_text: `Error: ${e instanceof Error ? e.message : "Unknown"}`,
          matched_snippets: [],
          checked_at: checkedAt,
        });
      }
    }

    await supabaseAdmin.from("radar_keywords").update({ last_checked_at: checkedAt }).eq("id", keyword_id);

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
