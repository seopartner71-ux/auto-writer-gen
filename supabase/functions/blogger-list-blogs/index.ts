import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken: string) {
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
  if (!res.ok) return null;
  return { access_token: data.access_token as string, expires_in: data.expires_in as number };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
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

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: conn } = await admin.from("blogger_connections").select("*").eq("user_id", user.id).maybeSingle();
    if (!conn) {
      return new Response(JSON.stringify({ error: "Blogger not connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = conn.access_token;
    if (!conn.token_expires_at || new Date(conn.token_expires_at).getTime() < Date.now() + 60_000) {
      const refreshed = await refreshAccessToken(conn.refresh_token);
      if (!refreshed) {
        return new Response(JSON.stringify({ error: "Failed to refresh token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = refreshed.access_token;
      await admin.from("blogger_connections").update({
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString(),
      }).eq("user_id", user.id);
    }

    const blogsRes = await fetch("https://www.googleapis.com/blogger/v3/users/self/blogs", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const blogsData = await blogsRes.json();
    if (!blogsRes.ok) {
      return new Response(JSON.stringify({ error: blogsData.error?.message || "Blogger API error" }), {
        status: blogsRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const blogs = (blogsData.items || []).map((b: any) => ({ id: b.id, name: b.name, url: b.url }));

    await admin.from("blogger_connections").update({ blogs }).eq("user_id", user.id);

    return new Response(JSON.stringify({ blogs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
