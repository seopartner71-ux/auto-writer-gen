// Smart interlinking second pass for a Site Factory project.
//
// Body: { project_id: string, redeploy?: boolean }
//
// Pipeline:
// 1. Loads all completed/published articles of the project.
// 2. Uses Gemini 2.5 Flash Lite (via OpenRouter) to extract topics + entities
//    + article type for each article. Cheap (~$0.001/article).
// 3. Builds a relevance matrix (keyword overlap weight 3, topics 2, entities 1).
// 4. For each article, picks top-2 most relevant peers and injects ONE
//    contextual <a href> per peer (max 2 outbound). The anchor is a natural
//    2-4 word phrase already present in the body. Anchor TYPE is distributed
//    50% keyword-rich / 30% brand-or-url / 20% generic across the whole site
//    to avoid over-optimization (Penguin-safe profile). Each donor page may
//    contain at most ONE keyword-rich anchor.
// 5. Writes back articles.content. Optionally calls deploy-cloudflare-direct
//    so the static site picks up the new links and an updated sitemap lastmod.
//
// Constraints respected:
//   - max 2 outbound links per article
//   - never link to itself
//   - no duplicate links inside the same article
//   - links live ONLY inside <p>, never in the first or last <p>

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYSIS_MODEL = "google/gemini-2.5-flash-lite";

// Generic anchor pools — language-aware. Picked when distribution slot is "generic".
const GENERIC_ANCHORS_RU = [
  "читать подробнее", "по этой теме", "узнать больше", "подробнее здесь",
  "смотреть материал", "связанный материал", "дополнительно", "источник",
  "детали здесь", "по ссылке",
];
const GENERIC_ANCHORS_EN = [
  "read more", "learn more", "see details", "related guide",
  "more here", "full article", "source", "details here",
  "related post", "see this",
];

type AnchorType = "keyword" | "brand" | "generic";

// Deterministic hash → 0..99 bucket from the (donor, target) pair so the same
// pair always gets the same anchor type across reruns and the global mix tends
// toward the desired 50 / 30 / 20 distribution.
function pairHashBucket(a: string, b: string): number {
  const s = `${a}::${b}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 100;
}

function pickAnchorType(donorId: string, targetId: string): AnchorType {
  const b = pairHashBucket(donorId, targetId);
  if (b < 50) return "keyword";
  if (b < 80) return "brand";
  return "generic";
}

function isCyrillic(text: string): boolean {
  return /[а-яА-ЯёЁ]/.test(text);
}

// Build anchor candidates for a brand-style link: title head, domain, first
// keyword as a brand-ish noun. Tries to find one already present in donor text;
// if not, returns the title head as a fresh insertable phrase (the injector
// will skip it and the loop will try the next anchor type).
function brandAnchorCandidates(targetTitle: string, targetDomain: string): string[] {
  const out: string[] = [];
  const title = String(targetTitle || "").trim();
  if (title) {
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length >= 2) out.push(words.slice(0, 2).join(" "));
    if (words.length >= 3) out.push(words.slice(0, 3).join(" "));
    out.push(words[0]);
  }
  const host = String(targetDomain || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (host) {
    const brandPart = host.split(".")[0];
    if (brandPart && brandPart.length >= 3) out.push(brandPart);
  }
  return out.filter((s) => s && s.length >= 3);
}

function genericAnchorPool(donorText: string, targetText: string): string[] {
  const ru = isCyrillic(donorText) || isCyrillic(targetText);
  return ru ? GENERIC_ANCHORS_RU : GENERIC_ANCHORS_EN;
}

async function getOpenRouterKey(admin: any): Promise<string | null> {
  try {
    const { data } = await admin.from("api_keys").select("api_key")
      .eq("provider", "openrouter").eq("is_valid", true).limit(1).maybeSingle();
    if (data?.api_key) return data.api_key;
  } catch (_) { /* ignore */ }
  return Deno.env.get("OPENROUTER_API_KEY") || null;
}

interface ArticleRow {
  id: string;
  title: string | null;
  content: string | null;
  keywords: string[] | null;
  published_url: string | null;
}

interface AnalyzedArticle extends ArticleRow {
  topics: string[];
  entities: string[];
  type: string;
}

function stripHtml(html: string): string {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function analyzeArticle(apiKey: string, art: ArticleRow): Promise<{ topics: string[]; entities: string[]; type: string; usage: any }> {
  const text = stripHtml(art.content || "").slice(0, 4000);
  const sys = `Ты анализируешь статью и возвращаешь СТРОГО JSON {topics: string[], entities: string[], type: string}. topics: 3-5 ключевых тем (короткие фразы, до 4 слов). entities: 5-10 главных сущностей (люди, места, продукты, понятия). type: один из guide|review|tips|news|how-to|comparison.`;
  const user = `Заголовок: ${art.title || ""}\n\nТекст:\n${text}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "SEO-Module Smart Interlinking",
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const data = await res.json();
  const raw = String(data?.choices?.[0]?.message?.content || "{}");
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
  const topics = Array.isArray(parsed.topics) ? parsed.topics.map((s: any) => String(s).toLowerCase().slice(0, 80)).filter(Boolean).slice(0, 5) : [];
  const entities = Array.isArray(parsed.entities) ? parsed.entities.map((s: any) => String(s).toLowerCase().slice(0, 80)).filter(Boolean).slice(0, 12) : [];
  const type = String(parsed.type || "guide").toLowerCase().slice(0, 20);
  return { topics, entities, type, usage: data?.usage || {} };
}

function relevanceScore(a: AnalyzedArticle, b: AnalyzedArticle): { score: number; sharedTopic?: string; sharedEntity?: string } {
  if (a.id === b.id) return { score: 0 };
  const aKw = new Set((a.keywords || []).map((k) => k.toLowerCase()));
  const bKw = new Set((b.keywords || []).map((k) => k.toLowerCase()));
  let score = 0;
  // Shared keywords (weight 3)
  for (const k of aKw) if (bKw.has(k)) score += 3;
  // Shared topics (weight 2)
  let sharedTopic: string | undefined;
  for (const t of a.topics) {
    if (b.topics.some((bt) => bt === t || bt.includes(t) || t.includes(bt))) {
      score += 2;
      sharedTopic = sharedTopic || t;
    }
  }
  // Shared entities (weight 1)
  let sharedEntity: string | undefined;
  for (const e of a.entities) {
    if (b.entities.includes(e)) {
      score += 1;
      sharedEntity = sharedEntity || e;
    }
  }
  // Same type bonus
  if (a.type && a.type === b.type) score += 0.5;
  return { score, sharedTopic, sharedEntity };
}

// Find a contextual phrase inside `text` that mentions one of the given terms.
// Returns the found anchor candidate (2-4 words around the term) or null.
function findAnchorPhrase(text: string, terms: string[]): string | null {
  for (const termRaw of terms) {
    const term = String(termRaw || "").trim();
    if (term.length < 3) continue;
    const re = new RegExp(`(\\S+\\s+){0,2}\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-zа-я]*\\b(\\s+\\S+){0,1}`, "i");
    const m = text.match(re);
    if (m && m[0]) {
      const phrase = m[0].trim().replace(/\s+/g, " ");
      const wc = phrase.split(/\s+/).length;
      if (wc >= 2 && wc <= 4) return phrase;
    }
    // Fallback: just match the term itself (1 word ok)
    const re2 = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-zа-я]*\\b`, "i");
    const m2 = text.match(re2);
    if (m2 && m2[0]) return m2[0];
  }
  return null;
}

// For "generic" anchors we don't require the phrase to already exist in the
// body — we will inject a tiny trailing sentence into a middle paragraph.
function pickFirstPresent(text: string, candidates: string[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) return c;
  }
  return null;
}

// Inject a generic-anchor link by appending a short " (anchor)." span into the
// FIRST middle paragraph that has no <a> yet. Keeps the rule "no first/last <p>".
function injectGenericLink(html: string, href: string, anchor: string, alreadyHrefs: Set<string>): string | null {
  if (!html || !href || !anchor) return null;
  if (alreadyHrefs.has(href)) return null;
  const pRe = /<p[^>]*>[\s\S]*?<\/p>/gi;
  const pMatches: { start: number; end: number; html: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(html)) !== null) {
    pMatches.push({ start: m.index, end: m.index + m[0].length, html: m[0] });
  }
  if (pMatches.length < 3) return null;
  for (let i = 1; i < pMatches.length - 1; i++) {
    const block = pMatches[i].html;
    if (/<a\b[^>]*>/i.test(block)) continue;
    // Insert before the closing </p>
    const closeIdx = block.lastIndexOf("</p>");
    if (closeIdx < 0) continue;
    const inject = ` <a href="${href}" class="internal-link">${anchor}</a>.`;
    const updatedBlock = block.slice(0, closeIdx) + inject + block.slice(closeIdx);
    return html.slice(0, pMatches[i].start) + updatedBlock + html.slice(pMatches[i].end);
  }
  return null;
}

// Inject a single <a href> into the article HTML on the first matching <p>
// (skipping the first and last <p>). Returns updated html, or null if no
// suitable insertion point was found.
function injectLink(html: string, href: string, anchorPhrase: string, alreadyHrefs: Set<string>): string | null {
  if (!html || !href || !anchorPhrase) return null;
  if (alreadyHrefs.has(href)) return null;
  // Don't link if same anchor already linked
  if (new RegExp(`<a[^>]*>\\s*${anchorPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</a>`, "i").test(html)) return null;

  // Get all <p>...</p> blocks
  const pRe = /<p[^>]*>[\s\S]*?<\/p>/gi;
  const pMatches: { start: number; end: number; html: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(html)) !== null) {
    pMatches.push({ start: m.index, end: m.index + m[0].length, html: m[0] });
  }
  if (pMatches.length < 3) return null; // need at least first / middle / last

  // Iterate middle <p> blocks (skip first and last)
  for (let i = 1; i < pMatches.length - 1; i++) {
    const block = pMatches[i].html;
    // Skip if block already has any <a> tag — keep one outbound per paragraph max
    if (/<a\b[^>]*>/i.test(block)) continue;
    const phraseRe = new RegExp(`(?<![\\w>])(${anchorPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w<])`, "i");
    if (!phraseRe.test(block)) continue;
    const updatedBlock = block.replace(phraseRe, `<a href="${href}" class="internal-link">$1</a>`);
    if (updatedBlock === block) continue;
    return html.slice(0, pMatches[i].start) + updatedBlock + html.slice(pMatches[i].end);
  }
  return null;
}

function buildArticleUrl(domain: string, articleId: string, title: string | null): string {
  // Mirrors the slugging used by deploy-cloudflare-direct: lowercase, latin/cyrillic words, dashes.
  const slugBase = (title || articleId).toString().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || articleId;
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/blog/${slugBase}/`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, service);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const projectId: string = body.project_id;
    const shouldRedeploy: boolean = body.redeploy !== false;
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing project_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify ownership (or admin)
    const { data: project } = await admin.from("projects")
      .select("id, user_id, domain, custom_domain, name").eq("id", projectId).maybeSingle();
    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (project.user_id !== user.id) {
      const { data: roleRow } = await admin.from("user_roles")
        .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: articles } = await admin.from("articles")
      .select("id, title, content, keywords, published_url")
      .eq("project_id", projectId)
      .in("status", ["completed", "published"])
      .not("title", "is", null);

    const list: ArticleRow[] = (articles || []).filter((a) => a.content && a.title);
    if (list.length < 2) {
      return new Response(JSON.stringify({
        ok: true, links_inserted: 0, articles_updated: 0,
        message: "Need at least 2 articles for interlinking",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = await getOpenRouterKey(admin);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OpenRouter key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1+2: analyze each article. Best-effort — failures fall back to keyword-only matching.
    const analyzed: AnalyzedArticle[] = [];
    let totalIn = 0, totalOut = 0;
    for (const a of list) {
      try {
        const r = await analyzeArticle(apiKey, a);
        totalIn += Number(r.usage?.prompt_tokens || 0);
        totalOut += Number(r.usage?.completion_tokens || 0);
        analyzed.push({ ...a, topics: r.topics, entities: r.entities, type: r.type });
      } catch (e: any) {
        console.warn("[smart-interlinking] analyze fail:", a.id, e?.message);
        analyzed.push({ ...a, topics: [], entities: [], type: "guide" });
      }
    }
    // Step 3: relevance matrix — for each article, pick top-2 peers.
    const domain = project.custom_domain || project.domain || "";
    let articlesUpdated = 0;
    let linksInserted = 0;
    const anchorTypeStats = { keyword: 0, brand: 0, generic: 0 };

    for (const a of analyzed) {
      const ranked = analyzed
        .map((b) => ({ b, ...relevanceScore(a, b) }))
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 2);
      if (ranked.length === 0) continue;

      let html = a.content || "";
      const placedHrefs = new Set<string>();
      // Collect existing internal hrefs to avoid duplicates
      for (const m of html.matchAll(/<a\s+href="([^"]+)"/gi)) placedHrefs.add(m[1]);

      const plainText = stripHtml(html);
      let inserted = 0;
      let keywordAnchorsOnPage = 0;

      for (const r of ranked) {
        if (inserted >= 2) break;
        const peer = r.b;
        const peerUrl = peer.published_url || buildArticleUrl(domain, peer.id, peer.title);
        if (placedHrefs.has(peerUrl)) continue;

        // Decide preferred anchor type with a deterministic 50/30/20 hash bucket.
        let preferred = pickAnchorType(a.id, peer.id);
        // Dilution: never put 2 keyword-rich anchors on the same donor page.
        if (preferred === "keyword" && keywordAnchorsOnPage >= 1) {
          // Demote to brand or generic depending on the bucket value
          preferred = pairHashBucket(a.id, peer.id) % 2 === 0 ? "brand" : "generic";
        }

        // Try preferred type first, then a fallback chain so we don't lose the link.
        const tryOrder: AnchorType[] = preferred === "keyword"
          ? ["keyword", "brand", "generic"]
          : preferred === "brand"
            ? ["brand", "generic", "keyword"]
            : ["generic", "brand", "keyword"];

        let placedType: AnchorType | null = null;
        let usedAnchor: string | null = null;

        for (const kind of tryOrder) {
          if (kind === "keyword") {
            if (keywordAnchorsOnPage >= 1) continue;
            const candidates: string[] = [];
            if (r.sharedTopic) candidates.push(r.sharedTopic);
            if (r.sharedEntity) candidates.push(r.sharedEntity);
            candidates.push(...(peer.keywords || []).map((k) => String(k).toLowerCase()));
            candidates.push(...peer.topics);
            candidates.push(...peer.entities.slice(0, 5));
            const anchor = findAnchorPhrase(plainText, candidates);
            if (!anchor) continue;
            const updated = injectLink(html, peerUrl, anchor, placedHrefs);
            if (updated) {
              html = updated;
              usedAnchor = anchor;
              placedType = "keyword";
              break;
            }
          } else if (kind === "brand") {
            const brandCands = brandAnchorCandidates(peer.title || "", domain);
            // Prefer a brand phrase already present in body (natural anchor).
            const present = pickFirstPresent(plainText, brandCands);
            if (present) {
              const updated = injectLink(html, peerUrl, present, placedHrefs);
              if (updated) {
                html = updated;
                usedAnchor = present;
                placedType = "brand";
                break;
              }
            }
            // Otherwise inject the brand head as a generic-style appended anchor.
            const fallback = brandCands[0];
            if (fallback) {
              const updated = injectGenericLink(html, peerUrl, fallback, placedHrefs);
              if (updated) {
                html = updated;
                usedAnchor = fallback;
                placedType = "brand";
                break;
              }
            }
          } else {
            // generic
            const pool = genericAnchorPool(plainText, peer.title || "");
            const idx = pairHashBucket(a.id, peer.id) % pool.length;
            const anchor = pool[idx];
            const updated = injectGenericLink(html, peerUrl, anchor, placedHrefs);
            if (updated) {
              html = updated;
              usedAnchor = anchor;
              placedType = "generic";
              break;
            }
          }
        }

        if (placedType && usedAnchor) {
          placedHrefs.add(peerUrl);
          inserted++;
          linksInserted++;
          anchorTypeStats[placedType]++;
          if (placedType === "keyword") keywordAnchorsOnPage++;
        }
      }

      if (inserted > 0) {
        const { error: updErr } = await admin.from("articles")
          .update({ content: html, updated_at: new Date().toISOString() })
          .eq("id", a.id);
        if (!updErr) articlesUpdated++;
        else console.warn("[smart-interlinking] update fail:", a.id, updErr.message);
      }
    }

    void logCost(admin, {
      project_id: projectId, user_id: user.id,
      operation_type: "smart_interlinking_analysis",
      model: ANALYSIS_MODEL,
      tokens_input: totalIn, tokens_output: totalOut,
      metadata: {
        articles: analyzed.length,
        links_inserted: linksInserted,
        articles_updated: articlesUpdated,
        anchor_distribution: anchorTypeStats,
      },
    });

    // Step 4: trigger redeploy so the static site picks up new links + sitemap lastmod.
    let redeployed = false;
    if (shouldRedeploy && articlesUpdated > 0) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/deploy-cloudflare-direct`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${service}`,
          },
          body: JSON.stringify({ project_id: projectId }),
        });
        redeployed = res.ok;
        if (!res.ok) {
          const txt = await res.text();
          console.warn("[smart-interlinking] redeploy failed:", res.status, txt.slice(0, 200));
        }
      } catch (e: any) {
        console.warn("[smart-interlinking] redeploy error:", e?.message);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      articles_analyzed: analyzed.length,
      articles_updated: articlesUpdated,
      links_inserted: linksInserted,
      anchor_distribution: anchorTypeStats,
      redeployed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[smart-interlinking] ERROR:", err?.message);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});