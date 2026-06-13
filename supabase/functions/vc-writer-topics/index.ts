// vc.ru topic generator. Returns N topic ideas for a niche, each with a suggested format.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson } from "../_shared/aiClient.ts";
import { pickVcModel, ruEReplace, isVcFormat } from "../_shared/vcWriterCore.ts";

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "").trim();
    if (niche.length < 3) return errorResponse("niche required", 400);
    const count = Math.min(15, Math.max(3, Number(body.count) || 10));
    const preferredFormat = isVcFormat(body.preferred_format) ? body.preferred_format : null;
    const model = pickVcModel(body.model);

    const admin = adminClient();
    const { data: orRow } = await admin
      .from("api_keys").select("api_key")
      .eq("provider", "openrouter").eq("is_valid", true).maybeSingle();
    const apiKey = orRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OpenRouter key not configured", 500);

    const system = `Ты главред vc.ru. Твоя задача - предложить ${count} тем для статей в нише пользователя, которые залетят в топ vc.ru и принесут трафик из Google/Yandex. Темы должны быть конкретные (с цифрами/конфликтом/неожиданным углом), без воды, без штампов вроде "В современном мире". Пиши на русском, БЕЗ буквы ё (заменяй на е).`;
    const user = `Ниша: ${niche}\n${preferredFormat ? `Желаемый формат всех тем: ${preferredFormat}.\n` : "Подбери разные форматы (guide, rating, review, case) под характер темы.\n"}\nВерни строго JSON:\n{\n  "topics": [\n    { "topic": "конкретная тема статьи (заголовок-крючок)", "format": "guide|rating|review|case", "thesis": "что именно докажет статья, 1 предложение" }\n  ]\n}\nРовно ${count} тем, разные углы (личный опыт, провал, сравнение, контр-мнение, как-сделать, антикейс).`;

    const result = await chatJson<{
      topics: Array<{ topic: string; format: string; thesis: string }>;
    }>({
      apiKey, model, system, user,
      temperature: 0.95, maxTokens: 2500, timeoutMs: 90_000,
      appTitle: "vc.ru Topics", retries: 1,
    });

    const raw = Array.isArray(result.data?.topics) ? result.data.topics : [];
    const topics = raw.slice(0, count).map((t: any) => ({
      topic: ruEReplace(String(t?.topic || "")).slice(0, 180),
      format: isVcFormat(t?.format) ? t.format : (preferredFormat || "guide"),
      thesis: ruEReplace(String(t?.thesis || "")).slice(0, 300),
    })).filter((t: any) => t.topic.length >= 5);

    return jsonResponse({ ok: true, topics, model: result.model });
  } catch (e: any) {
    console.error("[vc-writer-topics]", e?.message || e);
    const status = e?.status || (e?.kind === "budget" ? 402 : e?.kind === "rate_limit" ? 429 : 500);
    return errorResponse(e?.message || "Unknown error", status);
  }
});