// Admin-only A/B tester: takes a prompt + list of models, runs them in parallel
// through OpenRouter, then scores each output with the same gemini-2.5-flash-lite
// AI-detector used by quality-check. Returns a comparison table so admin can
// pick the model that produces least-AI-looking text.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function callOpenRouter(model: string, prompt: string, apiKey: string, ms = 90000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Module Model A/B Test",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Ты опытный SEO-копирайтер. Пишешь живой человечный текст: чередуешь короткие и длинные предложения, без клише, без канцелярита, без слов 'является', 'данный', 'таким образом'. Возвращай чистый HTML без markdown-обёрток." },
          { role: "user", content: prompt },
        ],
        temperature: 0.85,
        max_tokens: 2000,
      }),
    });
    const elapsedMs = Date.now() - t0;
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}`, elapsedMs };
    }
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content || "";
    return { ok: true, text, elapsedMs, tokens_in: data?.usage?.prompt_tokens || 0, tokens_out: data?.usage?.completion_tokens || 0 };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e), elapsedMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function scoreAI(plain: string, lovableKey: string): Promise<{ score: number; verdict: string; reasons: string[] } | null> {
  const sample = plain.slice(0, 5000);
  const sys = "Ты эксперт по детекции AI-текстов. Анализируешь perplexity, burstiness, повторы, предсказуемость. Выводи только результат через инструмент.";
  const user = `Оцени текст 0-100 насколько он написан человеком. 100 = точно человек, 0 = точно AI.\n\nТекст:\n${sample}`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        tools: [{
          type: "function",
          function: {
            name: "report_ai_score",
            parameters: {
              type: "object",
              properties: {
                score: { type: "number" },
                verdict: { type: "string" },
                reasons: { type: "array", items: { type: "string" } },
              },
              required: ["score", "verdict", "reasons"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_ai_score" } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    const p = JSON.parse(args);
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))),
      verdict: String(p.verdict || ""),
      reasons: Array.isArray(p.reasons) ? p.reasons.slice(0, 3).map(String) : [],
    };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const orKey = Deno.env.get("OPENROUTER_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!orKey) return json({ error: "OPENROUTER_API_KEY not configured" }, 500);
    if (!lovableKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const prompt: string = String(body?.prompt || "").trim();
    const models: string[] = Array.isArray(body?.models) ? body.models.slice(0, 6) : [];
    if (!prompt || prompt.length < 20) return json({ error: "prompt required (min 20 chars)" }, 400);
    if (models.length === 0) return json({ error: "models[] required" }, 400);

    const results = await Promise.all(models.map(async (model) => {
      const gen = await callOpenRouter(model, prompt, orKey);
      if (!gen.ok || !gen.text) {
        return { model, ok: false, error: gen.error || "empty", elapsedMs: gen.elapsedMs };
      }
      const plain = stripHtml(gen.text);
      const score = await scoreAI(plain, lovableKey);
      return {
        model,
        ok: true,
        elapsedMs: gen.elapsedMs,
        word_count: plain.split(/\s+/).filter(Boolean).length,
        ai_score: score?.score ?? null,
        verdict: score?.verdict ?? null,
        reasons: score?.reasons ?? [],
        preview: plain.slice(0, 400),
        tokens_in: gen.tokens_in,
        tokens_out: gen.tokens_out,
      };
    }));

    return json({ ok: true, results });
  } catch (e) {
    console.error("model-ab-test error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});