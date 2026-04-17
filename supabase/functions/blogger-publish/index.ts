import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Convert basic markdown to HTML for Blogger body
function mdToHtml(md: string): string {
  if (!md) return "";
  // If already looks like HTML, leave as-is
  if (/<\w+[^>]*>/.test(md)) return md;
  let html = md;
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, ""); // strip H1 (Blogger uses title)
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  // Paragraphs
  const blocks = html.split(/\n{2,}/).map(b => {
    const t = b.trim();
    if (!t) return "";
    if (/^<(h[1-6]|ul|ol|li|blockquote|pre|table)/i.test(t)) return t;
    return `<p>${t.replace(/\n/g, "<br/>")}</p>`;
  });
  return blocks.filter(Boolean).join("\n\n");
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get("GOOGLE_BLOGGER_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_BLOGGER_CLIENT_SECRET")!;
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
  return { access_token: data.access_token, expires_in: data.expires_in || 3600 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { article_id, blog_id: blogIdOverride } = body;

    // Resolve user (auth header OR queue context header)
    let userId: string | null = null;
    const queueUserId = req.headers.get("x-queue-user-id");
    if (queueUserId) {
      userId = queueUserId;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    if (!article_id) {
      return new Response(JSON.stringify({ error: "article_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load article
    const { data: article, error: artErr } = await admin
      .from("articles")
      .select("id, user_id, title, content, lsi_keywords, blogger_post_id, blogger_blog_id")
      .eq("id", article_id)
      .single();
    if (artErr || !article) {
      return new Response(JSON.stringify({ error: "Article not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (article.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Blogger connection
    const { data: conn } = await admin
      .from("blogger_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: "Blogger not connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blogId = blogIdOverride || article.blogger_blog_id || conn.default_blog_id;
    if (!blogId) {
      return new Response(JSON.stringify({ error: "No blog selected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh token if needed
    let accessToken: string = conn.access_token;
    const expired = !conn.token_expires_at || new Date(conn.token_expires_at).getTime() < Date.now() + 60_000;
    if (expired) {
      const refreshed = await refreshAccessToken(conn.refresh_token);
      if (!refreshed) {
        return new Response(JSON.stringify({ error: "Failed to refresh Google token. Reconnect Blogger." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = refreshed.access_token;
      const expiresAt = new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString();
      await admin.from("blogger_connections").update({
        access_token: accessToken,
        token_expires_at: expiresAt,
      }).eq("user_id", userId);
    }

    // Build labels from LSI
    const lsi = Array.isArray(article.lsi_keywords) ? article.lsi_keywords : [];
    const labels: string[] = lsi
      .map((x: any) => (typeof x === "string" ? x : x?.keyword || x?.term || ""))
      .filter((s: string) => s && s.length < 60)
      .slice(0, 10);

    const htmlContent = mdToHtml(article.content || "");
    const title = article.title || "Untitled";

    // Create or update Blogger post
    const isUpdate = !!article.blogger_post_id && article.blogger_blog_id === blogId;
    const url = isUpdate
      ? `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/${article.blogger_post_id}`
      : `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`;
    const method = isUpdate ? "PUT" : "POST";

    const bloggerRes = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "blogger#post",
        title,
        content: htmlContent,
        labels,
      }),
    });
    const bloggerData = await bloggerRes.json();
    if (!bloggerRes.ok) {
      return new Response(JSON.stringify({ error: bloggerData.error?.message || "Blogger API error", details: bloggerData }), {
        status: bloggerRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("articles").update({
      blogger_post_id: bloggerData.id,
      blogger_post_url: bloggerData.url,
      blogger_blog_id: blogId,
      published_url: bloggerData.url,
    }).eq("id", article_id);

    return new Response(JSON.stringify({
      success: true,
      post_id: bloggerData.id,
      url: bloggerData.url,
      is_update: isUpdate,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
