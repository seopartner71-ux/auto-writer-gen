import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { article_id, project_id } = await req.json();
    if (!article_id || !project_id) {
      return new Response(JSON.stringify({ error: "Missing article_id or project_id" }), { status: 400, headers: corsHeaders });
    }

    // Get article
    const { data: article, error: artErr } = await supabase
      .from("articles")
      .select("title, content, meta_description, keywords")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();
    if (artErr || !article) {
      return new Response(JSON.stringify({ error: "Article not found" }), { status: 404, headers: corsHeaders });
    }

    // Get GitHub config
    const { data: config } = await supabase.rpc("get_project_github_config", { p_project_id: project_id });
    if (!config || !config.configured) {
      return new Response(JSON.stringify({ error: "GitHub not configured for this project" }), { status: 400, headers: corsHeaders });
    }

    const { github_token, github_repo } = config;

    // Build markdown with frontmatter
    const slug = (article.title || "untitled")
      .toLowerCase()
      .replace(/[^a-zа-яё0-9\s-]/gi, "")
      .replace(/\s+/g, "-")
      .substring(0, 80);
    const date = new Date().toISOString().split("T")[0];
    const filename = `src/content/blog/${slug}.md`;

    const frontmatter = [
      "---",
      `title: "${(article.title || "").replace(/"/g, '\\"')}"`,
      `description: "${(article.meta_description || "").replace(/"/g, '\\"')}"`,
      `date: "${date}"`,
      article.keywords?.length ? `keywords: [${article.keywords.map((k: string) => `"${k}"`).join(", ")}]` : "",
      "---",
      "",
    ].filter(Boolean).join("\n");

    const fileContent = frontmatter + (article.content || "");
    const encodedContent = btoa(unescape(encodeURIComponent(fileContent)));

    // Check if file exists (for update)
    let sha: string | undefined;
    try {
      const checkRes = await fetch(`https://api.github.com/repos/${github_repo}/contents/${filename}`, {
        headers: { Authorization: `token ${github_token}`, Accept: "application/vnd.github.v3+json" },
      });
      if (checkRes.ok) {
        const existing = await checkRes.json();
        sha = existing.sha;
      }
    } catch { /* file doesn't exist, that's fine */ }

    // Create/update file via GitHub API
    const body: Record<string, unknown> = {
      message: `Add article: ${article.title || slug}`,
      content: encodedContent,
      branch: "main",
    };
    if (sha) body.sha = sha;

    const ghRes = await fetch(`https://api.github.com/repos/${github_repo}/contents/${filename}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${github_token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!ghRes.ok) {
      const errBody = await ghRes.text();
      console.error("GitHub API error:", errBody);
      return new Response(JSON.stringify({ error: `GitHub API error: ${ghRes.status}` }), { status: 500, headers: corsHeaders });
    }

    const ghData = await ghRes.json();

    // Get project domain for URL
    const { data: project } = await supabase.from("projects").select("domain").eq("id", project_id).single();
    const siteUrl = project?.domain
      ? `https://${project.domain.replace(/^https?:\/\//, "")}/blog/${slug}`
      : ghData.content?.html_url || "";

    // Update article status
    await supabase
      .from("articles")
      .update({ status: "published", published_url: siteUrl })
      .eq("id", article_id);

    return new Response(JSON.stringify({ success: true, url: siteUrl, github_url: ghData.content?.html_url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("publish-github error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: corsHeaders });
  }
});
