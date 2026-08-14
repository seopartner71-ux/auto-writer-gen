// Persona Engine: Test Lab - генерация фрагмента текста по Master Prompt персоны.
// Additive: новая функция, Writer не затрагивается.

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatComplete } from "../_shared/aiClient.ts";

const MODEL = "anthropic/claude-sonnet-4";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const personaId = String(body?.persona_id || "").trim();
    const task = String(body?.task || "").trim();
    if (!personaId) return jsonResponse({ error: "persona_id required" }, 400);
    if (!task) return jsonResponse({ error: "Опишите задачу для автора" }, 400);

    const admin = adminClient();
    const { data: persona } = await admin
      .from("personas")
      .select("id, name, master_prompt, user_id")
      .eq("id", personaId)
      .maybeSingle();
    if (!persona || persona.user_id !== auth.userId) return jsonResponse({ error: "Персона не найдена" }, 404);
    if (!persona.master_prompt) return jsonResponse({ error: "Master Prompt не скомпилирован" }, 400);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return jsonResponse({ error: "AI не настроен" }, 500);

    const res = await chatComplete({
      apiKey,
      model: MODEL,
      system: persona.master_prompt,
      user: `${task}\n\nОграничение теста: не более 500 слов. Не выдумывай факты, цифры и личный опыт. Верни только текст.`,
      temperature: 0.8,
      maxTokens: 1800,
      timeoutMs: 120_000,
      appTitle: "SEO-Modul persona-test",
      functionName: "persona-test",
      userId: auth.userId,
    });

    return jsonResponse({ output: res.content, model: res.model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[persona-test]", msg);
    return jsonResponse({ error: msg }, 500);
  }
});