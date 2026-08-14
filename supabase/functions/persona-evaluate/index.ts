// Persona Engine: Evaluation Engine.
// Сравнивает готовый текст с Persona DNA (а не с предыдущей статьёй - анти-дрейф).
// Additive: новая функция.

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson } from "../_shared/aiClient.ts";

const MODEL = "anthropic/claude-sonnet-4";

const SYSTEM = `Ты аудитор соответствия текста заданному цифровому автору.
Ты сравниваешь ожидаемую Persona DNA с фактически сгенерированным текстом.
Ты не переписываешь текст и не оцениваешь его "красоту".
Ты диагност: находишь отклонения и объясняешь их наблюдаемыми признаками.
Эталон - только Persona DNA. Предыдущие статьи эталоном не являются.
Пиши на русском, без буквы ё, без длинного тире, без жирного шрифта.`;

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const personaId = String(body?.persona_id || "").trim();
    const text = String(body?.text || "").trim();
    const task = String(body?.task || "").trim() || null;
    const articleId = body?.article_id ? String(body.article_id) : null;
    const persist = body?.persist !== false;
    if (!personaId) return jsonResponse({ error: "persona_id required" }, 400);
    if (text.length < 100) return jsonResponse({ error: "Текст слишком короткий для оценки" }, 400);

    const admin = adminClient();
    const { data: persona } = await admin
      .from("personas")
      .select("id, user_id, name, persona_dna, style_dna, style_fingerprint")
      .eq("id", personaId)
      .maybeSingle();
    if (!persona || persona.user_id !== auth.userId) return jsonResponse({ error: "Персона не найдена" }, 404);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return jsonResponse({ error: "AI не настроен" }, 500);

    const { data: negatives } = await admin
      .from("persona_style_examples")
      .select("kind, reason, content")
      .eq("persona_id", personaId)
      .limit(10);

    const refs = (negatives || []).map((n: any) =>
      `[${n.kind === "negative" ? "неудачный" : "эталонный"}]${n.reason ? ` причина: ${n.reason};` : ""} фрагмент: ${String(n.content).slice(0, 800)}`
    ).join("\n\n");

    const user = `PERSONA DNA:\n${JSON.stringify(persona.persona_dna).slice(0, 12000)}

STYLE DNA:\n${JSON.stringify(persona.style_dna).slice(0, 5000)}
${persona.style_fingerprint ? `\nSTYLE FINGERPRINT (метрики эталонных текстов):\n${JSON.stringify(persona.style_fingerprint)}` : ""}
${refs ? `\nДОПОЛНИТЕЛЬНЫЕ ПРИМЕРЫ (справочно):\n${refs}` : ""}
${task ? `\nЗАДАЧА, которая ставилась автору:\n${task}` : ""}

ОЦЕНИВАЕМЫЙ ТЕКСТ:\n${text.slice(0, 30000)}

Верни JSON:
{
  "scores": {
    "identity_match": 0-100, "voice_match": 0-100, "style_match": 0-100, "vocabulary_match": 0-100,
    "narrative_match": 0-100, "expertise_match": 0-100, "subjectivity_match": 0-100, "storytelling_match": 0-100,
    "anti_ai_compliance": 0-100, "fact_compliance": 0-100, "seo_compliance": 0-100, "geo_compliance": 0-100
  },
  "total_score": 0-100,
  "deviations": [ { "area": str, "observed": str, "expected": str, "severity": "low"|"medium"|"high" } ],
  "suggestions": [ { "field": str, "current": str, "suggested": str, "reason": str } ]
}

suggestions - это предложения по изменению Persona DNA. Они не применяются автоматически, поэтому формулируй их конкретно и обоснованно.`;

    const { data } = await chatJson<any>({
      apiKey,
      model: MODEL,
      system: SYSTEM,
      user,
      temperature: 0.2,
      maxTokens: 4000,
      timeoutMs: 150_000,
      appTitle: "SEO-Modul persona-evaluate",
      functionName: "persona-evaluate",
      userId: auth.userId,
      articleId,
    });

    let evaluationId: string | null = null;
    if (persist) {
      const { data: saved } = await admin.from("persona_evaluations").insert({
        persona_id: personaId,
        user_id: auth.userId,
        article_id: articleId,
        task,
        output_text: text.slice(0, 50000),
        scores: data?.scores ?? {},
        total_score: Math.round(Number(data?.total_score) || 0),
        deviations: data?.deviations ?? [],
        suggestions: data?.suggestions ?? [],
      }).select("id").single();
      evaluationId = saved?.id ?? null;
    }

    return jsonResponse({ ...data, evaluation_id: evaluationId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[persona-evaluate]", msg);
    return jsonResponse({ error: msg }, 500);
  }
});