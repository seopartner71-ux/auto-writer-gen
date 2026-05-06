import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const { keyword, current_title, language } = await req.json().catch(() => ({}));
    if (!keyword || typeof keyword !== "string") {
      return errorResponse("keyword required", 400);
    }
    const lang = (language === "en") ? "en" : "ru";

    const admin = adminClient();
    const { data: orKey } = await admin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .maybeSingle();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) return errorResponse("OpenRouter API key не настроен", 500);

    const { data: assignment } = await admin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "writer")
      .maybeSingle();
    const model = assignment?.model_key || "google/gemini-2.5-flash";

    const sysRu = "Ты SEO-копирайтер. Возвращай только валидный JSON массив строк, без пояснений. Никогда не используй букву 'е' с двумя точками - всегда обычную 'е'. Без markdown, без жирного шрифта.";
    const sysEn = "You are an SEO copywriter. Return ONLY a valid JSON array of strings, no explanation, no markdown.";

    const userRu = `Сгенерируй 5 альтернативных SEO-заголовков для статьи по ключевому слову "${keyword}".
Текущий заголовок: "${current_title || "(нет)"}".

Требования:
- Длина 50-70 символов
- Содержит ключевое слово
- Цепляет внимание
- Разные форматы: вопрос, список с числом, гид, рейтинг, советы эксперта
- На русском языке, без буквы 'е' с двумя точками

Верни только JSON массив из 5 строк, например ["...", "...", "...", "...", "..."]`;

    const userEn = `Generate 5 alternative SEO titles for an article about "${keyword}".
Current title: "${current_title || "(none)"}".

Requirements:
- 50-70 characters
- Contains the keyword
- Catchy
- Different formats: question, numbered list, guide, ranking, expert advice
- In English

Return only a JSON array of 5 strings.`;

    const aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: lang === "ru" ? sysRu : sysEn },
          { role: "user", content: lang === "ru" ? userRu : userEn },
        ],
        temperature: 0.8,
        max_tokens: 800,
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      return errorResponse(`AI error: ${aiResp.status} ${txt.slice(0, 200)}`, 500);
    }
    const aj = await aiResp.json();
    const raw: string = aj?.choices?.[0]?.message?.content || "";

    let titles: string[] = [];
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const arr = JSON.parse(jsonMatch[0]);
        if (Array.isArray(arr)) titles = arr.map(String).filter(Boolean);
      } catch { /* ignore */ }
    }
    if (titles.length === 0) {
      titles = raw.split(/\n+/).map(s => s.replace(/^[\s\d.\-)*"']+/, "").replace(/["']+$/, "").trim()).filter(s => s.length > 10).slice(0, 5);
    }
    titles = titles.slice(0, 5).map(t => t.replace(/ё/g, "е").replace(/Ё/g, "Е").replace(/\*\*/g, ""));

    return jsonResponse({ titles });
  } catch (e: any) {
    return errorResponse(e?.message || "Internal error", 500);
  }
});