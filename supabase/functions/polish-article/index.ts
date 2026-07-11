// polish-article: точечный пост-корректор сгенерированной статьи.
// Не переписывает текст, только чинит технические баги по 5 правилам.
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";
import { logLLM } from "../_shared/costLogger.ts";

const SYSTEM_PROMPT_RU = `Ты — строгий технический SEO-редактор и валидатор кода. Тебе передают черновик статьи. Твоя задача — точечно исправить технические баги, СОХРАНИВ 95% оригинального текста нетронутым.

КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: переписывать статью, менять стиль, удалять смысловые блоки, нарушать SEO-структуру, добавлять комментарии или приветствия.

ИСПРАВЬ СТРОГО ПО ЭТИМ 5 ПРАВИЛАМ:

1. УДАЛИ АНГЛИЙСКИЙ МУСОР (промт-лики). Слова и фразы вроде "Honestly,", "Look,", "based on industry surveys", "according to", "practice shows", "as a rule" внутри русского текста — удали или аккуратно переведи на чистый русский, не меняя смысла предложения. Английские термины (SEO, CTR, бренды) НЕ трогай.

2. ВОССТАНОВИ ОБОРВАННЫЕ ПРЕДЛОЖЕНИЯ. Если предложение обрывается на полуслове или предлоге ("каждый оставленный.", "раз в два.", "стригите в несколько.") — допиши логичное окончание на 2-3 слова. Только концовку, не более.

3. ПОЧИНИ СЛОМАННЫЕ ЗАГОЛОВКИ. Если в строку с ## или ### попал длинный текст или системный мусор ("## по данным отраслевых опросов газон..."), сделай заголовок коротким и логичным (например "## Выводы"), а длинный текст спусти вниз отдельным абзацем.

4. УДАЛИ JSON-LD МИКРОРАЗМЕТКУ. Если в тексте есть блок <script type="application/ld+json">...</script> или комментарий <!-- FAQ Schema --> — полностью удали их. Микроразметка генерируется отдельной кнопкой по запросу пользователя, в теле статьи её быть не должно.

5. ПРАВИЛО ВЫВОДА. Верни ТОЛЬКО полный исправленный текст статьи от первого до последнего слова. Никаких "Вот исправленный текст", никаких комментариев, никаких code fences. Чистый markdown готовый к публикации.`;

const SYSTEM_PROMPT_EN = `You are a strict technical SEO editor and code validator. You receive an article draft. Your job is to fix technical bugs surgically while KEEPING 95% of the original text UNTOUCHED.

STRICTLY FORBIDDEN: rewriting the article, changing style, removing meaningful blocks, breaking SEO structure, adding comments or greetings, translating the article into another language.

LANGUAGE LOCK: the article is in ENGLISH. Output MUST stay 100% English. NEVER introduce Cyrillic characters. NEVER translate any sentence into Russian. If you see a Cyrillic word inside the English draft, rewrite it in English (using the roman spelling for names, e.g. "Yandex", "Moscow").

FIX STRICTLY BY THESE 5 RULES:

1. REMOVE FOREIGN-LANGUAGE CONTAMINATION. If any Cyrillic word or Russian phrase appears in the English text, rewrite that fragment in natural English preserving the meaning. Do NOT touch legitimate proper nouns already in Latin script.

2. RESTORE TRUNCATED SENTENCES. If a sentence trails off mid-word or on a preposition ("every remaining.", "once every two.") — add a 2-3 word logical ending. Ending only, nothing more.

3. FIX BROKEN HEADINGS. If a ## or ### line contains a long paragraph or system garbage, make the heading short and logical (e.g. "## Takeaways", "## Recommendations"), and move the long text below as its own paragraph.

4. REMOVE JSON-LD MICRODATA. If the text contains <script type="application/ld+json">...</script> or an <!-- FAQ Schema --> comment — delete them entirely. Schema markup is generated separately on user request; it must not appear inside the article body.

5. OUTPUT RULE. Return ONLY the full corrected article from first to last word. No "Here is the corrected text", no comments, no code fences. Clean markdown ready to publish.`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  const timer = startTimer();
  let articleId: string | null = null;
  let userId: string | null = null;
  try {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return json({ error: "OPENROUTER_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({} as any));
    const content: string = body?.content || "";
    articleId = body?.article_id || body?.articleId || null;
    userId = body?.user_id || body?.userId || null;
    const language: "ru" | "en" = (body?.language === "en") ? "en" : "ru";
    if (!content || content.length < 200) {
      logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "warning", duration_ms: timer(), meta: { skipped: "too_short" } });
      return json({ ok: true, content, skipped: true, reason: "too_short" });
    }
    if (content.length > 60000) {
      // Защита от слишком длинных статей — пост-обработка дороже стрима.
      logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "warning", duration_ms: timer(), meta: { skipped: "too_long" } });
      return json({ ok: true, content, skipped: true, reason: "too_long" });
    }

    // 90s hard timeout so polish doesn't eat the whole edge budget when OpenRouter stalls.
    const polishCtrl = new AbortController();
    const polishTimer = setTimeout(() => polishCtrl.abort(), 90_000);
    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "HTTP-Referer": "https://seo-modul.pro", "X-Title": "SEO-Modul polish-article" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: language === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_RU },
            { role: "user", content },
          ],
        }),
        signal: polishCtrl.signal,
      });
    } catch (e) {
      clearTimeout(polishTimer);
      const aborted = e instanceof Error && e.name === "AbortError";
      logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "fail", error_kind: aborted ? "timeout" : "ai_error", duration_ms: timer() });
      return json({ ok: true, content, skipped: true, reason: aborted ? "timeout" : "ai_error" });
    }
    clearTimeout(polishTimer);

    if (res.status === 429) {
      logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "fail", error_kind: "rate_limit", duration_ms: timer() });
      return json({ ok: true, content, skipped: true, reason: "rate_limit" });
    }
    if (res.status === 402) {
      logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "fail", error_kind: "ai_credits_exhausted", duration_ms: timer() });
      return json({ ok: true, content, skipped: true, reason: "ai_credits_exhausted" });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[polish-article] AI error", res.status, t.slice(0, 200));
      logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "fail", error_kind: "ai_error", error_message: t.slice(0, 200), duration_ms: timer() });
      return json({ ok: true, content, skipped: true, reason: "ai_error" });
    }

    const data = await res.json();
    try { logLLM({ functionName: "polish-article", model: ((data as any)?.model) as string, tokensIn: Number((data as any)?.usage?.prompt_tokens || 0), tokensOut: Number((data as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
    let polished: string = data?.choices?.[0]?.message?.content || "";
    if (!polished || polished.length < content.length * 0.7) {
      // Подозрительное сокращение — модель могла обрезать. Возвращаем оригинал.
      console.warn("[polish-article] polished too short:", polished.length, "vs", content.length);
      logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "warning", duration_ms: timer(), meta: { skipped: "shrunk", in: content.length, out: polished.length } });
      return json({ ok: true, content, skipped: true, reason: "shrunk" });
    }

    // Снимаем возможные code fences вокруг ответа.
    polished = polished.replace(/^```(?:markdown|md|html)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

    // Жёстко вырезаем любую JSON-LD микроразметку (FAQPage и пр.) из тела статьи.
    polished = polished
      .replace(/<!--\s*FAQ Schema\s*-->/gi, "")
      .replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/```(?:json|html)?\s*<script[^>]*application\/ld\+json[\s\S]*?<\/script>\s*```/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "pass", model: "google/gemini-2.5-flash", duration_ms: timer(), meta: { in: content.length, out: polished.length } });
    return json({ ok: true, content: polished, polished: true });
  } catch (e: any) {
    console.error("[polish-article] exception:", e?.message || e);
    logPipelineEvent({ stage: "polish", article_id: articleId, user_id: userId, verdict: "fail", error_kind: "exception", error_message: e?.message || String(e), duration_ms: timer() });
    // Никогда не валим запрос — клиент должен получить рабочий контент.
    try {
      const body = await req.clone().json().catch(() => ({} as any));
      return json({ ok: true, content: body?.content || "", skipped: true, reason: "exception" });
    } catch {
      return json({ error: "Internal error" }, 500);
    }
  }
});