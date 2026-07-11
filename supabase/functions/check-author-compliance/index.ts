import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatJson, AiError, aiErrorToResponse } from "../_shared/aiClient.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";
import { verifyAuth } from "../_shared/auth.ts";

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

const COMPLIANCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "verdict", "summary", "deviations", "matched_rules"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["pass", "warning", "fail"] },
    summary: { type: "string" },
    deviations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "category", "rule", "quote", "suggestion"],
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string" },
          rule: { type: "string" },
          quote: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
    matched_rules: { type: "array", items: { type: "string" } },
  },
} as const;

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
    const __auth = await verifyAuth(req);
    if (__auth instanceof Response) return __auth;
    const user = { id: __auth.userId };

    const body = await req.json();
    const content: string = (body.content || "").toString().trim();
    const author_profile_id: string | undefined = body.author_profile_id;

    if (!content || content.length < 100) {
      return new Response(JSON.stringify({ error: "Контент слишком короткий для проверки (мин. 100 символов)", error_key: "edge.authorComplianceShort" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!author_profile_id) {
      return new Response(JSON.stringify({ error: "Не указан профиль автора", error_key: "edge.authorComplianceNoProfile" }), {
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
      return new Response(JSON.stringify({ error: "Профиль автора не найден", error_key: "edge.authorComplianceNotFound" }), {
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

    const aiKey = Deno.env.get("OPENROUTER_API_KEY");
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

    let json;
    const tCheck = startTimer();
    try {
      json = await chatJson<ComplianceResult>({
        apiKey: aiKey,
        model,
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.2,
        maxTokens: 4000,
        timeoutMs: 45_000,
        schema: COMPLIANCE_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "AuthorCompliance",
        retries: 1,
        appTitle: "SEO-Modul Compliance",
      });
    } catch (e) {
      if (e instanceof AiError) {
        logPipelineEvent({
          stage: "compliance_check",
          user_id: user.id,
          verdict: "fail",
          model,
          duration_ms: tCheck(),
          error_kind: e.kind,
          error_message: e.message,
          meta: { author_id: author_profile_id },
        });
        return aiErrorToResponse(e, corsHeaders);
      }
      throw e;
    }
    const result = json.data;

    // Sanity defaults
    if (typeof result.score !== "number") result.score = 0;
    result.score = Math.max(0, Math.min(100, Math.round(result.score)));
    if (!result.verdict) {
      result.verdict = result.score >= 85 ? "pass" : result.score >= 60 ? "warning" : "fail";
    }
    if (!Array.isArray(result.deviations)) result.deviations = [];
    if (!Array.isArray(result.matched_rules)) result.matched_rules = [];

    logPipelineEvent({
      stage: "compliance_check",
      user_id: user.id,
      verdict: result.verdict,
      score: result.score,
      model: json.model,
      tokens_in: json.tokensIn,
      tokens_out: json.tokensOut,
      duration_ms: tCheck(),
      meta: {
        author_id: author_profile_id,
        deviations: result.deviations.length,
        high_severity: result.deviations.filter(d => d.severity === "high").length,
        retries: json.retries,
      },
    });

    await admin.from("usage_logs").insert({
      user_id: user.id,
      action: "check_author_compliance",
      model_used: model,
      tokens_used: json.tokensIn + json.tokensOut,
    });

    return new Response(JSON.stringify({ result, model_used: json.model, retries: json.retries }), {
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