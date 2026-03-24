import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No auth");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Check PRO plan
    const { data: profile } = await admin.from("profiles").select("plan, gsc_json_key").eq("id", user.id).single();
    if (profile?.plan !== "pro") {
      return new Response(JSON.stringify({ error: "PRO plan required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url, article_id } = await req.json();
    if (!url) throw new Error("URL is required");

    const results: { provider: string; status: string; message: string }[] = [];

    // 1. Google Indexing API (if GSC key configured)
    if (profile.gsc_json_key) {
      try {
        // Decrypt GSC key
        const { data: decryptedKey, error: decErr } = await admin.rpc("decrypt_sensitive", { ciphertext: profile.gsc_json_key });
        const rawKey = decErr ? profile.gsc_json_key : (decryptedKey ?? profile.gsc_json_key);
        const keyData = JSON.parse(rawKey);
        const token = await getGoogleAccessToken(keyData);

        const googleResp = await fetch(
          "https://indexing.googleapis.com/v3/urlNotifications:publish",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url, type: "URL_UPDATED" }),
          }
        );
        const googleData = await googleResp.json();

        if (googleResp.ok) {
          results.push({ provider: "google", status: "success", message: `Published: ${googleData.urlNotificationMetadata?.latestUpdate?.notifyTime || "OK"}` });
        } else {
          results.push({ provider: "google", status: "error", message: googleData.error?.message || "Unknown Google error" });
        }
      } catch (e: any) {
        results.push({ provider: "google", status: "error", message: e.message });
      }
    } else {
      results.push({ provider: "google", status: "error", message: "GSC JSON key not configured" });
    }

    // 2. IndexNow (Yandex, Bing, etc.)
    try {
      const indexNowKey = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
      const parsedUrl = new URL(url);
      const indexNowResp = await fetch(
        `https://yandex.com/indexnow?url=${encodeURIComponent(url)}&key=${indexNowKey}`,
        { method: "GET" }
      );

      if (indexNowResp.ok || indexNowResp.status === 200 || indexNowResp.status === 202) {
        results.push({ provider: "indexnow", status: "success", message: `Submitted to IndexNow (status ${indexNowResp.status})` });
      } else {
        results.push({ provider: "indexnow", status: "error", message: `IndexNow HTTP ${indexNowResp.status}` });
      }
    } catch (e: any) {
      results.push({ provider: "indexnow", status: "error", message: e.message });
    }

    // Save logs
    for (const r of results) {
      await admin.from("indexing_logs").insert({
        user_id: user.id,
        article_id: article_id || null,
        url,
        provider: r.provider,
        status: r.status,
        response_message: r.message,
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Generate Google OAuth2 access token from service account JSON key
async function getGoogleAccessToken(keyData: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: keyData.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: any) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsignedToken = `${encode(header)}.${encode(payload)}`;

  // Import private key
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
