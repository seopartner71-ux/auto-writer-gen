// Canary-trap pixel for RAG archives published on GitHub Pages.
// Usage: <img src="https://<project>.supabase.co/functions/v1/track-bot?client=Name">
// Always returns a 1x1 transparent GIF; logs LLM crawler visits.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

function pixelResponse() {
  return new Response(GIF_BYTES, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
}

function parseBot(ua: string): string {
  const u = ua.toLowerCase();
  if (u.includes("gptbot") || u.includes("oai-searchbot") || u.includes("chatgpt")) return "ChatGPT";
  if (u.includes("yandex")) return "Yandex";
  if (u.includes("claude") || u.includes("anthropic")) return "Claude";
  if (u.includes("google-extended") || u.includes("google-cloudvertexbot")) return "Google AI";
  if (u.includes("perplexity")) return "Perplexity";
  if (u.includes("bingbot") || u.includes("bingpreview")) return "Bing";
  if (u.includes("googlebot")) return "Googlebot";
  if (u.includes("ccbot")) return "CommonCrawl";
  if (u.includes("bytespider")) return "ByteDance";
  if (u.includes("meta-externalagent") || u.includes("facebookbot")) return "Meta AI";
  if (u.includes("applebot")) return "Apple";
  if (u.includes("mistral")) return "Mistral";
  return "Other/Unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const client = (url.searchParams.get("client") || url.searchParams.get("c") || "unknown").slice(0, 200);
    const ua = (req.headers.get("user-agent") || "").slice(0, 1000);
    const ip =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") ||
      "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fire and forget - never block the pixel response.
    supabase.from("bot_analytics_logs").insert({
      project_name: client,
      bot_name: parseBot(ua),
      full_user_agent: ua,
      ip_address: ip.slice(0, 100),
    }).then(() => {}, () => {});
  } catch (_e) {
    // ignore
  }
  return pixelResponse();
});
