import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TestResult {
  provider: string;
  status: "valid" | "invalid" | "error";
  message: string;
}

async function testOpenAI(apiKey: string): Promise<TestResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { provider: "openai", status: "valid", message: "Key is valid" };
    if (res.status === 401) return { provider: "openai", status: "invalid", message: "Invalid API key" };
    return { provider: "openai", status: "error", message: `HTTP ${res.status}` };
  } catch (e) {
    return { provider: "openai", status: "error", message: String(e) };
  }
}

async function testAnthropic(apiKey: string): Promise<TestResult> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok || res.status === 200) return { provider: "anthropic", status: "valid", message: "Key is valid" };
    if (res.status === 401) return { provider: "anthropic", status: "invalid", message: "Invalid API key" };
    if (res.status === 429) return { provider: "anthropic", status: "valid", message: "Valid (rate limited)" };
    return { provider: "anthropic", status: "error", message: `HTTP ${res.status}` };
  } catch (e) {
    return { provider: "anthropic", status: "error", message: String(e) };
  }
}

async function testGemini(apiKey: string): Promise<TestResult> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (res.ok) return { provider: "gemini", status: "valid", message: "Key is valid" };
    if (res.status === 400 || res.status === 403) return { provider: "gemini", status: "invalid", message: "Invalid API key" };
    return { provider: "gemini", status: "error", message: `HTTP ${res.status}` };
  } catch (e) {
    return { provider: "gemini", status: "error", message: String(e) };
  }
}

async function testSerper(apiKey: string): Promise<TestResult> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: "test", num: 1 }),
    });
    if (res.ok) return { provider: "serper", status: "valid", message: "Key is valid" };
    if (res.status === 401 || res.status === 403) return { provider: "serper", status: "invalid", message: "Invalid API key" };
    return { provider: "serper", status: "error", message: `HTTP ${res.status}` };
  } catch (e) {
    return { provider: "serper", status: "error", message: String(e) };
  }
}

async function fetchErrorLogs(supabaseUrl: string, supabaseServiceKey: string, source: string) {
  const apiUrl = `${supabaseUrl}/analytics/v1/query`;
  const headers = {
    "Content-Type": "application/json",
    "apikey": supabaseServiceKey,
    "Authorization": `Bearer ${supabaseServiceKey}`,
  };

  let query = "";
  if (source === "db") {
    query = `select id, postgres_logs.timestamp, event_message, parsed.error_severity from postgres_logs
      cross join unnest(metadata) as m
      cross join unnest(m.parsed) as parsed
      where parsed.error_severity in ('ERROR', 'FATAL', 'PANIC', 'WARNING')
      order by timestamp desc
      limit 50`;
  } else if (source === "edge") {
    query = `select id, function_edge_logs.timestamp, event_message, response.status_code, m.function_id, m.execution_time_ms from function_edge_logs
      cross join unnest(metadata) as m
      cross join unnest(m.response) as response
      where response.status_code >= 400
      order by timestamp desc
      limit 50`;
  } else if (source === "auth") {
    query = `select id, auth_logs.timestamp, event_message, metadata.level, metadata.status, metadata.path, metadata.msg as msg, metadata.error from auth_logs
      cross join unnest(metadata) as metadata
      where metadata.error is not null or metadata.status::int >= 400
      order by timestamp desc
      limit 50`;
  }

  if (!query) return [];

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.error("Analytics query failed:", res.status, await res.text());
      return [];
    }

    const data = await res.json();
    const rows = data?.result || data || [];

    return rows.map((row: Record<string, unknown>, i: number) => {
      if (source === "db") {
        return {
          id: String(row.id || i),
          timestamp: String(row.timestamp || ""),
          message: String(row.event_message || ""),
          level: String(row.error_severity || "ERROR"),
          source: "PostgreSQL",
        };
      } else if (source === "edge") {
        return {
          id: String(row.id || i),
          timestamp: String(row.timestamp || ""),
          message: String(row.event_message || ""),
          level: Number(row.status_code) >= 500 ? "ERROR" : "WARNING",
          source: `Function ${String(row.function_id || "unknown").slice(0, 8)}`,
          details: `Status: ${row.status_code}, Time: ${row.execution_time_ms}ms`,
        };
      } else {
        return {
          id: String(row.id || i),
          timestamp: String(row.timestamp || ""),
          message: String(row.error || row.msg || row.event_message || ""),
          level: String(row.level || "error").toUpperCase(),
          source: `Auth ${row.path || ""}`,
          details: row.status ? `Status: ${row.status}` : undefined,
        };
      }
    });
  } catch (e) {
    console.error("Error fetching logs:", e);
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify admin role via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!anonKey) throw new Error("No anon key found");
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    // Check admin role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) throw new Error("Forbidden: admin role required");

    // Check if this is an error-logs request
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // No body = health check request
    }

    if (body.action === "error-logs") {
      const source = String(body.source || "db");
      const logs = await fetchErrorLogs(supabaseUrl, supabaseServiceKey, source);
      return new Response(JSON.stringify({ logs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Original health check logic
    const { data: keys, error: keysError } = await supabaseAdmin
      .from("api_keys")
      .select("*");

    if (keysError) throw new Error(`Failed to fetch keys: ${keysError.message}`);
    if (!keys || keys.length === 0) {
      return new Response(JSON.stringify({ results: [], message: "No API keys configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const testers: Record<string, (key: string) => Promise<TestResult>> = {
      openai: testOpenAI,
      anthropic: testAnthropic,
      gemini: testGemini,
      serper: testSerper,
    };

    const results: TestResult[] = [];
    for (const key of keys) {
      const tester = testers[key.provider];
      if (tester) {
        const result = await tester(key.api_key);
        results.push(result);

        await supabaseAdmin
          .from("api_keys")
          .update({
            is_valid: result.status === "valid",
            last_checked_at: new Date().toISOString(),
          })
          .eq("id", key.id);
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("health-check error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Forbidden") ? 403 : msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
