import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ParsedPage {
  url: string;
  position: number;
  title_tag: string;
  meta_description: string;
  headings: { level: string; text: string }[];
  word_count: number;
  char_count: number;
  paragraph_count: number;
  avg_paragraph_length: number;
  img_count: number;
  video_presence: boolean;
  keyword_density: number;
  top_phrases: { phrase: string; count: number }[];
}

function parseHTML(html: string, seedKeyword: string): Omit<ParsedPage, "url" | "position"> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    return {
      title_tag: "", meta_description: "", headings: [], word_count: 0, char_count: 0,
      paragraph_count: 0, avg_paragraph_length: 0, img_count: 0, video_presence: false,
      keyword_density: 0, top_phrases: [],
    };
  }

  // Title
  const titleEl = doc.querySelector("title");
  const title_tag = titleEl?.textContent?.trim() || "";

  // Meta description
  const metaEl = doc.querySelector('meta[name="description"]');
  const meta_description = metaEl?.getAttribute("content")?.trim() || "";

  // Headings hierarchy
  const headings: { level: string; text: string }[] = [];
  const headingEls = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
  for (let i = 0; i < headingEls.length; i++) {
    const el = headingEls[i];
    headings.push({
      level: el.tagName.toLowerCase(),
      text: el.textContent?.trim() || "",
    });
  }

  // Body text extraction
  // Remove script and style elements
  const scripts = doc.querySelectorAll("script, style, nav, header, footer, aside");
  for (let i = 0; i < scripts.length; i++) {
    scripts[i].remove();
  }

  const bodyEl = doc.querySelector("body");
  const bodyText = bodyEl?.textContent?.replace(/\s+/g, " ").trim() || "";

  // Word count & char count
  const words = bodyText.split(/\s+/).filter((w) => w.length > 0);
  const word_count = words.length;
  const char_count = bodyText.length;

  // Paragraphs
  const paragraphs = doc.querySelectorAll("p");
  const paragraph_count = paragraphs.length;
  let totalParaLen = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    totalParaLen += (paragraphs[i].textContent?.trim().split(/\s+/).length || 0);
  }
  const avg_paragraph_length = paragraph_count > 0 ? Math.round(totalParaLen / paragraph_count) : 0;

  // Images
  const img_count = doc.querySelectorAll("img").length;

  // Video presence
  const iframes = doc.querySelectorAll("iframe");
  let video_presence = false;
  for (let i = 0; i < iframes.length; i++) {
    const src = iframes[i].getAttribute("src") || "";
    if (/youtube|vimeo|dailymotion|rutube/i.test(src)) {
      video_presence = true;
      break;
    }
  }
  if (!video_presence) {
    video_presence = doc.querySelectorAll("video").length > 0;
  }

  // Keyword density
  const kwLower = seedKeyword.toLowerCase();
  const textLower = bodyText.toLowerCase();
  const kwOccurrences = textLower.split(kwLower).length - 1;
  const keyword_density = word_count > 0 ? Math.round((kwOccurrences / word_count) * 10000) / 100 : 0;

  // Top phrases (2-3 word n-grams)
  const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "and", "but", "or", "nor", "not", "so", "yet", "both", "either", "neither",
    "this", "that", "these", "those", "it", "its", "they", "them", "their", "we", "our",
    "i", "me", "my", "you", "your", "he", "she", "his", "her", "him",
    "what", "which", "who", "whom", "when", "where", "how", "why",
    "all", "each", "every", "some", "any", "no", "more", "most", "other", "than",
    "if", "then", "else", "about", "up", "out", "just", "also", "very", "much",
    // Russian stop words
    "и", "в", "не", "на", "с", "что", "как", "это", "а", "к", "по", "из", "за", "для",
    "но", "то", "же", "или", "он", "она", "они", "мы", "вы", "от", "до", "при", "его",
    "её", "их", "был", "была", "было", "были", "быть", "будет", "может", "так", "все",
    "уже", "ещё", "бы", "ли", "о", "у", "да", "нет", "если", "только",
  ]);

  const cleanWords = words
    .map((w) => w.toLowerCase().replace(/[^a-zа-яёА-ЯЁ0-9]/g, ""))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const phraseCounts: Record<string, number> = {};
  for (let i = 0; i < cleanWords.length - 1; i++) {
    const bi = `${cleanWords[i]} ${cleanWords[i + 1]}`;
    phraseCounts[bi] = (phraseCounts[bi] || 0) + 1;
    if (i < cleanWords.length - 2) {
      const tri = `${cleanWords[i]} ${cleanWords[i + 1]} ${cleanWords[i + 2]}`;
      phraseCounts[tri] = (phraseCounts[tri] || 0) + 1;
    }
  }

  const top_phrases = Object.entries(phraseCounts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([phrase, count]) => ({ phrase, count }));

  return {
    title_tag, meta_description, headings, word_count, char_count,
    paragraph_count, avg_paragraph_length, img_count, video_presence,
    keyword_density, top_phrases,
  };
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SEO-Analyzer/1.0)",
        "Accept": "text/html",
      },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub as string;
    if (!userId) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { keyword_id } = await req.json();
    if (!keyword_id) throw new Error("keyword_id is required");

    // Get keyword
    const { data: kw, error: kwErr } = await supabase
      .from("keywords")
      .select("*")
      .eq("id", keyword_id)
      .single();
    if (kwErr || !kw) throw new Error("Keyword not found");

    // Get SERP results
    const { data: serpResults } = await supabase
      .from("serp_results")
      .select("*")
      .eq("keyword_id", keyword_id)
      .order("position", { ascending: true });

    if (!serpResults || serpResults.length === 0) {
      throw new Error("No SERP results found. Run Smart Research first.");
    }

    // Parse each competitor page
    const parsedPages: ParsedPage[] = [];
    const failedUrls: string[] = [];

    for (const sr of serpResults) {
      if (!sr.url) continue;
      console.log(`Fetching: ${sr.url}`);
      const html = await fetchPage(sr.url);
      if (!html) {
        failedUrls.push(sr.url);
        continue;
      }

      const parsed = parseHTML(html, kw.seed_keyword);
      const pageData: ParsedPage = {
        url: sr.url,
        position: sr.position || 0,
        ...parsed,
      };
      parsedPages.push(pageData);

      // Save per-competitor deep analysis to serp_results
      await supabaseAdmin
        .from("serp_results")
        .update({
          deep_analysis: {
            title_tag: parsed.title_tag,
            meta_description: parsed.meta_description,
            headings: parsed.headings,
            char_count: parsed.char_count,
            paragraph_count: parsed.paragraph_count,
            avg_paragraph_length: parsed.avg_paragraph_length,
            img_count: parsed.img_count,
            video_presence: parsed.video_presence,
            keyword_density: parsed.keyword_density,
            top_phrases: parsed.top_phrases,
          },
          word_count: parsed.word_count,
          headings: { hierarchy: parsed.headings },
        })
        .eq("id", sr.id);
    }

    if (parsedPages.length === 0) {
      throw new Error("Could not fetch any competitor pages");
    }

    // Calculate aggregated benchmark
    const wordCounts = parsedPages.map((p) => p.word_count).sort((a, b) => a - b);
    const imgCounts = parsedPages.map((p) => p.img_count).sort((a, b) => a - b);
    const h2Counts = parsedPages.map((p) => p.headings.filter((h) => h.level === "h2").length).sort((a, b) => a - b);
    const h3Counts = parsedPages.map((p) => p.headings.filter((h) => h.level === "h3").length).sort((a, b) => a - b);
    const paraCounts = parsedPages.map((p) => p.paragraph_count).sort((a, b) => a - b);
    const densities = parsedPages.map((p) => p.keyword_density).sort((a, b) => a - b);
    const videoCount = parsedPages.filter((p) => p.video_presence).length;

    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    };

    const benchmark = {
      total_parsed: parsedPages.length,
      failed_urls: failedUrls,
      median_word_count: median(wordCounts),
      median_img_count: median(imgCounts),
      median_h2_count: median(h2Counts),
      median_h3_count: median(h3Counts),
      median_paragraph_count: median(paraCounts),
      median_keyword_density: Math.round(median(densities) * 100) / 100,
      video_percentage: Math.round((videoCount / parsedPages.length) * 100),
    };

    // Aggregate all phrases across competitors for TF-IDF style analysis
    const globalPhrases: Record<string, { total: number; docs: number }> = {};
    for (const page of parsedPages) {
      const seen = new Set<string>();
      for (const { phrase, count } of page.top_phrases) {
        if (!globalPhrases[phrase]) globalPhrases[phrase] = { total: 0, docs: 0 };
        globalPhrases[phrase].total += count;
        if (!seen.has(phrase)) {
          globalPhrases[phrase].docs += 1;
          seen.add(phrase);
        }
      }
    }

    // TF-IDF: phrases common across many docs but with high frequency
    const N = parsedPages.length;
    const tfidfPhrases = Object.entries(globalPhrases)
      .map(([phrase, { total, docs }]) => ({
        phrase,
        total,
        docs,
        tfidf: Math.round(total * Math.log(N / docs) * 100) / 100,
        commonality: Math.round((docs / N) * 100),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);

    // Use AI for entity extraction
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    const competitorTexts = parsedPages
      .slice(0, 5)
      .map((p) => {
        const headingText = p.headings.map((h) => `${h.level}: ${h.text}`).join("\n");
        return `--- Competitor #${p.position} (${p.url}) ---\nTitle: ${p.title_tag}\nHeadings:\n${headingText}\nTop phrases: ${p.top_phrases.slice(0, 15).map((ph) => ph.phrase).join(", ")}`;
      })
      .join("\n\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `You are an expert SEO entity analyst. Extract named entities and key concepts from competitor content that are essential for topical relevance. Return structured data via the provided tool. Write ALL output in the same language as the keyword.`,
          },
          {
            role: "user",
            content: `Keyword: "${kw.seed_keyword}"

Competitor data:
${competitorTexts}

Top phrases across all competitors (by frequency):
${tfidfPhrases.slice(0, 30).map((p) => `"${p.phrase}" (freq: ${p.total}, in ${p.docs}/${N} pages)`).join("\n")}

TASK: Extract entities that Google associates with this topic. Categorize them by type. Also identify the most important LSI phrases that should appear in a well-optimized article.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_entity_analysis",
            description: "Return entity and concept analysis",
            parameters: {
              type: "object",
              properties: {
                entities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string", enum: ["brand", "person", "location", "concept", "product", "organization", "event", "metric"] },
                      importance: { type: "string", enum: ["critical", "high", "medium"] },
                      competitors_using: { type: "number", description: "How many competitors mention this" },
                    },
                    required: ["name", "type", "importance"],
                  },
                },
                must_use_phrases: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      phrase: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["phrase", "reason"],
                  },
                  description: "Essential phrases/terms that must appear in the article",
                },
              },
              required: ["entities", "must_use_phrases"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_entity_analysis" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let entityAnalysis;
    if (toolCall?.function?.arguments) {
      entityAnalysis = JSON.parse(toolCall.function.arguments);
    } else {
      const content = aiData.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) entityAnalysis = JSON.parse(jsonMatch[0]);
      else entityAnalysis = { entities: [], must_use_phrases: [] };
    }

    // Find the best competitor for heading tree (highest position with most headings)
    const bestCompetitor = parsedPages.reduce((best, curr) =>
      curr.headings.length > best.headings.length ? curr : best
    );

    // Log usage
    const tokensUsed = aiData.usage?.total_tokens || 0;
    await supabaseAdmin.from("usage_logs").insert({
      user_id: userId,
      action: "deep_parse_competitors",
      model_used: model,
      tokens_used: tokensUsed,
    });

    const result = {
      benchmark,
      entities: entityAnalysis.entities || [],
      must_use_phrases: entityAnalysis.must_use_phrases || [],
      tfidf_phrases: tfidfPhrases,
      best_competitor_headings: {
        url: bestCompetitor.url,
        position: bestCompetitor.position,
        title: bestCompetitor.title_tag,
        headings: bestCompetitor.headings,
      },
      per_competitor: parsedPages.map((p) => ({
        url: p.url,
        position: p.position,
        word_count: p.word_count,
        img_count: p.img_count,
        h2_count: p.headings.filter((h) => h.level === "h2").length,
        h3_count: p.headings.filter((h) => h.level === "h3").length,
        video_presence: p.video_presence,
        keyword_density: p.keyword_density,
        title_tag: p.title_tag,
        meta_description: p.meta_description,
      })),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("deep-parse-competitors error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
