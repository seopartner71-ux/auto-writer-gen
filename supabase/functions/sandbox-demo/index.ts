import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { withErrorHandler, HttpError } from "../_shared/errorHandler.ts";
import { fetchWithTimeout, TIMEOUTS } from "../_shared/withTimeout.ts";

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "sandbox-salt");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const RATE_LIMIT_PER_HOUR = 3;

serve(withErrorHandler("sandbox-demo", async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) throw new HttpError("LOVABLE_API_KEY missing", 500);

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const ipHash = await hashIp(ip);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Rate limit per IP per hour. Lower than before because we now generate
  // real article preview (more LLM tokens).
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);

  const { data: existing } = await admin
    .from("sandbox_rate_limits")
    .select("request_count")
    .eq("ip_hash", ipHash)
    .eq("window_start", windowStart.toISOString())
    .maybeSingle();

  if (existing && existing.request_count >= RATE_LIMIT_PER_HOUR) {
    return jsonResponse(
      { error: "Превышен лимит демо на этот час. Зарегистрируйтесь — получите 3 кредита бесплатно." },
      429,
    );
  }

  if (existing) {
    await admin
      .from("sandbox_rate_limits")
      .update({ request_count: existing.request_count + 1 })
      .eq("ip_hash", ipHash)
      .eq("window_start", windowStart.toISOString());
  } else {
    await admin.from("sandbox_rate_limits").insert({
      ip_hash: ipHash,
      window_start: windowStart.toISOString(),
      request_count: 1,
    });
  }

  const body = await req.json().catch(() => ({}));
  const keyword = String(body.keyword || "").trim().slice(0, 100);
  if (keyword.length < 2) throw new HttpError("Введите ключевое слово (минимум 2 символа)", 400);

  // Single Gemini Flash Lite call returns BOTH analysis and a real article preview.
  // Cheaper than two round-trips and keeps the demo under ~10s.
  const prompt = `Ты опытный SEO-редактор. По ключевому запросу "${keyword}" верни строго один JSON-объект (без markdown, без обертки) со следующей структурой:
{
  "intent": "Информационный|Коммерческий|Транзакционный|Навигационный",
  "competition": "Низкая|Средняя|Высокая",
  "estimated_difficulty": число от 0 до 100,
  "outline": ["H2 заголовок 1", "H2 заголовок 2", "H2 заголовок 3", "H2 заголовок 4", "H2 заголовок 5"],
  "lsi_keywords": ["ключ 1", "ключ 2", "ключ 3", "ключ 4", "ключ 5"],
  "ai_score_sample": число от 70 до 95,
  "seo_score_sample": число от 75 до 95,
  "article_title": "цепкий H1 для статьи (до 70 символов, с ключом)",
  "meta_description": "meta description до 155 символов с ключом и выгодой",
  "direct_answer": "1-2 предложения прямого ответа на запрос для блока Direct Answer (до 280 символов)",
  "intro_paragraph": "Вступление статьи 130-180 слов. Живой текст без воды, без 'в современном мире'. Используй ключ естественно. БЕЗ markdown, обычный абзац.",
  "first_section_title": "первый H2 раздел из outline",
  "first_section_paragraph": "Первый абзац под этим H2 — 100-140 слов, по делу, с фактами/конкретикой. БЕЗ markdown."
}
ВАЖНО: Не используй букву 'ё' (только 'е'). Не используй жирный текст и markdown. Возвращай ТОЛЬКО валидный JSON.`;

  const aiResp = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    timeoutMs: TIMEOUTS.ai,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (aiResp.status === 429) throw new HttpError("AI сервис временно перегружен. Попробуйте через минуту.", 429);
  if (aiResp.status === 402) throw new HttpError("Сервис временно недоступен. Зарегистрируйтесь чтобы попробовать.", 503);
  if (!aiResp.ok) {
    const errText = await aiResp.text();
    throw new HttpError(`AI error ${aiResp.status}: ${errText.slice(0, 200)}`, 502);
  }

  const aiData = await aiResp.json();
  const content = aiData.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new HttpError("Не удалось распознать ответ AI", 502);

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch {
    throw new HttpError("Невалидный JSON от AI", 502);
  }

  // Strip the forbidden 'ё' just in case the model slips.
  const sanitize = (s: unknown) => typeof s === "string"
    ? s.replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/\*\*/g, "")
    : s;
  for (const k of ["article_title", "meta_description", "direct_answer", "intro_paragraph", "first_section_title", "first_section_paragraph"]) {
    if (k in result) (result as Record<string, unknown>)[k] = sanitize((result as Record<string, unknown>)[k]);
  }
  if (Array.isArray(result.outline)) result.outline = (result.outline as unknown[]).map(sanitize);
  if (Array.isArray(result.lsi_keywords)) result.lsi_keywords = (result.lsi_keywords as unknown[]).map(sanitize);

  return jsonResponse({
    result,
    remaining: RATE_LIMIT_PER_HOUR - ((existing?.request_count || 0) + 1),
    rate_limit: RATE_LIMIT_PER_HOUR,
  });
}));