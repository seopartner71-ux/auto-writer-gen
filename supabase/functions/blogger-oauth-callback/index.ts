import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const htmlResponse = (msg: string, success: boolean, returnTo: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Blogger</title>
<style>
body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:1rem}
.box{max-width:400px}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 8px}
p{color:#888;font-size:14px;margin:0 0 24px}
a{display:inline-block;padding:10px 20px;background:#a855f7;color:#fff;text-decoration:none;border-radius:8px;font-size:14px}
</style></head>
<body><div class="box">
<div class="icon">${success ? "✅" : "❌"}</div>
<h1>${success ? "Blogger подключён" : "Ошибка подключения"}</h1>
<p>${msg}</p>
<a href="${returnTo || "/integrations"}">Вернуться</a>
</div>
<script>setTimeout(()=>{window.location.href="${returnTo || "/integrations"}"},2000)</script>
</body></html>`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  let returnTo = "/integrations";
  let userId = "";
  try {
    if (stateRaw) {
      const decoded = JSON.parse(atob(stateRaw));
      userId = decoded.user_id;
      returnTo = decoded.return_to || "/integrations";
    }
  } catch { /* ignore */ }

  if (error) {
    return new Response(htmlResponse(`Google вернул ошибку: ${error}`, false, returnTo), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (!code || !userId) {
    return new Response(htmlResponse("Отсутствует код авторизации или state", false, returnTo), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const clientId = Deno.env.get("GOOGLE_BLOGGER_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_BLOGGER_CLIENT_SECRET")!;
    const redirectUri = `${supabaseUrl}/functions/v1/blogger-oauth-callback`;

    // Exchange code -> tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return new Response(htmlResponse(tokenData.error_description || "Не удалось получить токен", false, returnTo), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const accessToken: string = tokenData.access_token;
    const refreshToken: string = tokenData.refresh_token || "";
    const expiresIn: number = tokenData.expires_in || 3600;

    // Fetch user email
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userInfo = await userInfoRes.json();
    const email = userInfo.email || null;

    // Fetch blogs
    const blogsRes = await fetch("https://www.googleapis.com/blogger/v3/users/self/blogs", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const blogsData = await blogsRes.json();
    const blogs = (blogsData.items || []).map((b: any) => ({ id: b.id, name: b.name, url: b.url }));

    // Save to DB (admin client)
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (!refreshToken) {
      // Try to keep old refresh token if exists
      const { data: existing } = await admin.from("blogger_connections").select("refresh_token").eq("user_id", userId).maybeSingle();
      if (!existing?.refresh_token) {
        return new Response(htmlResponse("Google не вернул refresh_token. Отзовите доступ в Google аккаунте и подключитесь заново.", false, returnTo), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

    const upsertPayload: any = {
      user_id: userId,
      google_email: email,
      access_token: accessToken,
      token_expires_at: expiresAt,
      blogs,
      default_blog_id: blogs[0]?.id || null,
      default_blog_name: blogs[0]?.name || null,
      updated_at: new Date().toISOString(),
    };
    if (refreshToken) upsertPayload.refresh_token = refreshToken;

    const { error: dbErr } = await admin.from("blogger_connections").upsert(upsertPayload, { onConflict: "user_id" });
    if (dbErr) {
      return new Response(htmlResponse(`Ошибка БД: ${dbErr.message}`, false, returnTo), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(htmlResponse(`Подключено: ${email}. Найдено блогов: ${blogs.length}`, true, returnTo), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    return new Response(htmlResponse(e instanceof Error ? e.message : "Unknown error", false, returnTo), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});
