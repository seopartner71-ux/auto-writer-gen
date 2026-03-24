import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TNode {
  tag?: string;
  attrs?: Record<string, string>;
  children?: (TNode | string)[];
}

function inlineFormat(text: string): (TNode | string)[] {
  const result: (TNode | string)[] = [];
  // Process bold, italic, links, inline code
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      result.push({ tag: "strong", children: [match[1]] });
    } else if (match[2]) {
      result.push({ tag: "em", children: [match[2]] });
    } else if (match[3]) {
      result.push({ tag: "code", children: [match[3]] });
    } else if (match[4] && match[5]) {
      result.push({ tag: "a", attrs: { href: match[5] }, children: [match[4]] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

function markdownToTelegraphNodes(md: string): TNode[] {
  const nodes: TNode[] = [];
  const lines = md.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines, code fences, horizontal rules
    if (!trimmed || trimmed === "---" || trimmed === "```") {
      i++;
      continue;
    }

    // Skip code block content
    if (trimmed.startsWith("```")) {
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) i++;
      i++;
      continue;
    }

    // Headings - Telegraph supports h3 and h4 only
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      // H1/H2 → h3, H3+ → h4
      const tag = level <= 2 ? "h3" : "h4";
      nodes.push({ tag, children: inlineFormat(text) });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      nodes.push({ tag: "blockquote", children: [{ tag: "p", children: inlineFormat(quoteLines.join(" ")) }] });
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(trimmed)) {
      const items: TNode[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, "");
        items.push({ tag: "li", children: inlineFormat(itemText) });
        i++;
      }
      nodes.push({ tag: "ul", children: items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items: TNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, "");
        items.push({ tag: "li", children: inlineFormat(itemText) });
        i++;
      }
      nodes.push({ tag: "ol", children: items });
      continue;
    }

    // Table - convert to formatted text since Telegraph doesn't support tables
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        // Skip separator rows
        if (/^[\s|:-]+$/.test(row)) {
          i++;
          continue;
        }
        const cells = row.split("|").filter(c => c.trim()).map(c => c.trim());
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        // Header as bold
        const headerRow = tableRows[0];
        nodes.push({ tag: "p", children: [{ tag: "strong", children: [headerRow.join(" | ")] }] });
        // Data rows
        for (let r = 1; r < tableRows.length; r++) {
          nodes.push({ tag: "p", children: [tableRows[r].join(" | ")] });
        }
        // Add spacing
        nodes.push({ tag: "br" });
      }
      continue;
    }

    // Image
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      nodes.push({ tag: "img", attrs: { src: imgMatch[2] }, children: [] });
      if (imgMatch[1]) {
        nodes.push({ tag: "figcaption", children: [imgMatch[1]] });
      }
      i++;
      continue;
    }

    // Regular paragraph
    nodes.push({ tag: "p", children: inlineFormat(trimmed) });
    i++;
  }

  return nodes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    const body = await req.json();
    const article_id = body?.article_id;
    const author_name = body?.author_name || "Author";

    if (!article_id || typeof article_id !== "string") {
      throw new Error("article_id is required");
    }

    // Get article
    const { data: article, error: articleError } = await admin
      .from("articles")
      .select("title, content")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();

    if (articleError || !article) throw new Error("Статья не найдена");

    // Create Telegraph account
    const accountRes = await fetch("https://api.telegra.ph/createAccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        short_name: author_name.slice(0, 32),
        author_name: author_name.slice(0, 128),
      }),
    });

    const accountData = await accountRes.json();
    if (!accountData.ok) {
      console.error("Telegraph account error:", JSON.stringify(accountData));
      throw new Error("Не удалось создать аккаунт Telegraph");
    }

    const accessToken = accountData.result.access_token;

    // Create page
    const content = markdownToTelegraphNodes(article.content || "");
    const safeContent = content.length > 0 ? content : [{ tag: "p", children: ["Empty article"] }];

    const pageRes = await fetch("https://api.telegra.ph/createPage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        title: (article.title || "Untitled").slice(0, 256),
        author_name: author_name.slice(0, 128),
        content: safeContent,
        return_content: false,
      }),
    });

    const pageData = await pageRes.json();
    if (!pageData.ok) {
      console.error("Telegraph page error:", JSON.stringify(pageData));
      throw new Error(`Telegraph error: ${pageData.error || "Unknown"}`);
    }

    // Log publish action
    await admin.from("usage_logs").insert({
      user_id: user.id,
      action: "publish_telegraph",
    });

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
