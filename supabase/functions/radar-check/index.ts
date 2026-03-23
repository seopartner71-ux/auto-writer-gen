import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Models to check via Lovable AI Gateway
const AI_MODELS = [
  { key: "gemini", model: "google/gemini-2.5-flash", label: "Gemini" },
  { key: "chatgpt", model: "openai/gpt-5-nano", label: "ChatGPT" },
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

function checkBrandMention(text: string, brandName: string, domain: string, dataNuggets: string[]): {
  brand_mentioned: boolean;
  domain_linked: boolean;
  matched_snippets: string[];
} {
  const lower = text.toLowerCase();
  const brandLower = brandName.toLowerCase();
  const domainLower = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");

  const brand_mentioned = lower.includes(brandLower);
  const domain_linked = lower.includes(domainLower);

  const matched_snippets: string[] = [];

  // Find sentences mentioning the brand
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase();
    if (sLower.includes(brandLower) || sLower.includes(domainLower)) {
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
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    for (const aiModel of AI_MODELS) {
      try {
        const responseText = await queryAIModel(
          LOVABLE_API_KEY,
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
