import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50) || "topic";
}

function htmlToPlain(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LANG_NAMES: Record<string, string> = {
  ru: "Russian", en: "English", de: "German", es: "Spanish", fr: "French",
  it: "Italian", pl: "Polish", uk: "Ukrainian", tr: "Turkish", pt: "Portuguese",
};

/**
 * Generate a short teaser (200-350 words) in the site's language with a
 * natural backlink to canonicalUrl. Returns markdown.
 */
async function generateTeaser(
  apiKey: string,
  sourceTitle: string,
  sourceExcerpt: string,
  canonicalUrl: string,
  siteName: string,
  lang: string,
): Promise<{ title: string; markdown: string } | null> {
  const langName = LANG_NAMES[lang] || "Russian";
  const sys = `You write concise web teasers (200-350 words) in ${langName}. Output strict JSON only.`;
  const user = `Write an original short article in ${langName} that briefly introduces the topic of the source article and points readers to the full version on ${siteName}.

Rules:
- 200-350 words
- Plain markdown, 2-3 short paragraphs
- Include exactly ONE inline markdown link in the body using the anchor text "${siteName}" or a natural phrase, pointing to ${canonicalUrl}
- Do not copy sentences from the source verbatim - paraphrase
- No bold, no emoji, no lists
- Title: 6-10 words, attention-grabbing, in ${langName}
- Output JSON: {"title":"...","body":"..."} - no other text

SOURCE TITLE: ${sourceTitle}
SOURCE EXCERPT (first 800 chars): ${sourceExcerpt.slice(0, 800)}
CANONICAL URL: ${canonicalUrl}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("[tier2] AI gateway", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const title = String(parsed?.title || "").trim();
    const body = String(parsed?.body || "").trim();
    if (!title || !body) return null;
    // Safety: ensure the canonical URL is in the body; if not, append a line.
    const finalBody = body.includes(canonicalUrl)
      ? body
      : `${body}\n\n[${siteName}](${canonicalUrl})`;
    return { title, markdown: finalBody };
  } catch (e: any) {
    console.error("[tier2] generate failed", e?.message);
    return null;
  }
}

/**
 * Publish teaser to Telegra.ph by calling our existing publish-telegraph
 * helper directly via Telegraph API. We don't reuse the edge function to
 * avoid an extra hop and keep things synchronous.
 */
async function publishTeaserToTelegraph(
  title: string,
  markdown: string,
  authorName: string,
  authorUrl: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    // 1) create anonymous account
    const acc = await fetch("https://api.telegra.ph/createAccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        short_name: authorName.slice(0, 32) || "site",
        author_name: authorName.slice(0, 128) || "site",
        author_url: authorUrl.slice(0, 512),
      }),
    });
    const accData = await acc.json();
    const accessToken = accData?.result?.access_token;
    if (!accessToken) return { ok: false, error: "telegraph account failed" };

    // 2) markdown -> simple Telegraph nodes (paragraphs split by blank line)
    const paragraphs = markdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    const nodes = paragraphs.map((p) => {
      const children: (string | { tag: string; attrs?: Record<string, string>; children?: any[] })[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(p)) !== null) {
        if (m.index > last) children.push(p.slice(last, m.index));
        children.push({ tag: "a", attrs: { href: m[2] }, children: [m[1]] });
        last = m.index + m[0].length;
      }
      if (last < p.length) children.push(p.slice(last));
      return { tag: "p", children };
    });

    // 3) create page
    const page = await fetch("https://api.telegra.ph/createPage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        title: title.slice(0, 256),
        author_name: authorName.slice(0, 128),
        author_url: authorUrl.slice(0, 512),
        content: nodes,
        return_content: false,
      }),
    });
    const pageData = await page.json();
    const url = pageData?.result?.url as string | undefined;
    if (!url) return { ok: false, error: pageData?.error || "telegraph publish failed" };
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { article_id, count = 2 } = body as { article_id?: string; count?: number };
    if (!article_id) return json({ error: "article_id required" }, 400);
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const userId = user.id;

    // Load article
    const { data: article, error: artErr } = await admin
      .from("articles")
      .select("id, user_id, project_id, title, content, published_url")
      .eq("id", article_id).single();
    if (artErr || !article) return json({ error: "Article not found" }, 404);
    if (article.user_id !== userId) return json({ error: "Forbidden" }, 403);
    if (!article.project_id) return json({ error: "Article must belong to a Site Factory project" }, 400);

    // Load project
    const { data: project } = await admin
      .from("projects")
      .select("id, name, site_name, custom_domain, domain, language")
      .eq("id", article.project_id).maybeSingle();
    if (!project) return json({ error: "Project not found" }, 404);

    const baseDomain = project.custom_domain || project.domain;
    const canonicalUrl = article.published_url
      || (baseDomain ? `https://${baseDomain}/${slugify(article.title || article.id)}` : "");
    if (!canonicalUrl) return json({ error: "Cannot resolve canonical URL for article" }, 400);

    const siteName = project.site_name || project.name || baseDomain || "the site";
    const lang = String((project as any).language || "ru").toLowerCase().slice(0, 2);
    const excerpt = htmlToPlain(article.content || "");

    const total = Math.max(1, Math.min(5, Number(count) || 2));
    const results: Array<Record<string, any>> = [];

    for (let i = 0; i < total; i++) {
      const teaser = await generateTeaser(apiKey, article.title || "", excerpt, canonicalUrl, siteName, lang);
      if (!teaser) {
        await admin.from("tier2_backlinks").insert({
          user_id: userId,
          project_id: project.id,
          article_id: article.id,
          platform: "telegraph",
          canonical_url: canonicalUrl,
          status: "failed",
          error: "teaser generation failed",
        });
        results.push({ ok: false, error: "teaser generation failed" });
        continue;
      }

      const pub = await publishTeaserToTelegraph(
        teaser.title,
        teaser.markdown,
        siteName,
        canonicalUrl,
      );

      await admin.from("tier2_backlinks").insert({
        user_id: userId,
        project_id: project.id,
        article_id: article.id,
        platform: "telegraph",
        canonical_url: canonicalUrl,
        external_url: pub.url || null,
        teaser_title: teaser.title,
        status: pub.ok ? "published" : "failed",
        error: pub.error || null,
      });

      results.push({ ok: pub.ok, url: pub.url, error: pub.error, title: teaser.title });

      // small pause between Telegraph creates to avoid rate limits
      if (i < total - 1) await new Promise((r) => setTimeout(r, 1500));
    }

    const okCount = results.filter((r) => r.ok).length;
    return json({ ok: okCount > 0, total: results.length, success: okCount, results });
  } catch (e: any) {
    console.error("[tier2-boost] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});