import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TelegraphNode {
  tag?: string;
  children?: (TelegraphNode | string)[];
}

function markdownToTelegraphNodes(md: string): TelegraphNode[] {
  const nodes: TelegraphNode[] = [];
  const lines = md.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("### ")) {
      nodes.push({ tag: "h4", children: [trimmed.slice(4)] });
    } else if (trimmed.startsWith("## ")) {
      nodes.push({ tag: "h3", children: [trimmed.slice(3)] });
    } else if (trimmed.startsWith("# ")) {
      nodes.push({ tag: "h3", children: [trimmed.slice(2)] });
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      nodes.push({ tag: "li", children: [trimmed.slice(2)] });
    } else {
      // Apply bold/italic
      let text = trimmed
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1");
      nodes.push({ tag: "p", children: [text] });
    }
  }

  return nodes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!
    ).auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { article_id, author_name } = await req.json();
    if (!article_id || typeof article_id !== "string") {
      throw new Error("article_id is required");
    }

    // Get article
    const { data: article } = await admin
      .from("articles")
      .select("title, content")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();

    if (!article) throw new Error("Статья не найдена");

    // Create Telegraph account (or use anonymous)
    const accountRes = await fetch("https://api.telegra.ph/createAccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        short_name: (author_name || "Author").slice(0, 32),
        author_name: (author_name || "Author").slice(0, 128),
      }),
    });

    const accountData = await accountRes.json();
    if (!accountData.ok) throw new Error("Не удалось создать аккаунт Telegraph");

    const accessToken = accountData.result.access_token;

    // Create page
    const content = markdownToTelegraphNodes(article.content || "");

    const pageRes = await fetch("https://api.telegra.ph/createPage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        title: (article.title || "Untitled").slice(0, 256),
        author_name: (author_name || "Author").slice(0, 128),
        content: content.length > 0 ? content : [{ tag: "p", children: ["Empty article"] }],
        return_content: false,
      }),
    });

    const pageData = await pageRes.json();
    if (!pageData.ok) throw new Error(`Telegraph error: ${JSON.stringify(pageData)}`);

    return new Response(JSON.stringify({
      success: true,
      url: pageData.result.url,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Telegraph publish error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
