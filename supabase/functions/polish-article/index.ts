// polish-article: точечный пост-корректор сгенерированной статьи.
// Не переписывает текст, только чинит технические баги по 5 правилам.
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

const SYSTEM_PROMPT = `Ты — строгий технический SEO-редактор и валидатор кода. Тебе передают черновик статьи. Твоя задача — точечно исправить технические баги, СОХРАНИВ 95% оригинального текста нетронутым.

КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: переписывать статью, менять стиль, удалять смысловые блоки, нарушать SEO-структуру, добавлять комментарии или приветствия.

ИСПРАВЬ СТРОГО ПО ЭТИМ 5 ПРАВИЛАМ:

1. УДАЛИ АНГЛИЙСКИЙ МУСОР (промт-лики). Слова и фразы вроде "Honestly,", "Look,", "based on industry surveys", "according to", "practice shows", "as a rule" внутри русского текста — удали или аккуратно переведи на чистый русский, не меняя смысла предложения. Английские термины (SEO, CTR, бренды) НЕ трогай.

2. ВОССТАНОВИ ОБОРВАННЫЕ ПРЕДЛОЖЕНИЯ. Если предложение обрывается на полуслове или предлоге ("каждый оставленный.", "раз в два.", "стригите в несколько.") — допиши логичное окончание на 2-3 слова. Только концовку, не более.

3. ПОЧИНИ СЛОМАННЫЕ ЗАГОЛОВКИ. Если в строку с ## или ### попал длинный текст или системный мусор ("## по данным отраслевых опросов газон..."), сделай заголовок коротким и логичным (например "## Выводы"), а длинный текст спусти вниз отдельным абзацем.

4. ВОССТАНОВИ JSON-LD КОД. В конце статьи может быть блок <script type="application/ld+json">...</script>. Если JSON оборван — допиши недостающие кавычки и скобки, чтобы был валидный JSON. Блок ОБЯЗАТЕЛЬНО должен заканчиваться на } ] } </script> или эквивалентной валидной закрывающей структурой.

5. ПРАВИЛО ВЫВОДА. Верни ТОЛЬКО полный исправленный текст статьи от первого до последнего слова. Никаких "Вот исправленный текст", никаких комментариев, никаких code fences. Чистый markdown готовый к публикации.`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({} as any));
    const content: string = body?.content || "";
    if (!content || content.length < 200) {
      return json({ ok: true, content, skipped: true, reason: "too_short" });
    }
    if (content.length > 60000) {
      // Защита от слишком длинных статей — пост-обработка дороже стрима.
      return json({ ok: true, content, skipped: true, reason: "too_long" });
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
      }),
    });

    if (res.status === 429) return json({ ok: true, content, skipped: true, reason: "rate_limit" });
    if (res.status === 402) return json({ ok: true, content, skipped: true, reason: "ai_credits_exhausted" });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[polish-article] AI error", res.status, t.slice(0, 200));
      return json({ ok: true, content, skipped: true, reason: "ai_error" });
    }

    const data = await res.json();
    let polished: string = data?.choices?.[0]?.message?.content || "";
    if (!polished || polished.length < content.length * 0.7) {
      // Подозрительное сокращение — модель могла обрезать. Возвращаем оригинал.
      console.warn("[polish-article] polished too short:", polished.length, "vs", content.length);
      return json({ ok: true, content, skipped: true, reason: "shrunk" });
    }

    // Снимаем возможные code fences вокруг ответа.
    polished = polished.replace(/^```(?:markdown|md|html)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

    return json({ ok: true, content: polished, polished: true });
  } catch (e: any) {
    console.error("[polish-article] exception:", e?.message || e);
    // Никогда не валим запрос — клиент должен получить рабочий контент.
    try {
      const body = await req.clone().json().catch(() => ({} as any));
      return json({ ok: true, content: body?.content || "", skipped: true, reason: "exception" });
    } catch {
      return json({ error: "Internal error" }, 500);
    }
  }
});