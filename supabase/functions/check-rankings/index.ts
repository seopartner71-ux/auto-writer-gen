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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No auth");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: profile } = await admin
      .from("profiles")
      .select("gsc_json_key, gsc_site_url")
      .eq("id", user.id)
      .single();

    if (!profile?.gsc_json_key) {
      return new Response(JSON.stringify({ error: "GSC not configured", code: "NO_GSC" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const siteUrl = (profile as any).gsc_site_url;
    if (!siteUrl) {
      return new Response(JSON.stringify({ error: "GSC site URL not set", code: "NO_SITE" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decrypt key
    const { data: decryptedKey } = await admin.rpc("decrypt_sensitive", { ciphertext: profile.gsc_json_key });
    if (!decryptedKey) throw new Error("Не удалось расшифровать GSC ключ. Обратитесь в поддержку.");
    const keyData = JSON.parse(decryptedKey);

    const token = await getGoogleAccessToken(keyData, "https://www.googleapis.com/auth/webmasters.readonly");

    // Get user's published articles
    const { data: articles } = await admin
      .from("articles")
      .select("id, title, keyword, published_url, telegraph_url, blogger_post_url")
      .eq("user_id", user.id)
      .not("keyword", "is", null);

    if (!articles || articles.length === 0) {
      return new Response(JSON.stringify({ rankings: [], message: "No articles to track" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rankings: any[] = [];

    for (const a of articles) {
      const keyword = (a as any).keyword;
      if (!keyword) continue;

      try {
        const resp = await fetch(
          `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              startDate,
              endDate,
              dimensions: ["query", "page"],
              dimensionFilterGroups: [
                {
                  filters: [{ dimension: "query", operator: "contains", expression: keyword }],
                },
              ],
              rowLimit: 5,
            }),
          }
        );
        const data = await resp.json();
        if (resp.ok && data.rows && data.rows.length > 0) {
          const top = data.rows[0];
          const ranking = {
            user_id: user.id,
            article_id: a.id,
            keyword,
            position: top.position,
            clicks: top.clicks,
            impressions: top.impressions,
            ctr: top.ctr,
            url: top.keys?.[1] || a.published_url || a.telegraph_url || null,
          };
          await admin.from("article_rankings").insert(ranking);
          rankings.push({ ...ranking, title: (a as any).title });
        }
      } catch (e: any) {
        console.error(`Failed for keyword ${keyword}:`, e.message);
      }
    }

    return new Response(JSON.stringify({ rankings, checked: articles.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function getGoogleAccessToken(keyData: any, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: keyData.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsignedToken = `${encode(header)}.${encode(payload)}`;

  const pemContent = keyData.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${unsignedToken}.${signatureB64}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) throw new Error("Failed to get Google token: " + JSON.stringify(tokenData));
  return tokenData.access_token;
}