import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Get all pending scheduled posts that are due
    const { data: duePosts, error: fetchErr } = await admin
      .from("wp_scheduled_posts")
      .select("*, wordpress_sites(*), articles(title, content, meta_description)")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;
    if (!duePosts || duePosts.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const post of duePosts) {
      try {
        // Mark as processing
        await admin
          .from("wp_scheduled_posts")
          .update({ status: "processing" })
          .eq("id", post.id);

        const site = post.wordpress_sites;
        const article = post.articles;
        if (!site || !article) throw new Error("Missing site or article data");

        const { data: decryptedPw } = await admin.rpc("decrypt_sensitive", { ciphertext: site.app_password });
        if (!decryptedPw) throw new Error("Не удалось расшифровать пароль WP. Обратитесь в поддержку.");
        const plainPassword = decryptedPw;
        const wpAuth = btoa(`${site.username}:${plainPassword}`);
        const baseUrl = site.site_url.replace(/\/+$/, "");

        // Convert content (basic markdown to HTML)
        let htmlContent = (article.content || "")
          .replace(/^### (.+)$/gm, "<h3>$1</h3>")
          .replace(/^## (.+)$/gm, "<h2>$1</h2>")
          .replace(/^# (.+)$/gm, "<h1>$1</h1>")
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>")
          .replace(/^- (.+)$/gm, "<li>$1</li>");

        // Convert markdown tables
        const lines = htmlContent.split("\n");
        const resultLines: string[] = [];
        let i = 0;
        while (i < lines.length) {
          const line = lines[i].trim();
          if (
            line.startsWith("|") && line.endsWith("|") &&
            i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1].trim())
          ) {
            const headerCells = line.slice(1, -1).split("|").map((c: string) => c.trim());
            const headerRow = headerCells.map((c: string) => `<th>${c}</th>`).join("");
            i += 2;
            const bodyRows: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
              const cells = lines[i].trim().slice(1, -1).split("|").map((c: string) => c.trim());
              bodyRows.push(`<tr>${cells.map((c: string) => `<td>${c}</td>`).join("")}</tr>`);
              i++;
            }
            resultLines.push(
              `<!-- wp:table --><figure class="wp-block-table"><table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows.join("")}</tbody></table></figure><!-- /wp:table -->`
            );
          } else {
            resultLines.push(lines[i]);
            i++;
          }
        }
        htmlContent = resultLines.join("\n");

        // Wrap paragraphs
        htmlContent = htmlContent
          .split("\n\n")
          .map((block: string) => {
            const trimmed = block.trim();
            if (!trimmed || trimmed.startsWith("<!--") || trimmed.startsWith("<")) return trimmed;
            return `<!-- wp:paragraph -->\n<p>${trimmed}</p>\n<!-- /wp:paragraph -->`;
          })
          .filter(Boolean)
          .join("\n\n");

        const postData: any = {
          title: article.title || "Без названия",
          content: htmlContent,
          excerpt: article.meta_description || "",
          status: post.publish_immediately ? "publish" : "draft",
          categories: post.categories || [],
        };

        // SEO meta
        if (post.seo_plugin === "rank_math") {
          postData.meta = {};
          if (post.meta_title) postData.meta.rank_math_title = post.meta_title;
          if (post.meta_description) postData.meta.rank_math_description = post.meta_description;
        } else if (post.seo_plugin === "yoast") {
          postData.meta = {};
          if (post.meta_title) postData.meta._yoast_wpseo_title = post.meta_title;
          if (post.meta_description) postData.meta._yoast_wpseo_metadesc = post.meta_description;
        }

        const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${wpAuth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(postData),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`WP ${res.status}: ${errText}`);
        }

        const wpPost = await res.json();

        await admin
          .from("wp_scheduled_posts")
          .update({
            status: "published",
            wp_post_id: wpPost.id,
            wp_post_url: wpPost.link,
          })
          .eq("id", post.id);

        processed++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Failed to publish scheduled post ${post.id}:`, errMsg);
        await admin
          .from("wp_scheduled_posts")
          .update({ status: "failed", error_message: errMsg })
          .eq("id", post.id);
      }
    }

    return new Response(JSON.stringify({ processed, total: duePosts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-wp-schedule error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
