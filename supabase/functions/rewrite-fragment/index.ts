import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStealthSystemAddon, applyStealthPostProcess } from "../_shared/stealth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const fragment: string = (body.fragment || "").toString().trim();
    const scope: "sentence" | "paragraph" = body.scope === "paragraph" ? "paragraph" : "sentence";
    const author_profile_id: string | undefined = body.author_profile_id;
    const violations: Array<{ category: string; rule: string; suggestion?: string }> = Array.isArray(body.violations) ? body.violations : [];
    const context_before: string = (body.context_before || "").toString().slice(-600);
    const context_after: string = (body.context_after || "").toString().slice(0, 600);

    if (!fragment) {
      return new Response(JSON.stringify({ error: "Пустой фрагмент" }), {
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
      .select("id, name, voice_tone, system_instruction, stop_words, style_examples")
      .eq("id", author_profile_id)
      .maybeSingle();

    if (authorErr || !author) {
      return new Response(JSON.stringify({ error: "Профиль автора не найден" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemInstruction = (author.system_instruction || "").trim();
    const stopWords: string[] = Array.isArray(author.stop_words) ? author.stop_words : [];

    const { data: assignment } = await admin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "writer")
      .maybeSingle();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    const aiUrl = OPENROUTER_API_KEY
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiKey = OPENROUTER_API_KEY || LOVABLE_API_KEY;
    if (!aiKey) throw new Error("AI key not configured");

    const violationsText = violations.length
      ? violations.map((v, i) => `${i + 1}. [${v.category}] ${v.rule}${v.suggestion ? ` → ${v.suggestion}` : ""}`).join("\n")
      : "(не переданы — просто приведи фрагмент строго к инструкции автора)";

    const scopeLabel = scope === "paragraph" ? "АБЗАЦ" : "ПРЕДЛОЖЕНИЕ";

    const systemPrompt = `Ты — автор «${author.name}»${author.voice_tone ? ` с тоном «${author.voice_tone}»` : ""}.
Перепиши ${scopeLabel} строго по инструкции автора, исправив все указанные нарушения.
Сохрани смысл, факты и примерный объём. НЕ добавляй новые факты, НЕ выдумывай данные.
ИСПОЛЬЗУЙ HTML-теги, если они уместны (<p>, <strong>, <em>, <a>) — но только если они были в исходном фрагменте.
Верни ТОЛЬКО переписанный текст. Без пояснений, без префиксов, без кавычек вокруг.

${buildStealthSystemAddon(/[а-я]/i.test(fragment) ? "ru" : "en")}`;

    const userPrompt = `=== ИНСТРУКЦИЯ АВТОРА (закон) ===
${systemInstruction || "(не задана)"}
${stopWords.length ? `\nСТОП-СЛОВА (запрещены): ${stopWords.join(", ")}` : ""}
${author.style_examples ? `\nПРИМЕРЫ СТИЛЯ:\n${String(author.style_examples).slice(0, 1200)}` : ""}

=== НАРУШЕНИЯ, КОТОРЫЕ НУЖНО ИСПРАВИТЬ ===
${violationsText}

=== КОНТЕКСТ (для согласования стиля, НЕ переписывай его) ===
ДО: ${context_before || "(начало статьи)"}
ПОСЛЕ: ${context_after || "(конец статьи)"}

=== ${scopeLabel} ДЛЯ ПЕРЕПИСЫВАНИЯ ===
${fragment}

Верни ТОЛЬКО переписанный ${scopeLabel.toLowerCase()}.`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000);

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
        temperature: 0.5,
        max_tokens: 1200,
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
    let rewritten: string = (aiData?.choices?.[0]?.message?.content || "").toString().trim();
    // strip leading/trailing wrapping quotes if model added them
    rewritten = rewritten.replace(/^[«"'`]+|[»"'`]+$/g, "").trim();

    if (!rewritten) throw new Error("Пустой ответ ИИ");

    // Stealth post-process: enforce burstiness + clean forbidden chars.
    const ppLang = /[а-я]/i.test(rewritten) ? "ru" : "en";
    rewritten = applyStealthPostProcess(rewritten, ppLang);

    await admin.from("usage_logs").insert({
      user_id: user.id,
      action: "rewrite_fragment",
      model_used: model,
      tokens_used: aiData.usage?.total_tokens || 0,
    });

    return new Response(JSON.stringify({ rewritten, model_used: model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("rewrite-fragment error:", e);
    const msg = e instanceof Error
      ? (e.name === "AbortError" ? "Переписывание заняло слишком много времени" : e.message)
      : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : msg.includes("слишком много времени") ? 504 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});