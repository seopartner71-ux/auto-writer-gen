// Improves an author's system prompt by sending it to Claude Opus 4
// (via OpenRouter / Lovable AI gateway) with an instruction to expand it
// into a detailed, character-rich prompt for living, human-feeling text.
//
// Admin-only. Backs up the original prompt to system_instruction_backup
// on first improvement.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { fetchWithTimeout, TIMEOUTS } from "../_shared/withTimeout.ts";

const META_PROMPT = (original: string) => `Ты эксперт по промптингу для Claude.
Перед тобой короткий промпт автора. Расширь его до детального промпта,
который даст Claude максимально живой и человеческий текст.

Добавь к характеру автора:
- Как именно он строит предложения (ритм, длина, разрыв шаблона)
- Какие слова и обороты использует, какие избегает
- Как вставляет личный опыт (примеры из практики, мини-истории)
- Какие детали и цифры упоминает (конкретика вместо общих слов)
- Как реагирует на тему статьи (эмоциональная окраска, оценки)

Сохрани суть и тематику оригинала, не превращай автора в другую личность.
Длина итога: 600-1500 слов на русском.

Оригинальный промпт:
"""
${original}
"""

Верни ТОЛЬКО улучшенный промпт без пояснений, без префиксов, без кавычек,
без markdown-разметки.`;

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const admin = adminClient();

    // Admin gate
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return jsonResponse({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const authorId = String(body?.author_id || "").trim();
    if (!authorId) return jsonResponse({ error: "author_id required" }, 400);

    const { data: author, error: aErr } = await admin
      .from("author_profiles")
      .select("id, name, system_instruction, system_instruction_backup")
      .eq("id", authorId)
      .maybeSingle();
    if (aErr || !author) return jsonResponse({ error: "Author not found" }, 404);

    const original = (author.system_instruction || "").trim();
    if (!original) return jsonResponse({ error: "Author has no system_instruction to improve" }, 400);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return jsonResponse({ error: "LOVABLE_API_KEY not configured" }, 500);

    const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "anthropic/claude-opus-4",
        messages: [
          { role: "system", content: "Ты редактор промптов. Возвращай только готовый промпт, без комментариев." },
          { role: "user", content: META_PROMPT(original) },
        ],
        temperature: 0.6,
      }),
      timeoutMs: TIMEOUTS.aiSlow,
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("[improve-author-prompt] gateway", res.status, t.slice(0, 300));
      return jsonResponse({ error: "AI gateway error", status: res.status, detail: t.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const improved = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!improved || improved.length < 50) {
      return jsonResponse({ error: "Empty or too-short improved prompt" }, 500);
    }

    return jsonResponse({
      author_id: authorId,
      original,
      improved,
      backup_present: !!author.system_instruction_backup,
    });
  } catch (e) {
    console.error("[improve-author-prompt] fatal", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
