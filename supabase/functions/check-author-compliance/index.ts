import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ComplianceResult = {
  score: number; // 0-100
  verdict: "pass" | "warning" | "fail";
  summary: string;
  deviations: Array<{
    severity: "high" | "medium" | "low";
    category: string; // e.g. "стиль", "запрет", "формат", "тон"
    rule: string; // что нарушено (из промта автора)
    quote: string; // цитата из статьи
    suggestion: string; // как исправить
  }>;
  matched_rules: string[]; // правила, которые соблюдены
};

function extractJson(aiData: any): ComplianceResult {
  const toolArgs = aiData?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (toolArgs) {
    try { return JSON.parse(toolArgs); } catch { return parseLoose(toolArgs) as ComplianceResult; }
  }
  const raw = aiData?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("Empty AI response");
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a !== -1 && b !== -1) cleaned = cleaned.slice(a, b + 1);
  try { return JSON.parse(cleaned); } catch { return parseLoose(cleaned) as ComplianceResult; }
}

function parseLoose(s: string): unknown {
  // strip control chars, trailing commas, then try again
  let t = s.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, "")
           .replace(/,\s*}/g, "}")
           .replace(/,\s*]/g, "]");
  try { return JSON.parse(t); } catch {}
  // try to repair by truncating to last valid bracket and closing structures
  // walk and track depth, ignoring chars inside strings
  let depth = 0; let inStr = false; let esc = false; let lastSafe = -1;
  const stack: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") { stack.push(c); depth++; }
    else if (c === "}" || c === "]") { stack.pop(); depth--; if (depth === 0) lastSafe = i; }
    else if (c === "," && depth > 0) lastSafe = i - 1;
  }
  // cut at last safe element boundary, drop trailing comma, close open brackets
  let cut = lastSafe > 0 ? t.slice(0, lastSafe + 1) : t;
  cut = cut.replace(/,\s*$/, "");
  // close remaining open brackets
  // recompute open brackets
  const open: string[] = [];
  inStr = false; esc = false;
  for (let i = 0; i < cut.length; i++) {
    const c = cut[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") open.push(c);
    else if (c === "}" || c === "]") open.pop();
  }
  if (inStr) cut += '"';
  while (open.length) { const o = open.pop(); cut += o === "{" ? "}" : "]"; }
  return JSON.parse(cut);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const content: string = (body.content || "").toString().trim();
    const author_profile_id: string | undefined = body.author_profile_id;

    if (!content || content.length < 100) {
      return new Response(JSON.stringify({ error: "Контент слишком короткий для проверки (мин. 100 символов)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!author_profile_id) {
      return new Response(JSON.stringify({ error: "Не указан профиль автора" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: author, error: authorErr } = await admin
      .from("author_profiles")
      .select("id, name, type, system_instruction, voice_tone, stop_words, style_examples, description")
      .eq("id", author_profile_id)
      .maybeSingle();

    if (authorErr || !author) {
      return new Response(JSON.stringify({ error: "Профиль автора не найден" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemInstruction = (author.system_instruction || "").trim();
    if (!systemInstruction) {
      return new Response(JSON.stringify({
        result: {
          score: 100,
          verdict: "pass",
          summary: "У автора не задан системный промт — проверять не на что.",
          deviations: [],
          matched_rules: [],
        } as ComplianceResult,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Routing
    const { data: assignment } = await admin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "fact_checker")
      .maybeSingle();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const aiUrl = OPENROUTER_API_KEY
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiKey = OPENROUTER_API_KEY || LOVABLE_API_KEY;
    if (!aiKey) throw new Error("AI key not configured");

    const stopWords: string[] = Array.isArray(author.stop_words) ? author.stop_words : [];

    const sample = content.length > 18000 ? content.slice(0, 18000) + "\n\n[...текст обрезан для анализа...]" : content;

    const systemPrompt = `Ты — строгий редактор-аудитор. Проверяешь, соответствует ли статья ИНСТРУКЦИИ АВТОРА.
Твоя задача — найти ОТКЛОНЕНИЯ от инструкции (стиль, запреты, формат, тон, структура, лексика).
Будь объективен. Цитируй конкретные фрагменты из статьи. Не выдумывай нарушения — только то, что реально есть.
Возвращай ТОЛЬКО JSON по схеме:
{
  "score": <число 0-100, где 100 = полное соответствие>,
  "verdict": "pass" | "warning" | "fail",
  "summary": "<1-2 предложения по-русски>",
  "deviations": [
    {
      "severity": "high" | "medium" | "low",
      "category": "<стиль|запрет|формат|тон|лексика|структура>",
      "rule": "<какое правило из промта нарушено>",
      "quote": "<точная цитата из статьи, до 200 симв>",
      "suggestion": "<как исправить, кратко>"
    }
  ],
  "matched_rules": ["<правило 1, которое соблюдено>", "..."]
}
Правила оценки:
- score >= 85 → verdict "pass"
- score 60-84 → "warning"
- score < 60 → "fail"
- Каждое нарушение severity:high снижает score на 15-25, medium на 7-12, low на 2-5.
- Если нарушений нет — deviations: [].`;

    const userPrompt = `АВТОР: ${author.name}${author.voice_tone ? ` (тон: ${author.voice_tone})` : ""}

=== ИНСТРУКЦИЯ АВТОРА (это закон, по нему сверяй) ===
${systemInstruction}
${stopWords.length ? `\nСТОП-СЛОВА (нельзя использовать): ${stopWords.join(", ")}` : ""}
${author.style_examples ? `\nПРИМЕРЫ СТИЛЯ:\n${String(author.style_examples).slice(0, 1500)}` : ""}

=== СТАТЬЯ ДЛЯ ПРОВЕРКИ ===
${sample}

Верни строго JSON.`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);

    const resp = await fetch(aiUrl, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      }),
    });
    clearTimeout(timer);

    if (!resp.ok) {
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит запросов, попробуйте позже" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI-кредиты исчерпаны" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const txt = await resp.text();
      console.error("AI error", resp.status, txt);
      throw new Error(`AI gateway error: ${resp.status}`);
    }

    const aiData = await resp.json();
    const result = extractJson(aiData);

    // Sanity defaults
    if (typeof result.score !== "number") result.score = 0;
    result.score = Math.max(0, Math.min(100, Math.round(result.score)));
    if (!result.verdict) {
      result.verdict = result.score >= 85 ? "pass" : result.score >= 60 ? "warning" : "fail";
    }
    if (!Array.isArray(result.deviations)) result.deviations = [];
    if (!Array.isArray(result.matched_rules)) result.matched_rules = [];

    await admin.from("usage_logs").insert({
      user_id: user.id,
      action: "check_author_compliance",
      model_used: model,
      tokens_used: aiData.usage?.total_tokens || 0,
    });

    return new Response(JSON.stringify({ result, model_used: model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("check-author-compliance error:", e);
    const msg = e instanceof Error
      ? (e.name === "AbortError" ? "Проверка заняла слишком много времени" : e.message)
      : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : msg.includes("слишком много времени") ? 504 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});