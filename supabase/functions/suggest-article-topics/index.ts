import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { logLLM } from "../_shared/costLogger.ts";

/**
 * suggest-article-topics
 * Free for all users. Given a seed keyword, query Serper top-10, then ask
 * Lovable AI Gateway (gemini-3-flash-preview) to return 5 distinct article
 * angles (H1 + intent + angle + reason). No DB writes, no credit charge.
 */
serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const { keyword, geo, language } = await req.json().catch(() => ({}));
    if (!keyword || typeof keyword !== "string" || keyword.trim().length < 2) {
      return errorResponse("Keyword is required (min 2 chars)", 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Serper key from admin vault (same source as smart-research)
    const { data: serperKey } = await supabaseAdmin
      .from("api_keys")
      .select("api_key")
      .eq("provider", "serper")
      .single();

    let serpItems: Array<{ title: string; snippet: string; link: string }> = [];
    if (serperKey?.api_key) {
      try {
        const r = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey.api_key, "Content-Type": "application/json" },
          body: JSON.stringify({
            q: keyword.trim(),
            gl: geo || (language === "ru" ? "ru" : "us"),
            hl: language || "ru",
            num: 10,
          }),
        });
        if (r.ok) {
          const j = await r.json();
          serpItems = (j.organic || []).slice(0, 10).map((o: any) => ({
            title: String(o.title || ""),
            snippet: String(o.snippet || ""),
            link: String(o.link || ""),
          }));
        } else {
          console.warn("Serper non-OK:", r.status);
        }
      } catch (e) {
        console.warn("Serper failed:", e);
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!LOVABLE_API_KEY) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const lang = language === "en" ? "en" : "ru";
    const serpBlock = serpItems.length
      ? serpItems.map((i, idx) => `${idx + 1}. ${i.title}\n   ${i.snippet}`).join("\n")
      : "(SERP пуст или недоступен — предложи темы по общему смыслу запроса.)";

    const systemPrompt = lang === "ru"
      ? `Ты SEO-стратег уровня senior. Твоя задача - найти БЕЛЫЕ ПЯТНА в топ-10 Google и предложить 5 углов подачи, которых ТАМ НЕТ.

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. ЗАПРЕЩЕНО копировать или перефразировать заголовки из топ-10. Если в топе есть "Как выбрать X" - ты НЕ предлагаешь "Как правильно выбрать X" или "Гид по выбору X".
2. Каждый из 5 углов должен закрывать другую боль/намерение/сегмент аудитории, которые конкуренты упустили или раскрыли поверхностно.
3. Используй разные форматы: личный опыт, разбор ошибок, чек-лист с цифрами, сравнение методов, кейс/история, анти-гайд (что НЕ делать), глубокий технический разбор, для конкретного сегмента (новички/профи/бюджет/премиум).
4. H1 должен звучать СВЕЖО - не штамп типа "Топ-10", "Полное руководство", "Все что нужно знать". Используй конкретику: цифры, год, сегмент, результат, провокацию.
5. Поле reason обязательно объясняет, ЧЕГО НЕТ в текущем топе и почему этот угол выиграет.
6. Без 'ё' (только 'е'). Без bold (**). Без emoji. Без длинных тире (только дефис -).`
      : `You are a senior SEO strategist. Your task: find BLIND SPOTS in Google top-10 and propose 5 angles MISSING from there.

HARD RULES:
1. FORBIDDEN to copy or rephrase top-10 titles. If top has "How to choose X" - you do NOT propose "How to properly choose X" or "Guide to choosing X".
2. Each of 5 angles must address a different pain/intent/audience segment competitors missed or covered shallowly.
3. Use different formats: personal experience, mistakes breakdown, checklist with numbers, methods comparison, case story, anti-guide (what NOT to do), deep technical, for specific segment (beginners/pros/budget/premium).
4. H1 must sound FRESH - no clichés like "Top 10", "Complete guide", "Everything you need to know". Use specifics: numbers, year, segment, outcome, provocation.
5. The reason field MUST explain what is MISSING in current top and why this angle wins.
6. No bold (**). No emoji. Use hyphens only (-).`;

    const userPrompt = lang === "ru"
      ? `Ключевой запрос: "${keyword.trim()}"\n\nТоп-10 Google сейчас (это то, что НЕ надо повторять):\n${serpBlock}\n\nПроанализируй, какие углы конкуренты УПУСТИЛИ, и предложи 5 СВЕЖИХ тем. Все 5 должны быть РАЗНЫЕ между собой - разные форматы, разные сегменты аудитории, разные боли. Верни через tool call.`
      : `Keyword: "${keyword.trim()}"\n\nGoogle top-10 now (this is what you must NOT repeat):\n${serpBlock}\n\nAnalyze which angles competitors MISSED and propose 5 FRESH topics. All 5 must DIFFER from each other - different formats, audiences, pains. Return via tool call.`;

    // ---------- Similarity helpers ----------
    const STOP = new Set([
      "и","в","во","не","на","с","со","по","для","от","до","из","к","о","об","или","что","как","это","вы","мы",
      "the","a","an","and","or","of","for","to","in","on","at","is","are","with","how","what","best","top","guide","2024","2025","2026"
    ]);
    const tokens = (s: string) => (s || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
    const jaccard = (a: string, b: string): number => {
      const A = new Set(tokens(a));
      const B = new Set(tokens(b));
      if (!A.size || !B.size) return 0;
      let inter = 0;
      for (const t of A) if (B.has(t)) inter++;
      return inter / new Set([...A, ...B]).size;
    };
    const SIM_THRESHOLD = 0.55; // >55% общих значимых слов = "копия"

    const validateTopics = (topics: any[]): { ok: any[]; rejected: Array<{ h1: string; reason: string }> } => {
      const ok: any[] = [];
      const rejected: Array<{ h1: string; reason: string }> = [];
      const seenH1: string[] = [];
      for (const t of topics) {
        const h1 = String(t?.h1 || "").trim();
        if (!h1) { rejected.push({ h1: "", reason: "empty h1" }); continue; }
        // vs SERP titles
        let worstSim = 0; let worstSrc = "";
        for (const s of serpItems) {
          const sim = jaccard(h1, s.title);
          if (sim > worstSim) { worstSim = sim; worstSrc = s.title; }
        }
        if (worstSim >= SIM_THRESHOLD) {
          rejected.push({ h1, reason: `слишком похоже (${Math.round(worstSim*100)}%) на: "${worstSrc}"` });
          continue;
        }
        // vs already accepted h1 in same batch
        let internalDup = false;
        for (const prev of seenH1) {
          if (jaccard(h1, prev) >= SIM_THRESHOLD) {
            rejected.push({ h1, reason: `дубль другого варианта в этой пачке: "${prev}"` });
            internalDup = true; break;
          }
        }
        if (internalDup) continue;
        seenH1.push(h1);
        ok.push(t);
      }
      return { ok, rejected };
    };

    const callModel = async (extraUserMsg?: string) => {
      const messages: any[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      if (extraUserMsg) messages.push({ role: "user", content: extraUserMsg });

      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`,
 "HTTP-Referer": "https://seo-modul.pro",
 "X-Title": "SEO-Modul suggest-article-topics", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages,
          tools: [{
            type: "function",
            function: {
              name: "suggest_topics",
              description: "Return 5 distinct article angles for the keyword.",
              parameters: {
                type: "object",
                properties: {
                  topics: {
                    type: "array", minItems: 5, maxItems: 5,
                    items: {
                      type: "object",
                      properties: {
                        h1: { type: "string", description: "Catchy H1 with the keyword inside (60-80 chars)." },
                        angle: { type: "string", description: "Short angle/positioning (1 sentence)." },
                        intent: { type: "string", enum: ["informational","commercial","transactional","comparison","how-to"] },
                        reason: { type: "string", description: "Why this angle can outrank current top (1 sentence)." },
                      },
                      required: ["h1","angle","intent","reason"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["topics"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "suggest_topics" } },
        }),
      });
      return r;
    };

    // ---------- Retry loop (up to 3 attempts) ----------
    const accepted: any[] = [];
    let lastRejected: Array<{ h1: string; reason: string }> = [];
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (accepted.length < 5 && attempts < MAX_ATTEMPTS) {
      attempts++;
      let extraMsg: string | undefined;
      if (attempts > 1) {
        const need = 5 - accepted.length;
        const rejList = lastRejected.slice(0, 8).map((r, i) => `${i + 1}. "${r.h1}" - ${r.reason}`).join("\n");
        const acceptedList = accepted.map((t, i) => `${i + 1}. "${t.h1}"`).join("\n") || "(пока ничего)";
        extraMsg = lang === "ru"
          ? `Предыдущая попытка ${attempts - 1}: ОТКЛОНЕНО за копирование/похожесть на топ или дубль:\n${rejList}\n\nУже принято (НЕ повторяй и не похожи на них):\n${acceptedList}\n\nПредложи ${need} НОВЫХ тем с РАДИКАЛЬНО другими формулировками. Меняй структуру H1 целиком: другая первая часть, другой формат, другой сегмент. Верни ровно 5 тем (включая ${need} новых + при желании переработай ${5 - need} принятых, если они есть).`
          : `Previous attempt ${attempts - 1}: REJECTED for copying/being too close to top or duplicates:\n${rejList}\n\nAlready accepted (do NOT repeat or look similar):\n${acceptedList}\n\nPropose ${need} NEW topics with RADICALLY different wording. Change H1 structure entirely. Return exactly 5 topics.`;
      }

      const aiResp = await callModel(extraMsg);
      if (aiResp.status === 429) return errorResponse("Слишком много запросов, попробуйте позже", 429);
      if (aiResp.status === 402) return errorResponse("Закончились кредиты Lovable AI", 402);
      if (!aiResp.ok) {
        const t = await aiResp.text();
        console.error(`AI gateway error attempt=${attempts}:`, aiResp.status, t);
        if (attempts >= MAX_ATTEMPTS) return errorResponse("AI gateway error", 500);
        continue;
      }
      const aiJson = await aiResp.json();
      try { logLLM({ functionName: "suggest-article-topics", model: ((aiJson as any)?.model) as string, tokensIn: Number((aiJson as any)?.usage?.prompt_tokens || 0), tokensOut: Number((aiJson as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
      const argsRaw = aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!argsRaw) { lastRejected = [{ h1: "", reason: "no tool call" }]; continue; }
      let parsed: any;
      try { parsed = JSON.parse(argsRaw); } catch { lastRejected = [{ h1: "", reason: "bad json" }]; continue; }
      const candidates = Array.isArray(parsed?.topics) ? parsed.topics : [];

      // validate against SERP + already accepted
      const combined = [...accepted, ...candidates];
      const { ok, rejected } = validateTopics(combined);
      lastRejected = rejected;

      // keep first 5 unique survivors
      accepted.length = 0;
      for (const t of ok) {
        accepted.push(t);
        if (accepted.length >= 5) break;
      }
      console.log(`attempt=${attempts} accepted=${accepted.length}/5 rejected=${rejected.length}`);
      if (accepted.length >= 5) break;
    }

    if (accepted.length === 0) {
      return errorResponse("Не удалось подобрать уникальные темы после нескольких попыток. Попробуйте другой ключ.", 422);
    }

    return jsonResponse({
      topics: accepted.slice(0, 5),
      serp_used: serpItems.length,
      attempts,
      partial: accepted.length < 5,
      rejected_examples: lastRejected.slice(0, 3),
    });
  } catch (e) {
    console.error("suggest-article-topics error:", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
