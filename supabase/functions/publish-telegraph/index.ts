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
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)|<a\s+href=['"]([^'"]+)['"]>([^<]+)<\/a>/g;
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
    } else if (match[6] && match[7]) {
      // HTML <a> tag support
      result.push({ tag: "a", attrs: { href: match[6] }, children: [match[7]] });
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

    if (!trimmed || trimmed === "---" || trimmed === "```") {
      i++;
      continue;
    }

    if (trimmed.startsWith("```")) {
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) i++;
      i++;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const tag = level <= 2 ? "h3" : "h4";
      nodes.push({ tag, children: inlineFormat(text) });
      i++;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      nodes.push({ tag: "blockquote", children: [{ tag: "p", children: inlineFormat(quoteLines.join(" ")) }] });
      continue;
    }

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

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        if (/^[\s|:-]+$/.test(row)) {
          i++;
          continue;
        }
        const cells = row.split("|").filter(c => c.trim()).map(c => c.trim());
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        const headerRow = tableRows[0];
        nodes.push({ tag: "p", children: [{ tag: "strong", children: [headerRow.join(" | ")] }] });
        for (let r = 1; r < tableRows.length; r++) {
          nodes.push({ tag: "p", children: [tableRows[r].join(" | ")] });
        }
        nodes.push({ tag: "br" });
      }
      continue;
    }

    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      nodes.push({ tag: "img", attrs: { src: imgMatch[2] }, children: [] });
      if (imgMatch[1]) {
        nodes.push({ tag: "figcaption", children: [imgMatch[1]] });
      }
      i++;
      continue;
    }

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
    const anchor_links: { url: string; anchor: string }[] = body?.anchor_links || [];
    const lang = body?.lang || "ru";

    if (!article_id || typeof article_id !== "string") {
      throw new Error("article_id is required");
    }

    // Get article
    const { data: article, error: articleError } = await admin
      .from("articles")
      .select("title, content, telegraph_path, telegraph_url, anchor_target_url")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();

    if (articleError || !article) throw new Error(lang === "ru" ? "Статья не найдена" : "Article not found");

    // Get telegraph token from separate secure table
    const { data: tokenRow } = await admin
      .from("article_telegraph_tokens")
      .select("access_token")
      .eq("article_id", article_id)
      .single();
    // Parse saved anchor links if no body links provided
    let effectiveLinks = anchor_links;
    if (!effectiveLinks.length && (article as any).anchor_target_url) {
      try { effectiveLinks = JSON.parse((article as any).anchor_target_url); } catch { effectiveLinks = []; }
    }

    // Build content nodes
    const content = markdownToTelegraphNodes(article.content || "");
    const safeContent = content.length > 0 ? content : [{ tag: "p", children: ["Empty article"] }];

    // Add canonical link at bottom if anchor links available
    const firstUrl = effectiveLinks.find(l => l.url)?.url;
    if (firstUrl) {
      // Сноска должна быть на языке САМОЙ статьи, а не UI.
      // На Telegra.ph часто публикуют англоязычный контент — русская подпись там
      // выглядит как ошибка перевода.
      const articleIsRussian = /[а-яА-Я]/.test((article.title || "") + " " + (article.content || "").slice(0, 2000));
      const captionLabel = articleIsRussian ? "Оригинал статьи: " : "Original article: ";
      safeContent.push({ tag: "br" });
      safeContent.push({
        tag: "p",
        children: [
          { tag: "em", children: [
            captionLabel,
            { tag: "a", attrs: { href: firstUrl }, children: [firstUrl] }
          ]}
        ]
      });
    }

    const existingPath = (article as any).telegraph_path;
    const existingToken = tokenRow?.access_token;
    let resultUrl: string;
    let resultPath: string;
    let resultToken: string;
    let isUpdate = false;

    if (existingPath && existingToken) {
      // Edit existing page
      isUpdate = true;
      const editRes = await fetch("https://api.telegra.ph/editPage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: existingToken,
          path: existingPath,
          title: (article.title || "Untitled").slice(0, 256),
          author_name: author_name.slice(0, 128),
          content: safeContent,
          return_content: false,
        }),
      });

      const editData = await editRes.json();
      if (!editData.ok) {
        console.error("Telegraph editPage error:", JSON.stringify(editData));
        // If edit fails (e.g. token expired), create new page
        const fallback = await createNewPage(author_name, article.title, safeContent);
        resultUrl = fallback.url;
        resultPath = fallback.path;
        resultToken = fallback.token;
        isUpdate = false;
      } else {
        resultUrl = editData.result.url;
        resultPath = existingPath;
        resultToken = existingToken;
      }
    } else {
      // Create new page
      const created = await createNewPage(author_name, article.title, safeContent);
      resultUrl = created.url;
      resultPath = created.path;
      resultToken = created.token;
    }

    // Save telegraph data - path/url to articles, token to secure table
    await admin.from("articles").update({
      telegraph_path: resultPath,
      telegraph_url: resultUrl,
    } as any).eq("id", article_id);

    // Upsert token in secure table
    await admin.from("article_telegraph_tokens").upsert({
      article_id,
      access_token: resultToken,
    }, { onConflict: "article_id" });

    // Log publish action
    await admin.from("usage_logs").insert({
      user_id: user.id,
      action: "publish_telegraph",
    });

    return new Response(JSON.stringify({
      success: true,
      url: resultUrl,
      is_update: isUpdate,
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

async function createNewPage(authorName: string, title: string | null, content: TNode[]): Promise<{ url: string; path: string; token: string }> {
  // Create Telegraph account
  const accountRes = await fetch("https://api.telegra.ph/createAccount", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      short_name: authorName.slice(0, 32),
      author_name: authorName.slice(0, 128),
    }),
  });

  const accountData = await accountRes.json();
  if (!accountData.ok) {
    console.error("Telegraph account error:", JSON.stringify(accountData));
    throw new Error("Failed to create Telegraph account");
  }

  const accessToken = accountData.result.access_token;

  const pageRes = await fetch("https://api.telegra.ph/createPage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: accessToken,
      title: (title || "Untitled").slice(0, 256),
      author_name: authorName.slice(0, 128),
      content,
      return_content: false,
    }),
  });

  const pageData = await pageRes.json();
  if (!pageData.ok) {
    console.error("Telegraph page error:", JSON.stringify(pageData));
    throw new Error(`Telegraph error: ${pageData.error || "Unknown"}`);
  }

  return {
    url: pageData.result.url,
    path: pageData.result.path,
    token: accessToken,
  };
}
