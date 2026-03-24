import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sign } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function markdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!
    ).auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { article_id } = await req.json();
    if (!article_id || typeof article_id !== "string") {
      throw new Error("article_id is required");
    }

    // Get profile with Ghost credentials
    const { data: profile } = await admin
      .from("profiles")
      .select("ghost_url, ghost_api_key")
      .eq("id", user.id)
      .single();

    if (!profile?.ghost_url || !profile?.ghost_api_key) {
      throw new Error("Ghost не настроен. Добавьте URL и API-ключ в настройках.");
    }

    // Get article
    const { data: article } = await admin
      .from("articles")
      .select("title, content, meta_description")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();

    if (!article) throw new Error("Статья не найдена");

    // Create Ghost Admin API JWT
    const [id, secret] = profile.ghost_api_key.split(":");
    if (!id || !secret) throw new Error("Неверный формат Ghost API ключа (ожидается id:secret)");

    const keyBytes = new Uint8Array(secret.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const iat = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT", kid: id };
    const payload = { iat, exp: iat + 300, aud: "/admin/" };

    const jwt = await sign(payload, key, header.alg);

    // Publish to Ghost
    const ghostUrl = profile.ghost_url.replace(/\/$/, "");
    const htmlContent = markdownToHtml(article.content || "");

    const ghostRes = await fetch(`${ghostUrl}/ghost/api/admin/posts/?source=html`, {
      method: "POST",
      headers: {
        Authorization: `Ghost ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        posts: [
          {
            title: article.title || "Untitled",
            html: htmlContent,
            meta_description: article.meta_description || "",
            status: "draft",
          },
        ],
      }),
    });

    if (!ghostRes.ok) {
      const errText = await ghostRes.text();
      throw new Error(`Ghost API error [${ghostRes.status}]: ${errText}`);
    }

    const result = await ghostRes.json();
    const postUrl = result.posts?.[0]?.url || "";

    return new Response(JSON.stringify({ success: true, url: postUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Ghost publish error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
