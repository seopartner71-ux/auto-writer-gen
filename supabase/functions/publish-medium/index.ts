import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const { article_id } = await req.json();
    if (!article_id || typeof article_id !== "string") {
      throw new Error("article_id is required");
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("medium_token")
      .eq("id", user.id)
      .single();

    if (!profile?.medium_token) {
      throw new Error("Medium не настроен. Добавьте Integration Token в Интеграциях.");
    }

    const { data: article } = await admin
      .from("articles")
      .select("title, content, meta_description")
      .eq("id", article_id)
      .eq("user_id", user.id)
      .single();

    if (!article) throw new Error("Статья не найдена");

    const meRes = await fetch("https://api.medium.com/v1/me", {
      headers: { Authorization: `Bearer ${profile.medium_token}` },
    });

    if (!meRes.ok) {
      await meRes.text();
      throw new Error(`Medium auth failed [${meRes.status}]. Проверьте токен.`);
    }

    const meData = await meRes.json();
    const userId = meData.data?.id;
    if (!userId) throw new Error("Не удалось получить ID пользователя Medium");

    const postRes = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.medium_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: article.title || "Untitled",
        contentFormat: "markdown",
        content: article.content || "",
        publishStatus: "draft",
      }),
    });

    if (!postRes.ok) {
      const errText = await postRes.text();
      throw new Error(`Medium API error [${postRes.status}]: ${errText}`);
    }

    const postData = await postRes.json();
    const postUrl = postData.data?.url || "";

    // Log publish action
    await admin.from("usage_logs").insert({
      user_id: user.id,
      action: "publish_medium",
    });

    return new Response(JSON.stringify({ success: true, url: postUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Medium publish error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
