// Edge proxy + telemetry for machine-readable benchmark files.
// Usage:
//   /functions/v1/log-bot-access?repo=https://user.github.io/repo&file=llms.txt&client=Name
// Logs the visit into bot_analytics_logs and streams the real file from GitHub Pages.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Order matters: specific signatures before generic ones.
const BOT_SIGNATURES: [string, string][] = [
  ["gptbot", "GPTBot"],
  ["chatgpt-user", "GPTBot"],
  ["oai-searchbot", "GPTBot"],
  ["claudebot", "ClaudeBot"],
  ["anthropic-ai", "ClaudeBot"],
  ["perplexitybot", "PerplexityBot"],
  ["google-extended", "Google AI"],
  ["googlebot", "Google Search"],
  ["bingbot", "Bing Search"],
  ["yandexbot", "YandexBot"],
  ["yandexsearch", "YandexBot"],
  ["applebot", "Apple Search"],
  ["mail.ru_bot", "Mail.ru"],
  ["ccbot", "CCBot"],
  ["bytespider", "Bytespider"],
  ["meta-externalagent", "Meta AI"],
];

function matchBot(ua: string): string | null {
  const u = ua.toLowerCase();
  for (const [needle, name] of BOT_SIGNATURES) if (u.includes(needle)) return name;
  return null;
}

/** Allow only simple relative file names inside the published archive. */
function safeFile(raw: string): string | null {
  const f = raw.trim().replace(/^\/+/, "");
  if (!f || f.length > 160) return null;
  if (f.includes("..") || f.includes("://") || f.includes("\\")) return null;
  if (!/^[\w./-]+$/.test(f)) return null;
  return f;
}

/** Accepts a full GitHub Pages URL or an "owner/repo" pair. */
function repoBase(raw: string): { base: string; name: string } | null {
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (!/\.github\.io$/i.test(u.hostname) && !/\.pages\.dev$/i.test(u.hostname)) return null;
      const name = (u.pathname.replace(/^\/+/, "") || u.hostname).replace(/\/+$/, "");
      return { base: `${u.origin}${u.pathname}`.replace(/\/+$/, ""), name };
    } catch {
      return null;
    }
  }
  const m = v.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { base: `https://${m[1]}.github.io/${m[2]}`, name: `${m[1]}/${m[2]}` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const file = safeFile(url.searchParams.get("file") || url.searchParams.get("f") || "llms.txt");
  const repo = repoBase(url.searchParams.get("repo") || "");
  const client = (url.searchParams.get("client") || url.searchParams.get("c") || "unknown").slice(0, 200);
  const ua = (req.headers.get("user-agent") || "").slice(0, 1000);
  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "";

  if (!file) {
    return new Response(JSON.stringify({ error: "Invalid file parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!repo) {
    return new Response(JSON.stringify({ error: "Invalid or missing repo parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Telemetry: log every visit (bot name falls back to a generic label).
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from("bot_analytics_logs").insert({
      project_name: client,
      bot_name: matchBot(ua) ?? "Other / Unknown",
      full_user_agent: ua,
      ip_address: ip.slice(0, 100),
      requested_file: file,
      repository_name: repo.name,
    });
  } catch (e) {
    console.error("[log-bot-access] log insert failed:", e instanceof Error ? e.message : e);
  }

  // Proxy the real static file, preserving Content-Type.
  const target = `${repo.base}/${file}`;
  try {
    const upstream = await fetch(target, {
      headers: { "User-Agent": ua || "Mozilla/5.0 (compatible; rag-proxy/1.0)" },
      redirect: "follow",
    });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Proxied-From": target,
      },
    });
  } catch (e) {
    console.error(`[log-bot-access] upstream fetch failed for ${target}:`, e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: "Upstream file unavailable", target }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
