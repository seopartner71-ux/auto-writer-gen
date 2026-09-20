// Canary-trap pixel for RAG archives published on GitHub Pages.
// Usage: <img src="https://<project>.supabase.co/functions/v1/track-bot?client=Name">
// Always returns a 1x1 transparent GIF; logs ONLY valuable AI/search crawler visits.
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

// Strict allowlist of valuable AI and standard search crawler signatures.
// Order matters: more specific signatures checked first so that, e.g.,
// "Google-Extended" is classified as Google AI before "Googlebot" matches
// it as Google Search.
// Each entry: [userAgent-needle (lowercase), display Bot Name].
const BOT_SIGNATURES: [string, string][] = [
  // --- AI Crawlers ---
  // OpenAI
  ["gptbot", "ChatGPT"],
  ["chatgpt-user", "ChatGPT"],
  ["oai-searchbot", "ChatGPT"],
  // Anthropic
  ["claudebot", "Claude"],
  // Perplexity
  ["perplexitybot", "Perplexity"],
  // Google AI (must precede Googlebot)
  ["google-extended", "Google AI"],
  // --- Standard Search Crawlers ---
  // Google Search (must come after google-extended)
  ["googlebot", "Google Search"],
  // Bing Search
  ["bingbot", "Bing Search"],
  // Yandex Search
  ["yandexbot", "Yandex Search"],
  ["yandexsearch", "Yandex Search"],
  ["yandexwebmaster", "Yandex Search"],
  // Apple Search
  ["applebot", "Apple Search"],
  // Mail.ru
  ["mail.ru_bot", "Mail.ru"],
];

/**
 * Returns the bot display name if the User-Agent matches a known
 * valuable crawler, otherwise returns null (skip the DB insert).
 */
function matchValuableBot(ua: string): string | null {
  const u = ua.toLowerCase();
  for (const [needle, name] of BOT_SIGNATURES) {
    if (u.includes(needle)) return name;
  }
  return null;
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

    const botName = matchValuableBot(ua);

    // Bouncer: only valuable AI/search crawlers get logged.
    // Humans, regular browsers, and unknown UAs always get the pixel
    // but are NOT written to the database.
    if (botName) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      // Fire and forget - never block the pixel response.
      supabase.from("bot_analytics_logs").insert({
        project_name: client,
        bot_name: botName,
        full_user_agent: ua,
        ip_address: ip.slice(0, 100),
      }).then(() => {}, () => {});
    }
  } catch (_e) {
    // ignore - pixel must always be served
  }
  return pixelResponse();
});
