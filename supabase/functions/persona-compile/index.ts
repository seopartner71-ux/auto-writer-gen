// Persona Engine: внутренний Prompt Engineer.
// Человеческое описание автора + примеры текстов + Site DNA -> Persona DNA / Style DNA / политики.
// Additive: новая функция.

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { chatJson } from "../_shared/aiClient.ts";

const MODEL = "anthropic/claude-sonnet-4";

const SYSTEM = `Ты не являешься автором статьи. Ты архитектор AI-авторов.

Твоя задача - преобразовать человеческое описание желаемого автора в структурированную Persona DNA.

Ты должен:
1. извлечь требования;
2. классифицировать их;
3. определить отсутствующие параметры по контексту;
4. найти противоречия и разрешить их осмысленно (не отбрасывая одно из правил);
5. установить приоритеты;
6. отделить факты от пожеланий;
7. создать Persona DNA, Style DNA, Fact Policy, Source Policy, SEO Policy, GEO Policy, Anti-AI Policy, Editorial Rules, Quality Control.

ЗАПРЕЩЕНО:
- выдумывать биографию: должности, образование, стаж, клиентов, компании, достижения, сертификаты, личный опыт;
- превращать отсутствие данных в факт;
- смешивать Persona DNA с Site DNA (данные сайта не дублировать внутрь персоны);
- смешивать персону с конкретной статьёй;
- позволять SEO-требованиям разрушать достоверность и естественность.

МОДЕЛЬ ПРИОРИТЕТОВ при конфликте (сверху вниз): системные ограничения, фактологическая достоверность, явные требования пользователя, проверенные данные источника, Site DNA, Persona DNA, Platform DNA, бриф статьи, SEO, стилевые предпочтения.

Абстрактные требования переводи в наблюдаемое поведение. Плохо: "пиши интересно". Хорошо: "чередуй объяснения с конкретными примерами, не ставь подряд несколько абзацев одинаковой структуры".

Все текстовые значения - на русском языке (если не указан другой язык персоны). Не используй букву ё. Не используй длинное тире, только дефис.`;

function schemaHint(): string {
  return `Верни JSON строго такой структуры:
{
  "persona_dna": {
    "identity": { "role": str, "competence_area": str, "competence_limits": [str], "status": str },
    "expertise": { "knowledge_domains": [str], "decision_frameworks": [str], "argumentation_style": str, "depth": str, "terminology_level": str, "limitations": [str] },
    "audience": { "primary_audience": str, "knowledge_level": str, "needs": [str], "pain_points": [str], "questions": [str], "objections": [str], "decision_factors": [str] },
    "purpose": { "primary": str, "secondary": str, "tertiary": str },
    "voice": { "formality": 0-100, "warmth": 0-100, "energy": 0-100, "authority": 0-100, "emotionality": 0-100, "directness": 0-100, "subjectivity": 0-100, "conversationality": 0-100,
               "preferred_person": str, "preferred_tense": str, "preferred_sentence_complexity": str, "preferred_paragraph_density": str },
    "narrative": { "person": str, "first_person_policy": str, "storytelling": str, "authority_markers": [str] },
    "fact_policy": { "rules": [str], "on_missing_data": str },
    "source_policy": { "allowed_sources": [str], "preferred_sources": [str], "source_priority": [str], "citation_policy": str, "verification_policy": str },
    "seo_policy": { "principles": [str], "forbidden": [str] },
    "geo_policy": { "enabled": bool, "principles": [str] },
    "platform_policy": { "notes": str },
    "anti_ai_policy": { "forbidden_patterns": [str], "required_variety": [str] },
    "editorial_rules": [str],
    "forbidden_behaviour": [str],
    "quality_control": { "identity": [str], "expertise": [str], "voice": [str], "style": [str], "facts": [str], "persona_integrity": [str], "seo": [str], "geo": [str] }
  },
  "style_dna": {
    "vocabulary": { "complexity": str, "professionalism": str, "terminology": str, "colloquialisms": str },
    "sentence_style": { "avg_length": num, "variance": str, "complexity": str, "questions": str, "short_phrases": str, "long_constructions": str },
    "paragraph_style": { "length": str, "density": str, "logic": str },
    "rhythm": { "dynamics": str, "alternation": str, "pauses": str, "accents": str }
  },
  "confidence": { "<параметр>": 0..1 },
  "conflicts": [ { "rule_a": str, "rule_b": str, "resolution": str } ],
  "missing_inputs": [str],
  "suggested_name": str,
  "suggested_role": str
}`;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const description = String(body?.description || "").trim();
    if (description.length < 10) return jsonResponse({ error: "Опишите автора подробнее (минимум 10 символов)" }, 400);

    const siteDna = body?.site_dna ?? null;
    const samples: string[] = Array.isArray(body?.samples) ? body.samples.filter((s: unknown) => typeof s === "string" && s.length > 50) : [];
    const fingerprint = body?.style_fingerprint ?? null;
    const inputs = body?.inputs ?? {};
    const language = String(body?.language || "ru");

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return jsonResponse({ error: "AI не настроен" }, 500);

    const parts: string[] = [];
    parts.push(`ОПИСАНИЕ ЖЕЛАЕМОГО АВТОРА (словами пользователя):\n${description}`);
    if (inputs && Object.keys(inputs).length) {
      parts.push(`ЯВНЫЕ ПАРАМЕТРЫ (если значение отсутствует - определи сам из контекста):\n${JSON.stringify(inputs, null, 2)}`);
    }
    if (siteDna) {
      parts.push(`SITE DNA (контекст сайта, НЕ переносить внутрь персоны, использовать только для настройки уровня аудитории и терминологии):\n${JSON.stringify(siteDna).slice(0, 6000)}`);
    }
    if (fingerprint) {
      parts.push(`STYLE FINGERPRINT (измеренные метрики по примерам, дополнительный сигнал, не единственный источник истины):\n${JSON.stringify(fingerprint)}`);
    }
    if (samples.length) {
      parts.push(`ПРИМЕРЫ ТЕКСТОВ (${samples.length} шт.). Извлекай общие закономерности: стиль, структуру, ритм, словарь, аргументацию, переходы, storytelling, субъективность. НЕ копируй предложения и формулировки:\n\n${samples.map((s, i) => `--- Пример ${i + 1} ---\n${s.slice(0, 4000)}`).join("\n\n")}`);
    }
    parts.push(`ЯЗЫК ПЕРСОНЫ: ${language}`);
    parts.push(schemaHint());
    parts.push(`Каждому неочевидному извлечённому параметру присвой confidence 0..1. Если confidence ниже 0.5 - формулируй правило как мягкую рекомендацию, а не жёсткое требование.`);

    const { data } = await chatJson<Record<string, unknown>>({
      apiKey,
      model: MODEL,
      system: SYSTEM,
      user: parts.join("\n\n"),
      temperature: 0.4,
      maxTokens: 8000,
      timeoutMs: 150_000,
      appTitle: "SEO-Modul persona-compile",
      functionName: "persona-compile",
      userId: auth.userId,
    });

    return jsonResponse(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[persona-compile]", msg);
    return jsonResponse({ error: msg }, 500);
  }
});