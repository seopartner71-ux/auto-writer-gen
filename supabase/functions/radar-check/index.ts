import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Models to check via OpenRouter
const ALL_AI_MODELS = [
  { key: "gemini_flash", model: "google/gemini-2.5-flash", label: "Gemini Flash" },
  { key: "chatgpt", model: "openai/gpt-4.1-nano", label: "ChatGPT" },
  { key: "perplexity", model: "perplexity/sonar", label: "Perplexity" },
  { key: "claude", model: "anthropic/claude-sonnet-4", label: "Claude" },
];

interface CheckResult {
  model: string;
  status: "captured" | "displaced" | "opportunity";
  brand_mentioned: boolean;
  domain_linked: boolean;
  competitor_domains: string[];
  ai_response_text: string;
  matched_snippets: string[];
}

async function saveRadarResult(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: {
    user_id: string;
    keyword_id: string;
    model: string;
    status: CheckResult["status"];
    brand_mentioned: boolean;
    domain_linked: boolean;
    competitor_domains: string[];
    ai_response_text: string;
    matched_snippets: string[];
    checked_at: string;
  },
) {
  const { error } = await supabaseAdmin.from("radar_results").insert(payload);
  if (error) {
    console.error(`Failed to save radar result for ${payload.model}:`, error);
  }
}

function extractDomains(text: string): string[] {
  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  const domains = new Set<string>();
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    domains.add(match[1].toLowerCase());
  }
  return Array.from(domains);
}

function extractCompetitorBrands(text: string, ownBrand: string, ownDomain: string): string[] {
  // Extract brand/company names mentioned as alternatives or competitors
  const brands = new Set<string>();
  const lower = text.toLowerCase();
  const ownLower = ownBrand.toLowerCase();
  const ownDomainBase = ownDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.[a-z]{2,}$/, "");
  
  // Look for domain-like patterns (word.tld)
  const domainPattern = /\b([a-zA-Z0-9][-a-zA-Z0-9]*\.(?:ru|com|net|org|io|co|de|fr|uk|pro|shop|store|online|site|info|biz))\b/gi;
  let m;
  while ((m = domainPattern.exec(text)) !== null) {
    const d = m[1].toLowerCase();
    if (!d.includes(ownDomainBase) && !d.includes(ownLower)) {
      brands.add(d);
    }
  }
  
  // Look for competitor section patterns
  const competitorPatterns = [
    /(?:конкурент|альтернатив|аналог|также|другие бренды|другие производител)[а-яё]*[:\s]+([^\n.]+)/gi,
    /(?:competitor|alternative|similar|also|other brands)[s]?[:\s]+([^\n.]+)/gi,
  ];
  for (const pattern of competitorPatterns) {
    let pm;
    while ((pm = pattern.exec(text)) !== null) {
      const segment = pm[1];
      // Extract capitalized words/brands from the segment
      const brandNames = segment.match(/[A-ZА-Я][a-zа-яё]+(?:\s[A-ZА-Я][a-zа-яё]+)*/g) || [];
      for (const name of brandNames) {
        const nl = name.toLowerCase();
        if (nl !== ownLower && nl !== ownDomainBase && nl.length > 2) {
          brands.add(name);
        }
      }
    }
  }

  // Extract any capitalized brand-like names mentioned near product context
  const brandLike = text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) || [];
  const productKeywords = ["гель", "стир", "средств", "порош", "бренд", "производ", "product", "brand", "detergent", "gel"];
  for (const name of brandLike) {
    const nl = name.toLowerCase();
    if (nl === ownLower || nl === ownDomainBase || nl.length < 3) continue;
    // Check if this brand appears near product context
    const idx = lower.indexOf(nl);
    if (idx >= 0) {
      const context = lower.slice(Math.max(0, idx - 100), idx + nl.length + 100);
      if (productKeywords.some(pk => context.includes(pk))) {
        brands.add(name);
      }
    }
  }
  
  // Filter out common non-brand words
  const stopWords = new Set(["the", "for", "and", "with", "this", "that", "from", "are", "was", "has", "have", "can", "will", "not", "all", "also", "может", "если", "при", "для", "или", "что", "как", "это", "все"]);
  return Array.from(brands).filter(b => !stopWords.has(b.toLowerCase())).slice(0, 15);
}

function generateBrandVariants(brandName: string, domain: string): string[] {
  const variants = new Set<string>();
  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  
  // Original brand name
  variants.add(brandName.toLowerCase());
  
  // Domain without TLD (e.g. "revacare.ru" -> "revacare")
  const domainBase = cleanDomain.replace(/\.[a-z]{2,}$/, "");
  variants.add(domainBase);
  
  // Split camelCase/domain into words: "revacare" -> "reva care"
  const withSpaces = domainBase.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (withSpaces !== domainBase) variants.add(withSpaces);
  
  // Try common splits: "revacare" -> try splitting at each position
  if (domainBase.length >= 4 && !domainBase.includes(" ")) {
    for (let i = 2; i <= domainBase.length - 2; i++) {
      const candidate = domainBase.slice(0, i) + " " + domainBase.slice(i);
      variants.add(candidate);
    }
  }
  
  // Brand with/without hyphens and spaces
  variants.add(brandName.toLowerCase().replace(/[-\s]/g, ""));
  variants.add(brandName.toLowerCase().replace(/-/g, " "));
  
  return Array.from(variants).filter(v => v.length >= 3);
}

function checkBrandMention(text: string, brandName: string, domain: string, dataNuggets: string[]): {
  brand_mentioned: boolean;
  domain_linked: boolean;
  matched_snippets: string[];
} {
  const lower = text.toLowerCase();
  const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  
  // Generate all brand name variants to check
  const brandVariants = generateBrandVariants(brandName, domain);
  
  const brand_mentioned = brandVariants.some(v => lower.includes(v));
  const domain_linked = lower.includes(cleanDomain);

  const matched_snippets: string[] = [];

  // Find sentences mentioning any brand variant
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase();
    if (brandVariants.some(v => sLower.includes(v)) || sLower.includes(cleanDomain)) {
      matched_snippets.push(sentence.trim());
    }
  }

  // Check data nuggets
  for (const nugget of dataNuggets) {
    if (nugget && lower.includes(nugget.toLowerCase().slice(0, 50))) {
      matched_snippets.push(`[Data Nugget] ${nugget}`);
    }
  }

  return { brand_mentioned, domain_linked, matched_snippets };
}

function determineStatus(brand_mentioned: boolean, domain_linked: boolean, competitor_domains: string[]): "captured" | "displaced" | "opportunity" {
  if (brand_mentioned || domain_linked) return "captured";
  if (competitor_domains.length > 0) return "displaced";
  return "opportunity";
}

async function queryAIModel(
  apiKey: string,
  model: string,
  keyword: string,
  brandName: string,
): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: keyword,
        },
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("No auth token");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get OpenRouter key from DB first, then fallback to env
    const { data: orKey } = await supabaseAdmin.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");
 
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    // Check PRO plan
    const { data: profile } = await supabaseUser.from("profiles").select("plan").eq("id", user.id).single();
    if (profile?.plan !== "pro") {
      return new Response(
        JSON.stringify({ error: "AI Radar доступен только на тарифе PRO" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { keyword_id, project_id } = body;

    if (!keyword_id) throw new Error("keyword_id is required");

    // Get project
    const { data: project } = await supabaseUser
      .from("radar_projects")
      .select("*")
      .eq("id", project_id)
      .single();
    if (!project) throw new Error("Project not found");

    // Get keyword
    const { data: kw } = await supabaseUser
      .from("radar_keywords")
      .select("*")
      .eq("id", keyword_id)
      .single();
    if (!kw) throw new Error("Keyword not found");

    const results: CheckResult[] = [];
    const checkedAt = new Date().toISOString();

    // Query each AI model
    for (const aiModel of ALL_AI_MODELS) {
      try {
        const responseText = await queryAIModel(
          OPENROUTER_API_KEY,
          aiModel.model,
          kw.keyword,
          project.brand_name,
        );

        const allDomains = extractDomains(responseText);
        const projectDomain = project.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
        const competitorDomains = allDomains.filter(d => !d.includes(projectDomain));

        const { brand_mentioned, domain_linked, matched_snippets } = checkBrandMention(
          responseText,
          project.brand_name,
          project.domain,
          project.data_nuggets || [],
        );

        const status = determineStatus(brand_mentioned, domain_linked, competitorDomains);

        results.push({
          model: aiModel.key,
          status,
          brand_mentioned,
          domain_linked,
          competitor_domains: competitorDomains.slice(0, 10),
          ai_response_text: responseText.slice(0, 5000),
          matched_snippets: matched_snippets.slice(0, 5),
        });

        await saveRadarResult(supabaseAdmin, {
          user_id: user.id,
          keyword_id,
          model: aiModel.key,
          status,
          brand_mentioned,
          domain_linked,
          competitor_domains: competitorDomains.slice(0, 10),
          ai_response_text: responseText.slice(0, 5000),
          matched_snippets: matched_snippets.slice(0, 5),
          checked_at: checkedAt,
        });
      } catch (e) {
        console.error(`Error checking ${aiModel.key}:`, e);
        const errorResult = {
          model: aiModel.key,
          status: "opportunity",
          brand_mentioned: false,
          domain_linked: false,
          competitor_domains: [],
          ai_response_text: `Error: ${e instanceof Error ? e.message : "Unknown"}`,
          matched_snippets: [],
        } satisfies CheckResult;

        results.push(errorResult);

        await saveRadarResult(supabaseAdmin, {
          user_id: user.id,
          keyword_id,
          model: aiModel.key,
          status: errorResult.status,
          brand_mentioned: errorResult.brand_mentioned,
          domain_linked: errorResult.domain_linked,
          competitor_domains: errorResult.competitor_domains,
          ai_response_text: errorResult.ai_response_text,
          matched_snippets: errorResult.matched_snippets,
          checked_at: checkedAt,
        });
      }
    }

    // Update last_checked_at
    await supabaseAdmin
      .from("radar_keywords")
      .update({ last_checked_at: checkedAt })
      .eq("id", keyword_id);

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
