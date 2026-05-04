import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

interface Body {
  project_id?: string | null;
  current_article_id?: string | null;
  content: string;
}

interface Suggestion {
  anchor: string;
  url: string;
  target_title: string;
  match_count: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findAnchors(content: string, candidates: { url: string; title: string; keywords: string[] }[]): Suggestion[] {
  const out: Suggestion[] = [];
  const lowered = content.toLowerCase();
  for (const c of candidates) {
    const phrases = Array.from(new Set([c.title, ...c.keywords].filter(Boolean)));
    let best: { phrase: string; count: number } | null = null;
    for (const phrase of phrases) {
      const p = String(phrase).trim();
      if (p.length < 4 || p.length > 80) continue;
      // Skip already linked occurrences
      const re = new RegExp(`\\b${escapeRegex(p.toLowerCase())}\\b`, "gi");
      const matches = lowered.match(re);
      if (!matches) continue;
      // Skip if already a markdown/html link wrapping this phrase
      const linkedRe = new RegExp(`\\[([^\\]]*?${escapeRegex(p)}[^\\]]*?)\\]\\(`, "i");
      if (linkedRe.test(content)) continue;
      if (!best || matches.length > best.count) best = { phrase: p, count: matches.length };
    }
    if (best) {
      out.push({ anchor: best.phrase, url: c.url, target_title: c.title, match_count: best.count });
    }
  }
  // Dedup by url, max 8 suggestions
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.match_count - a.match_count)
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
    .slice(0, 8);
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }
  if (!body?.content || body.content.trim().length < 100) {
    return errorResponse("content is required (min 100 chars)", 400);
  }

  const sb = adminClient();

  let q = sb
    .from("articles")
    .select("id, title, published_url, keywords")
    .eq("user_id", auth.userId)
    .not("published_url", "is", null);

  if (body.project_id) q = q.eq("project_id", body.project_id);
  if (body.current_article_id) q = q.neq("id", body.current_article_id);

  const { data, error } = await q.limit(200);
  if (error) return errorResponse(error.message, 500);

  const candidates = (data || [])
    .filter((r: any) => r.published_url && r.title)
    .map((r: any) => ({
      url: r.published_url as string,
      title: r.title as string,
      keywords: Array.isArray(r.keywords) ? r.keywords.map((x: any) => String(x)) : [],
    }));

  const suggestions = findAnchors(body.content, candidates);

  return jsonResponse({ suggestions, candidate_count: candidates.length });
});
