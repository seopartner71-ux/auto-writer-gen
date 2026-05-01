// Syndicate a Site Factory article to Blogger (RU), Hashnode (EN) and Dev.to (EN).
// Translation RU -> EN happens once via Lovable AI Gateway (gemini-2.5-flash-lite)
// and is cached on the article row. Each platform run is logged in syndication_log.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-syndicate-user-id",
};

type Platform = "blogger" | "hashnode" | "devto";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  // Already markdown-ish? heuristic: no tags
  if (!/<\w+[^>]*>/.test(html)) return html;
  let md = html;
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/(ul|ol)>/gi, "\n");
  md = md.replace(/<(ul|ol)[^>]*>/gi, "\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}

function mdToHtml(md: string): string {
  if (!md) return "";
  if (/<\w+[^>]*>/.test(md)) return md;
  let html = md;
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  const blocks = html.split(/\n{2,}/).map((b) => {
    const t = b.trim();
    if (!t) return "";
    if (/^<(h[1-6]|ul|ol|li|blockquote|pre|table)/i.test(t)) return t;
    return `<p>${t.replace(/\n/g, "<br/>")}</p>`;
  });
  return blocks.filter(Boolean).join("\n\n");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50) || "topic";
}

async function translateToEnglish(
  admin: any,
  article: any,
  userId: string,
  projectId: string | null,
): Promise<{ title: string; content: string } | null> {
  // Reuse cached translation
  if (article.translated_title_en && article.translated_content_en) {
    return { title: article.translated_title_en, content: article.translated_content_en };
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.error("[syndicate] LOVABLE_API_KEY missing");
    return null;
  }

  const sourceContent = htmlToMarkdown(article.content || "");
  const prompt = `Переведи статью на английский. Сохрани структуру markdown, заголовки, списки, ссылки и смысл. Верни только переведенный текст без пояснений.\n\nЗАГОЛОВОК:\n${article.title || ""}\n\nКОНТЕНТ:\n${sourceContent}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You are a professional RU->EN translator. Output only the translation." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("[syndicate] AI gateway error", res.status, txt.slice(0, 300));
      return null;
    }
    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content || "";
    if (!raw) return null;

    // First non-empty line is title, the rest is content
    const lines = raw.split(/\r?\n/);
    let titleLine = "";
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].replace(/^#+\s*/, "").trim();
      if (t) { titleLine = t; bodyStart = i + 1; break; }
    }
    const body = lines.slice(bodyStart).join("\n").trim() || raw;

    const usage = data?.usage || {};
    void logCost(admin, {
      project_id: projectId,
      user_id: userId,
      operation_type: "article_generation",
      model: "google/gemini-2.5-flash-lite",
      tokens_input: usage.prompt_tokens || 0,
      tokens_output: usage.completion_tokens || 0,
      metadata: { kind: "syndication_translate", article_id: article.id },
    });

    // Cache
    await admin.from("articles").update({
      translated_title_en: titleLine,
      translated_content_en: body,
    }).eq("id", article.id);

    return { title: titleLine, content: body };
  } catch (e: any) {
    console.error("[syndicate] translation failed", e?.message);
    return null;
  }
}

async function refreshBloggerToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_BLOGGER_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_BLOGGER_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) return null;
  return { access_token: data.access_token as string, expires_in: (data.expires_in as number) || 3600 };
}

async function publishToBlogger(
  admin: any,
  article: any,
  userId: string,
  canonicalUrl: string,
  siteName: string,
) {
  const { data: conn } = await admin
    .from("blogger_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!conn) return { ok: false, error: "Blogger not connected" };

  const blogId = article.blogger_blog_id || conn.default_blog_id;
  if (!blogId) return { ok: false, error: "No Blogger blog selected" };

  let accessToken = conn.access_token;
  const expired = !conn.token_expires_at || new Date(conn.token_expires_at).getTime() < Date.now() + 60_000;
  if (expired) {
    const r = await refreshBloggerToken(conn.refresh_token);
    if (!r) return { ok: false, error: "Failed to refresh Blogger token" };
    accessToken = r.access_token;
    await admin.from("blogger_connections").update({
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + (r.expires_in - 60) * 1000).toISOString(),
    }).eq("user_id", userId);
  }

  const lsi = Array.isArray(article.lsi_keywords) ? article.lsi_keywords : [];
  const labels: string[] = lsi
    .map((x: any) => (typeof x === "string" ? x : x?.keyword || x?.term || ""))
    .filter((s: string) => s && s.length < 60).slice(0, 10);

  const htmlBase = mdToHtml(article.content || "");
  const footer = `\n<p><em>Originally published at <a href="${canonicalUrl}" rel="canonical noopener">${siteName || canonicalUrl}</a></em></p>`;
  const htmlContent = htmlBase + footer;

  const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "blogger#post",
      title: article.title || "Untitled",
      content: htmlContent,
      labels,
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || `Blogger ${res.status}` };
  return { ok: true, url: data.url, id: String(data.id) };
}

async function publishToHashnode(
  enTitle: string,
  enMarkdown: string,
  publicationId: string,
  canonicalUrl: string,
  tags: string[],
) {
  const token = Deno.env.get("HASHNODE_TOKEN");
  if (!token) return { ok: false, error: "HASHNODE_TOKEN not configured" };
  if (!publicationId) return { ok: false, error: "hashnode_publication_id missing in project" };

  const tagInput = (tags.length ? tags : ["seo"]).slice(0, 5).map((name) => ({
    name,
    slug: slugify(name),
  }));

  const query = `mutation PublishPost($input: PublishPostInput!) {
    publishPost(input: $input) { post { id url slug } }
  }`;

  const variables = {
    input: {
      title: enTitle.slice(0, 250),
      publicationId,
      contentMarkdown: enMarkdown,
      originalArticleURL: canonicalUrl,
      tags: tagInput,
    },
  };

  const res = await fetch("https://gql.hashnode.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    return { ok: false, error: data?.errors?.[0]?.message || `Hashnode ${res.status}` };
  }
  const post = data?.data?.publishPost?.post;
  if (!post?.url) return { ok: false, error: "Hashnode no post returned" };
  return { ok: true, url: post.url, id: post.id };
}

async function publishToDevto(
  enTitle: string,
  enMarkdown: string,
  canonicalUrl: string,
  tags: string[],
) {
  const apiKey = Deno.env.get("DEVTO_API_KEY");
  if (!apiKey) return { ok: false, error: "DEVTO_API_KEY not configured" };

  // dev.to tags: only lowercase letters/numbers, max 4
  const cleanTags = (tags.length ? tags : ["seo", "marketing"])
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 25))
    .filter(Boolean).slice(0, 4);

  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      article: {
        title: enTitle.slice(0, 128),
        body_markdown: enMarkdown,
        published: true,
        canonical_url: canonicalUrl,
        tags: cleanTags,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error || `Dev.to ${res.status}` };
  return { ok: true, url: data.url, id: String(data.id) };
}

async function logResult(
  admin: any,
  userId: string,
  article: any,
  projectId: string | null,
  platform: Platform,
  result: { ok: boolean; url?: string; id?: string; error?: string },
  canonicalUrl: string,
) {
  try {
    await admin.from("syndication_log").insert({
      article_id: article.id,
      project_id: projectId,
      user_id: userId,
      platform,
      published_url: result.url || null,
      canonical_url: canonicalUrl,
      external_post_id: result.id || null,
      status: result.ok ? "success" : "failed",
      error_message: result.error || null,
    });
    void logCost(admin, {
      project_id: projectId,
      user_id: userId,
      operation_type: "auto_post_cron",
      cost_usd: 0,
      metadata: { kind: `syndication_${platform}`, ok: result.ok, url: result.url },
    });
  } catch (e: any) {
    console.error("[syndicate] log insert failed", e?.message);
  }
}

function pickTags(article: any): string[] {
  const lsi = Array.isArray(article.lsi_keywords) ? article.lsi_keywords : [];
  const arr = lsi
    .map((x: any) => (typeof x === "string" ? x : x?.keyword || x?.term || ""))
    .filter(Boolean) as string[];
  return arr.slice(0, 4);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { article_id, platforms: platformsOverride } = body as {
      article_id?: string; platforms?: Platform[];
    };
    if (!article_id) return json({ error: "article_id required" }, 400);

    // Resolve user (auth header OR cron header)
    let userId: string | null = null;
    const queueUserId = req.headers.get("x-syndicate-user-id");
    if (queueUserId) {
      userId = queueUserId;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    const { data: article, error: artErr } = await admin
      .from("articles")
      .select("id, user_id, project_id, title, content, lsi_keywords, blogger_blog_id, published_url, telegraph_url, translated_title_en, translated_content_en")
      .eq("id", article_id).single();
    if (artErr || !article) return json({ error: "Article not found" }, 404);
    if (article.user_id !== userId) return json({ error: "Forbidden" }, 403);
    if (!article.project_id) return json({ error: "Article has no project (not a Site Factory article)" }, 400);

    const { data: project } = await admin
      .from("projects")
      .select("id, name, custom_domain, domain, hashnode_publication_id, syndication_enabled, syndication_platforms")
      .eq("id", article.project_id).maybeSingle();
    if (!project) return json({ error: "Project not found" }, 404);

    // Determine canonical URL = the live PBN article URL
    const baseDomain = project.custom_domain || project.domain;
    const canonicalUrl = article.published_url
      || (baseDomain ? `https://${baseDomain}/${slugify(article.title || article.id)}` : article.telegraph_url || "");
    if (!canonicalUrl) return json({ error: "No canonical URL available" }, 400);

    const enabledPlatforms: Platform[] = (
      platformsOverride && platformsOverride.length
        ? platformsOverride
        : (project.syndication_platforms as Platform[] | null) || ["blogger", "hashnode", "devto"]
    ).filter((p) => ["blogger", "hashnode", "devto"].includes(p)) as Platform[];

    const tags = pickTags(article);
    const results: Record<string, any> = {};

    // Translate once if hashnode or devto requested
    let en: { title: string; content: string } | null = null;
    if (enabledPlatforms.includes("hashnode") || enabledPlatforms.includes("devto")) {
      en = await translateToEnglish(admin, article, userId, article.project_id);
      if (!en) {
        // log failures for both EN platforms, continue with blogger only
        for (const p of enabledPlatforms) {
          if (p === "hashnode" || p === "devto") {
            const r = { ok: false, error: "Translation failed" };
            await logResult(admin, userId, article, article.project_id, p, r, canonicalUrl);
            results[p] = r;
          }
        }
      }
    }

    // Blogger (RU)
    if (enabledPlatforms.includes("blogger")) {
      const r = await publishToBlogger(admin, article, userId, canonicalUrl, project.name || "");
      await logResult(admin, userId, article, article.project_id, "blogger", r, canonicalUrl);
      results.blogger = r;
      await new Promise((res) => setTimeout(res, 30_000));
    }

    // Hashnode (EN)
    if (enabledPlatforms.includes("hashnode") && en) {
      const r = await publishToHashnode(en.title, en.content, project.hashnode_publication_id || "", canonicalUrl, tags);
      await logResult(admin, userId, article, article.project_id, "hashnode", r, canonicalUrl);
      results.hashnode = r;
      await new Promise((res) => setTimeout(res, 30_000));
    }

    // Dev.to (EN)
    if (enabledPlatforms.includes("devto") && en) {
      const r = await publishToDevto(en.title, en.content, canonicalUrl, tags);
      await logResult(admin, userId, article, article.project_id, "devto", r, canonicalUrl);
      results.devto = r;
    }

    return json({ ok: true, canonical_url: canonicalUrl, results });
  } catch (e: any) {
    console.error("[syndicate] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});
