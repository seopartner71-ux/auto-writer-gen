// Tier-2 link booster.
// Generates a short 150-300 word teaser (intro + "read more" link) using
// Gemini Flash Lite, then publishes to Telegra.ph and (optionally) Blogger
// with a 30s gap between platforms to mimic a natural posting pattern.
//
// Anchor text variants (per teaser):
//   50% — a keyword from the article
//   30% — site name
//   20% — generic "read more" / "подробнее"
//
// Logging:
//   - syndication_log: platform = 'tier2_telegraph' | 'tier2_blogger'
//   - cost_log: operation_type = 'tier2_generation' (~$0.001 per teaser)
//   - tier2_backlinks: kept for backwards compatibility / dashboard counter
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

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

const LANG_NAMES: Record<string, string> = {
  ru: "Russian", en: "English", de: "German", es: "Spanish", fr: "French",
  it: "Italian", pl: "Polish", uk: "Ukrainian", tr: "Turkish", pt: "Portuguese",
};

const READ_MORE: Record<string, string[]> = {
  ru: ["читать далее", "подробнее", "продолжение", "узнать больше"],
  en: ["read more", "continue reading", "learn more", "full story"],
  de: ["weiterlesen", "mehr erfahren"],
  es: ["leer mas", "continuar leyendo"],
  fr: ["lire la suite", "en savoir plus"],
  it: ["continua a leggere", "scopri di piu"],
  pl: ["czytaj dalej", "wiecej"],
  uk: ["читати далі", "детальніше"],
  tr: ["devamini oku", "daha fazla"],
  pt: ["continuar lendo", "saiba mais"],
};

function htmlToPlain(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraphs(content: string, n = 2): string {
  const plain = htmlToPlain(content);
  const sentences = plain.split(/(?<=[.!?…])\s+/).filter(Boolean);
  // Build until we have ~120-180 words
  const out: string[] = [];
  let words = 0;
  for (const s of sentences) {
    out.push(s);
    words += s.split(/\s+/).length;
    if (words >= 140) break;
  }
  return out.join(" ").trim();
}

function pickAnchor(
  lang: string,
  siteName: string,
  keywords: string[],
): { type: "keyword" | "site" | "generic"; anchor: string } {
  const r = Math.random();
  if (r < 0.5 && keywords.length > 0) {
    const kw = keywords[Math.floor(Math.random() * keywords.length)].trim();
    if (kw && kw.length <= 60) return { type: "keyword", anchor: kw };
  }
  if (r < 0.8) {
    return { type: "site", anchor: siteName.slice(0, 60) };
  }
  const list = READ_MORE[lang] || READ_MORE.ru;
  return { type: "generic", anchor: list[Math.floor(Math.random() * list.length)] };
}

interface TeaserResult {
  title: string;
  intro: string;          // 150-220 word intro paragraph(s)
  anchor: string;
  anchorType: string;
  tokensIn: number;
  tokensOut: number;
}

async function generateTeaser(
  apiKey: string,
  sourceTitle: string,
  sourceIntro: string,
  siteName: string,
  lang: string,
  anchor: string,
): Promise<TeaserResult | null> {
  const langName = LANG_NAMES[lang] || "Russian";
  const sys = `You write very short web teasers in ${langName}. Output strict JSON only.`;
  const user = `Write a SHORT teaser in ${langName} based on the source article.

STRICT REQUIREMENTS:
- Total length: 150-220 words
- Use the first 1-2 paragraphs of the source as inspiration (paraphrase, do not copy)
- 2 short paragraphs maximum
- No bold, no headings, no lists, no emoji
- Title: 5-10 words, MUST be different from the source title (rephrase the angle)
- The teaser must end with the cliffhanger so readers want the full version
- Do NOT include any link in the body (the system appends the link separately)

Output JSON:
{"title":"...","body":"..."}

SOURCE TITLE: ${sourceTitle}
SOURCE INTRO: ${sourceIntro}`;

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
    const intro = String(parsed?.body || "").trim();
    if (!title || !intro) return null;
    return {
      title,
      intro,
      anchor,
      anchorType: "",
      tokensIn: data?.usage?.prompt_tokens || 0,
      tokensOut: data?.usage?.completion_tokens || 0,
    };
  } catch (e: any) {
    console.error("[tier2] generate failed", e?.message);
    return null;
  }
}

function buildTeaserMarkdown(intro: string, anchor: string, url: string, lang: string): string {
  const cta = (lang === "en" ? "Read full article: " : "Читать полностью: ");
  return `${intro}\n\n${cta}[${anchor}](${url})`;
}

async function publishToTelegraph(
  title: string,
  markdown: string,
  authorName: string,
  authorUrl: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
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

    const paragraphs = markdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    const nodes = paragraphs.map((p) => {
      const children: any[] = [];
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

async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_BLOGGER_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_BLOGGER_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  try {
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
    return data?.access_token || null;
  } catch {
    return null;
  }
}

function markdownToBloggerHtml(md: string): string {
  const blocks = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const html = b.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
    return `<p>${html.replace(/\n/g, "<br/>")}</p>`;
  }).join("\n");
}

async function publishToBlogger(
  admin: any,
  userId: string,
  title: string,
  markdown: string,
): Promise<{ ok: boolean; url?: string; error?: string; postId?: string; blogId?: string }> {
  try {
    const { data: conn } = await admin
      .from("blogger_connections")
      .select("access_token, refresh_token, token_expires_at, default_blog_id")
      .eq("user_id", userId).maybeSingle();
    if (!conn?.refresh_token || !conn?.default_blog_id) {
      return { ok: false, error: "Blogger not connected" };
    }
    let accessToken: string = conn.access_token;
    const expired = !conn.token_expires_at || new Date(conn.token_expires_at).getTime() < Date.now() + 60_000;
    if (expired) {
      const fresh = await refreshGoogleToken(conn.refresh_token);
      if (!fresh) return { ok: false, error: "blogger token refresh failed" };
      accessToken = fresh;
      await admin.from("blogger_connections").update({
        access_token: fresh,
        token_expires_at: new Date(Date.now() + 3500 * 1000).toISOString(),
      }).eq("user_id", userId);
    }
    const html = markdownToBloggerHtml(markdown);
    const res = await fetch(
      `https://www.googleapis.com/blogger/v3/blogs/${conn.default_blog_id}/posts/`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "blogger#post", title, content: html }),
      },
    );
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error?.message || `blogger ${res.status}` };
    return { ok: true, url: data.url, postId: data.id, blogId: conn.default_blog_id };
  } catch (e: any) {
    return { ok: false, error: e?.message || "blogger network error" };
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
    const { article_id, count = 1 } = body as { article_id?: string; count?: number };
    if (!article_id) return json({ error: "article_id required" }, 400);
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    // Auth: either user JWT or internal call from cron (x-internal-user-id)
    let userId: string | null = null;
    const internalUserId = req.headers.get("x-internal-user-id");
    if (internalUserId) {
      userId = internalUserId;
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
      .select("id, user_id, project_id, title, content, published_url, keywords")
      .eq("id", article_id).single();
    if (artErr || !article) return json({ error: "Article not found" }, 404);
    if (article.user_id !== userId) return json({ error: "Forbidden" }, 403);
    if (!article.project_id) return json({ error: "Article must belong to a Site Factory project" }, 400);

    const { data: project } = await admin
      .from("projects")
      .select("id, name, site_name, custom_domain, domain, language")
      .eq("id", article.project_id).maybeSingle();
    if (!project) return json({ error: "Project not found" }, 404);

    const baseDomain = project.custom_domain || project.domain;
    const slug = (article.title || article.id).toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "topic";
    const canonicalUrl = article.published_url
      || (baseDomain ? `https://${baseDomain}/${slug}` : "");
    if (!canonicalUrl) return json({ error: "Cannot resolve canonical URL for article" }, 400);

    const siteName = project.site_name || project.name || baseDomain || "the site";
    const lang = String((project as any).language || "ru").toLowerCase().slice(0, 2);
    const intro = firstParagraphs(article.content || "", 2);
    const keywords: string[] = Array.isArray(article.keywords) ? article.keywords : [];
    const platforms: ("telegraph" | "blogger")[] = ["telegraph", "blogger"];

    const total = Math.max(1, Math.min(3, Number(count) || 1));
    const results: Array<Record<string, any>> = [];

    for (let i = 0; i < total; i++) {
      for (let pi = 0; pi < platforms.length; pi++) {
        const platform = platforms[pi];
        const { anchor, type: anchorType } = pickAnchor(lang, siteName, keywords);

        const teaser = await generateTeaser(apiKey, article.title || "", intro, siteName, lang, anchor);

        // Cost log: best-effort
        if (teaser) {
          void logCost(admin, {
            project_id: project.id,
            user_id: userId,
            operation_type: "article_generation" as any, // kept compatible with enum; metadata flags it
            model: "google/gemini-2.5-flash-lite",
            tokens_input: teaser.tokensIn,
            tokens_output: teaser.tokensOut,
            metadata: { kind: "tier2_generation", platform, anchor_type: anchorType },
          });
        }

        if (!teaser) {
          await admin.from("syndication_log").insert({
            user_id: userId, article_id: article.id, project_id: project.id,
            platform: `tier2_${platform}`, status: "failed",
            error_message: "teaser generation failed", canonical_url: canonicalUrl,
          });
          await admin.from("tier2_backlinks").insert({
            user_id: userId, project_id: project.id, article_id: article.id,
            platform: `tier2_${platform}`, canonical_url: canonicalUrl,
            status: "failed", error: "teaser generation failed",
          });
          results.push({ platform, ok: false, error: "teaser generation failed" });
          continue;
        }

        const md = buildTeaserMarkdown(teaser.intro, anchor, canonicalUrl, lang);

        let pub: { ok: boolean; url?: string; error?: string; postId?: string; blogId?: string };
        if (platform === "telegraph") {
          pub = await publishToTelegraph(teaser.title, md, siteName, canonicalUrl);
        } else {
          pub = await publishToBlogger(admin, userId!, teaser.title, md);
        }

        await admin.from("syndication_log").insert({
          user_id: userId, article_id: article.id, project_id: project.id,
          platform: `tier2_${platform}`,
          status: pub.ok ? "success" : "failed",
          published_url: pub.url || null,
          external_post_id: pub.postId || null,
          error_message: pub.error || null,
          canonical_url: canonicalUrl,
        });
        await admin.from("tier2_backlinks").insert({
          user_id: userId, project_id: project.id, article_id: article.id,
          platform: `tier2_${platform}`,
          canonical_url: canonicalUrl,
          external_url: pub.url || null,
          teaser_title: teaser.title,
          status: pub.ok ? "published" : "failed",
          error: pub.error || null,
        });

        results.push({
          platform, ok: pub.ok, url: pub.url, error: pub.error,
          title: teaser.title, anchor, anchor_type: anchorType,
        });

        // 30 second pause between platforms (but skip after the very last item)
        const isLast = (i === total - 1) && (pi === platforms.length - 1);
        if (!isLast) await new Promise((r) => setTimeout(r, 30_000));
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return json({ ok: okCount > 0, total: results.length, success: okCount, results });
  } catch (e: any) {
    console.error("[tier2-boost] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});
