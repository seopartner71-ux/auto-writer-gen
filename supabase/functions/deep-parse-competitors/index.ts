import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Types ──────────────────────────────────────────────────────────────
interface CompetitorAnalysis {
  url: string;
  position: number;
  structure: {
    h1: string;
    h_tags: { level: number; text: string }[];
    word_count: number;
    char_count: number;
    paragraph_count: number;
    avg_paragraph_length: number;
  };
  content: {
    keywords: { word: string; density: number; tf_idf: number }[];
    lsi_phrases: string[];
    entities: { name: string; type: string; importance: number }[];
  };
  media: {
    images_count: number;
    has_video: boolean;
    video_links: string[];
  };
  seo: {
    title: string;
    description: string;
    main_keyword_density: number;
  };
  top_phrases: { phrase: string; count: number }[];
}

// ── Stop words ─────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","can","shall",
  "to","of","in","for","on","with","at","by","from","as","into","through",
  "and","but","or","nor","not","so","yet","both","either","neither",
  "this","that","these","those","it","its","they","them","their","we","our",
  "i","me","my","you","your","he","she","his","her","him",
  "what","which","who","whom","when","where","how","why",
  "all","each","every","some","any","no","more","most","other","than",
  "if","then","else","about","up","out","just","also","very","much","only",
  // Russian
  "и","в","не","на","с","что","как","это","а","к","по","из","за","для",
  "но","то","же","или","он","она","они","мы","вы","от","до","при","его",
  "её","их","был","была","было","были","быть","будет","может","так","все",
  "уже","ещё","бы","ли","о","у","да","нет","если","только","ещё","тоже",
  "более","менее","очень","этот","эта","эти","свой","свои","него","неё",
]);

// ── Boilerplate removal & main content extraction ──────────────────────
function extractMainContent(doc: any): any {
  // Step 1: Try <article> or <main> first
  const article = doc.querySelector("article") || doc.querySelector("main") || doc.querySelector('[role="main"]');
  if (article) return article;

  // Step 2: Try common content selectors
  const contentSelectors = [
    ".post-content", ".entry-content", ".article-content", ".content-area",
    "#content", "#main-content", ".main-content", ".post-body",
    '[itemprop="articleBody"]', ".td-post-content", ".single-content",
  ];
  for (const sel of contentSelectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }

  // Step 3: Fallback to body with boilerplate removed
  return null;
}

function removeBoilerplate(doc: any): void {
  const removeSelectors = [
    "script", "style", "noscript", "svg", "iframe:not([src*='youtube']):not([src*='vimeo'])",
    "nav", "header", "footer", "aside",
    ".sidebar", ".widget", ".ad", ".advertisement", ".banner",
    ".cookie", ".popup", ".modal", ".menu", ".breadcrumb",
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    ".social-share", ".share-buttons", ".related-posts", ".comments",
    ".author-bio", "#comments", ".newsletter", ".signup-form",
  ];
  for (const sel of removeSelectors) {
    try {
      const els = doc.querySelectorAll(sel);
      for (let i = 0; i < els.length; i++) {
        els[i].remove();
      }
    } catch { /* ignore invalid selectors */ }
  }
}

// ── HTML Parsing ───────────────────────────────────────────────────────
function parseHTML(html: string, seedKeyword: string): Omit<CompetitorAnalysis, "url" | "position"> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    return emptyAnalysis();
  }

  // SEO: title + meta before we modify DOM
  const titleEl = doc.querySelector("title");
  const seoTitle = titleEl?.textContent?.trim() || "";
  const metaEl = doc.querySelector('meta[name="description"]');
  const seoDescription = metaEl?.getAttribute("content")?.trim() || "";

  // Media counts (before boilerplate removal to count all images)
  const allImages = doc.querySelectorAll("img");
  const images_count = allImages.length;

  // Video detection
  const videoLinks: string[] = [];
  const iframes = doc.querySelectorAll("iframe");
  for (let i = 0; i < iframes.length; i++) {
    const src = iframes[i].getAttribute("src") || "";
    if (/youtube|vimeo|dailymotion|rutube|wistia/i.test(src)) {
      videoLinks.push(src);
    }
  }
  const hasVideoTag = doc.querySelectorAll("video").length > 0;
  const has_video = videoLinks.length > 0 || hasVideoTag;

  // Remove boilerplate
  removeBoilerplate(doc);

  // Try to extract main content area
  const mainContent = extractMainContent(doc);
  const contentRoot = mainContent || doc.querySelector("body");
  if (!contentRoot) return emptyAnalysis();

  // Headings hierarchy
  const headingEls = contentRoot.querySelectorAll("h1, h2, h3, h4, h5, h6");
  let h1Text = "";
  const h_tags: { level: number; text: string }[] = [];
  for (let i = 0; i < headingEls.length; i++) {
    const el = headingEls[i];
    const level = parseInt(el.tagName.charAt(1));
    const text = el.textContent?.trim() || "";
    if (level === 1 && !h1Text) h1Text = text;
    h_tags.push({ level, text });
  }

  // Text extraction
  const bodyText = contentRoot.textContent?.replace(/\s+/g, " ").trim() || "";
  const words = bodyText.split(/\s+/).filter((w: string) => w.length > 0);
  const word_count = words.length;
  const char_count = bodyText.length;

  // Paragraphs
  const paragraphs = contentRoot.querySelectorAll("p");
  const paragraph_count = paragraphs.length;
  let totalParaWords = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    totalParaWords += (paragraphs[i].textContent?.trim().split(/\s+/).length || 0);
  }
  const avg_paragraph_length = paragraph_count > 0 ? Math.round(totalParaWords / paragraph_count) : 0;

  // Keyword density
  const kwLower = seedKeyword.toLowerCase();
  const textLower = bodyText.toLowerCase();
  const kwRegex = new RegExp(kwLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const kwMatches = textLower.match(kwRegex);
  const kwOccurrences = kwMatches ? kwMatches.length : 0;
  const main_keyword_density = word_count > 0 ? Math.round((kwOccurrences / word_count) * 10000) / 100 : 0;

  // N-gram analysis (cleaned words → bigrams & trigrams)
  const cleanWords = words
    .map((w: string) => w.toLowerCase().replace(/[^a-zа-яёА-ЯЁ0-9-]/g, ""))
    .filter((w: string) => w.length > 2 && !STOP_WORDS.has(w));

  // Single word frequency for keyword density analysis
  const wordFreq: Record<string, number> = {};
  for (const w of cleanWords) {
    wordFreq[w] = (wordFreq[w] || 0) + 1;
  }

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

  // Top single keywords with density
  const topKeywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([word, count]) => ({
      word,
      density: Math.round((count / word_count) * 10000) / 100,
      tf_idf: 0, // calculated later across all docs
    }));

  return {
    structure: { h1: h1Text, h_tags, word_count, char_count, paragraph_count, avg_paragraph_length },
    content: { keywords: topKeywords, lsi_phrases: [], entities: [] },
    media: { images_count, has_video, video_links: videoLinks },
    seo: { title: seoTitle, description: seoDescription, main_keyword_density },
    top_phrases,
  };
}

function emptyAnalysis(): Omit<CompetitorAnalysis, "url" | "position"> {
  return {
    structure: { h1: "", h_tags: [], word_count: 0, char_count: 0, paragraph_count: 0, avg_paragraph_length: 0 },
    content: { keywords: [], lsi_phrases: [], entities: [] },
    media: { images_count: 0, has_video: false, video_links: [] },
    seo: { title: "", description: "", main_keyword_density: 0 },
    top_phrases: [],
  };
}

// ── Fetch with error handling ──────────────────────────────────────────
async function fetchPage(url: string): Promise<{ html: string | null; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // reduced from 20s to 8s
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (resp.status === 403 || resp.status === 503) {
      return { html: null, error: `blocked:${resp.status}` };
    }
    if (!resp.ok) return { html: null, error: `http:${resp.status}` };

    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      return { html: null, error: "not-html" };
    }

    const html = await resp.text();
    if (html.includes("cf-browser-verification") || html.includes("challenge-platform")) {
      return { html: null, error: "cloudflare" };
    }
    return { html };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return { html: null, error: msg.includes("abort") ? "timeout" : msg };
  }
}

// ── TF-IDF calculation across documents ────────────────────────────────
function calculateTfIdf(pages: CompetitorAnalysis[]): {
  tfidfPhrases: { phrase: string; total: number; docs: number; tfidf: number; commonality: number }[];
  lsiSuccessPhrases: string[];
} {
  const N = pages.length;
  
  // Phrase-level TF-IDF
  const globalPhrases: Record<string, { total: number; docs: number }> = {};
  for (const page of pages) {
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

  const tfidfPhrases = Object.entries(globalPhrases)
    .map(([phrase, { total, docs }]) => ({
      phrase,
      total,
      docs,
      tfidf: docs < N ? Math.round(total * Math.log(N / docs) * 100) / 100 : Math.round(total * 0.1 * 100) / 100,
      commonality: Math.round((docs / N) * 100),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 50);

  // Word-level TF-IDF
  const globalWords: Record<string, { total: number; docs: number }> = {};
  for (const page of pages) {
    const seen = new Set<string>();
    for (const { word, density } of page.content.keywords) {
      if (!globalWords[word]) globalWords[word] = { total: 0, docs: 0 };
      globalWords[word].total += density;
      if (!seen.has(word)) {
        globalWords[word].docs += 1;
        seen.add(word);
      }
    }
  }

  // Update TF-IDF scores on per-page keywords
  for (const page of pages) {
    for (const kw of page.content.keywords) {
      const global = globalWords[kw.word];
      if (global && global.docs < N) {
        kw.tf_idf = Math.round(kw.density * Math.log(N / global.docs) * 100) / 100;
      }
    }
  }

  // LSI Success Phrases: phrases in TOP-3 but absent from rest
  const top3 = pages.filter((p) => p.position <= 3);
  const rest = pages.filter((p) => p.position > 3);

  const top3Phrases = new Set<string>();
  for (const page of top3) {
    for (const { phrase } of page.top_phrases) {
      top3Phrases.add(phrase);
    }
  }
  const restPhrases = new Set<string>();
  for (const page of rest) {
    for (const { phrase } of page.top_phrases) {
      restPhrases.add(phrase);
    }
  }

  const lsiSuccessPhrases = [...top3Phrases]
    .filter((p) => !restPhrases.has(p))
    .slice(0, 20);

  return { tfidfPhrases, lsiSuccessPhrases };
}

// ── Main handler ───────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin0 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: orKey } = await supabaseAdmin0.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");

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

    const { keyword_id, force_refresh } = await req.json();
    if (!keyword_id) throw new Error("keyword_id is required");

    // ── Cache check ──
    if (!force_refresh) {
      const { data: existingSerp } = await supabase
        .from("serp_results")
        .select("deep_analysis")
        .eq("keyword_id", keyword_id)
        .not("deep_analysis", "is", null)
        .limit(1);
      
      if (existingSerp && existingSerp.length > 0 && existingSerp[0].deep_analysis) {
        // Check if cached analysis has the new format
        const cached = existingSerp[0].deep_analysis as any;
        if (cached._cached_result) {
          console.log("Returning cached deep analysis");
          return new Response(JSON.stringify(cached._cached_result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

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

    // ── Parse each competitor page (parallel, max 7) ──
    const parsedPages: CompetitorAnalysis[] = [];
    const failedUrls: { url: string; reason: string }[] = [];

    const validSerps = serpResults.filter((sr: any) => sr.url).slice(0, 7);
    console.log(`Fetching ${validSerps.length} pages in parallel...`);

    const fetchResults = await Promise.allSettled(
      validSerps.map(async (sr: any) => {
        console.log(`Fetching: ${sr.url}`);
        const { html, error } = await fetchPage(sr.url);
        if (!html) return { sr, error: error || "unknown", html: null };
        return { sr, html, error: null };
      })
    );

    for (const result of fetchResults) {
      if (result.status === "rejected") continue;
      const { sr, html, error } = result.value;
      if (!html) {
        failedUrls.push({ url: sr.url, reason: error || "unknown" });
        continue;
      }
      const parsed = parseHTML(html, kw.seed_keyword);
      parsedPages.push({ url: sr.url, position: sr.position || 0, ...parsed });
    }
    console.log(`Parsed ${parsedPages.length} pages, ${failedUrls.length} failed`);

    if (parsedPages.length === 0) {
      throw new Error(`Could not fetch any competitor pages. Errors: ${failedUrls.map((f) => `${f.url}(${f.reason})`).join(", ")}`);
    }

    // ── TF-IDF & LSI analysis ──
    const { tfidfPhrases, lsiSuccessPhrases } = calculateTfIdf(parsedPages);

    // Update LSI phrases on each page
    for (const page of parsedPages) {
      page.content.lsi_phrases = lsiSuccessPhrases;
    }

    // ── Benchmark calculation ──
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      if (sorted.length === 0) return 0;
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };

    const wordCounts = parsedPages.map((p) => p.structure.word_count);
    const imgCounts = parsedPages.map((p) => p.media.images_count);
    const h2Counts = parsedPages.map((p) => p.structure.h_tags.filter((h) => h.level === 2).length);
    const h3Counts = parsedPages.map((p) => p.structure.h_tags.filter((h) => h.level === 3).length);
    const paraCounts = parsedPages.map((p) => p.structure.paragraph_count);
    const densities = parsedPages.map((p) => p.seo.main_keyword_density);
    const videoCount = parsedPages.filter((p) => p.media.has_video).length;

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
      target_word_count: Math.round(median(wordCounts) * 1.1), // +10%
      target_img_count: Math.max(median(imgCounts), 3),
      target_h2_count: Math.max(median(h2Counts), 5),
    };

    // ── AI Entity Extraction ──
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "researcher")
      .single();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    const competitorTexts = parsedPages
      .slice(0, 5)
      .map((p) => {
        const headingText = p.structure.h_tags.map((h) => `${"  ".repeat(h.level - 1)}H${h.level}: ${h.text}`).join("\n");
        const topKw = p.content.keywords.slice(0, 10).map((k) => `${k.word}(${k.density}%)`).join(", ");
        return `--- #${p.position} ${p.url} (${p.structure.word_count} words, ${p.media.images_count} imgs) ---\nTitle: ${p.seo.title}\nH1: ${p.structure.h1}\nHeadings:\n${headingText}\nTop keywords: ${topKw}`;
      })
      .join("\n\n");

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `You are an expert SEO entity analyst specializing in E-E-A-T and topical authority. Analyze competitor content to extract entities Google associates with this topic, and LSI phrases critical for ranking. Return data via the provided tool. Write ALL output in the same language as the keyword.`,
          },
          {
            role: "user",
            content: `Keyword: "${kw.seed_keyword}"

Competitor analysis data:
${competitorTexts}

TF-IDF top phrases (across ${parsedPages.length} competitors):
${tfidfPhrases.slice(0, 25).map((p) => `"${p.phrase}" (freq:${p.total}, in ${p.docs}/${parsedPages.length} docs, commonality:${p.commonality}%)`).join("\n")}

LSI Success Phrases (found in TOP-3 only):
${lsiSuccessPhrases.join(", ") || "None identified"}

TASK: 
1. Extract the 15-20 most important thematic entities that Google associates with "${kw.seed_keyword}". Rate their importance 1-10.
2. Identify must-use LSI phrases for a well-optimized article.
3. For each entity, specify how many competitors mention it.`,
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
                      type: { type: "string", enum: ["brand", "person", "location", "concept", "product", "organization", "event", "metric", "technology", "term"] },
                      importance: { type: "number", description: "1-10 scale" },
                      competitors_using: { type: "number" },
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
    let entityAnalysis: { entities: any[]; must_use_phrases: any[] };
    if (toolCall?.function?.arguments) {
      entityAnalysis = JSON.parse(toolCall.function.arguments);
    } else {
      const content = aiData.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      entityAnalysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { entities: [], must_use_phrases: [] };
    }

    // Merge AI entities into page content
    for (const page of parsedPages) {
      page.content.entities = (entityAnalysis.entities || []).map((e: any) => ({
        name: e.name,
        type: e.type,
        importance: e.importance,
      }));
    }

    // Best competitor for heading tree
    const bestCompetitor = parsedPages.reduce((best, curr) =>
      curr.structure.h_tags.length > best.structure.h_tags.length ? curr : best
    );

    // ── Build result ──
    const result = {
      benchmark,
      entities: entityAnalysis.entities || [],
      must_use_phrases: entityAnalysis.must_use_phrases || [],
      tfidf_phrases: tfidfPhrases,
      lsi_success_phrases: lsiSuccessPhrases,
      best_competitor_headings: {
        url: bestCompetitor.url,
        position: bestCompetitor.position,
        title: bestCompetitor.seo.title,
        h1: bestCompetitor.structure.h1,
        headings: bestCompetitor.structure.h_tags,
      },
      per_competitor: parsedPages.map((p) => ({
        url: p.url,
        position: p.position,
        word_count: p.structure.word_count,
        img_count: p.media.images_count,
        h2_count: p.structure.h_tags.filter((h) => h.level === 2).length,
        h3_count: p.structure.h_tags.filter((h) => h.level === 3).length,
        video_presence: p.media.has_video,
        keyword_density: p.seo.main_keyword_density,
        title_tag: p.seo.title,
        meta_description: p.seo.description,
      })),
    };

    // ── Save cached result on first serp entry ──
    if (serpResults.length > 0) {
      await supabaseAdmin
        .from("serp_results")
        .update({
          deep_analysis: { _cached_result: result, parsed_at: new Date().toISOString() },
        })
        .eq("id", serpResults[0].id);
    }

    // Log usage
    const tokensUsed = aiData.usage?.total_tokens || 0;
    await supabaseAdmin.from("usage_logs").insert({
      user_id: userId,
      action: "deep_parse_competitors",
      model_used: model,
      tokens_used: tokensUsed,
    });

    console.log(`Deep parse complete: ${parsedPages.length} pages, ${(entityAnalysis.entities || []).length} entities, score ready`);

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
