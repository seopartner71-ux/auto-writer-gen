// Auto-improve article based on quality flags: rewrite-pass for low ai_score,
// keyword density fix (overuse/underuse), burstiness fix (split long sentences,
// shorten consecutive same-length runs).
//
// Body: { article_id: string }
// Returns: { ok: true } and re-triggers quality-check auto-mode in background.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Count critical structural HTML elements to detect rewrite damage.
function countTags(html: string): { h: number; a: number; p: number; li: number; table: number; words: number } {
  return {
    h: (html.match(/<h[1-6][\s>]/gi) || []).length,
    a: (html.match(/<a\s[^>]*href=/gi) || []).length,
    p: (html.match(/<p[\s>]/gi) || []).length,
    li: (html.match(/<li[\s>]/gi) || []).length,
    table: (html.match(/<table[\s>]/gi) || []).length,
    words: stripHtml(html).split(/\s+/).filter(Boolean).length,
  };
}

// Returns true if the rewritten HTML preserves structure (within tolerance).
function htmlIntegrityOk(before: string, after: string): { ok: boolean; reason?: string } {
  const b = countTags(before);
  const a = countTags(after);
  if (a.words < b.words * 0.6) return { ok: false, reason: `words shrunk ${b.words}->${a.words}` };
  if (a.words > b.words * 1.6) return { ok: false, reason: `words inflated ${b.words}->${a.words}` };
  if (a.h < b.h) return { ok: false, reason: `headings lost ${b.h}->${a.h}` };
  if (a.a < b.a) return { ok: false, reason: `links lost ${b.a}->${a.a}` };
  if (a.table < b.table) return { ok: false, reason: `tables lost ${b.table}->${a.table}` };
  return { ok: true };
}

// Remove every Nth occurrence of keyword (default every 3rd) from HTML, preserving tags.
function removeEveryNthKeyword(html: string, keyword: string, n = 3): string {
  if (!keyword) return html;
  const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  let i = 0;
  return html.replace(re, (m) => {
    i++;
    return i % n === 0 ? "" : m;
  });
}

// Split sentences longer than 30 words by comma or conjunction.
function splitLongSentences(text: string): string {
  return text.replace(/([^.!?]{120,}?[.!?])/g, (chunk) => {
    const words = chunk.trim().split(/\s+/);
    if (words.length < 30) return chunk;
    // try split at first comma or ' и ' / ' но ' / ' а ' after word 12
    const idx = words.findIndex((w, i) =>
      i > 10 && (/,$/.test(w) || /^(и|но|а|или|однако|причем|тогда)$/i.test(w))
    );
    if (idx === -1 || idx >= words.length - 5) return chunk;
    const first = words.slice(0, idx + 1).join(" ").replace(/,?$/, ".");
    const rest = words.slice(idx + 1).join(" ");
    return `${first} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  });
}

async function callOpenRouter(model: string, system: string, user: string, key: string, maxTokens = 8000): Promise<string | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
        temperature: 0.85,
      }),
    });
    if (!res.ok) {
      console.error("[improve-article] OR error", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error("[improve-article] OR exception", e);
    return null;
  }
}

async function callGateway(model: string, system: string, user: string, key: string): Promise<string | null> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const orKey = Deno.env.get("OPENROUTER_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { article_id } = await req.json().catch(() => ({}));
    if (!article_id) return json({ error: "article_id required" }, 400);

    const { data: art } = await admin.from("articles")
      .select("id,user_id,content,title,keyword_id,keywords,ai_score,burstiness_status,keyword_density_status,keyword_density,last_improve_at,turgenev_status,language,seo_improve_count")
      .eq("id", article_id).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Article not found" }, 404);

    let content: string = art.content || "";
    if (!content) return json({ error: "Article has no content" }, 400);
    const originalContent = content;
    const originalAiScore = art.ai_score;

    // Plan-based limits per article. DB plan ids: free=NANO, basic=PRO, pro=FACTORY.
    const PLAN_LIMITS: Record<string, number> = {
      free: 3, nano: 3,
      basic: 999, pro: 999,
      factory: 999,
      default: 3,
    };
    const { data: pProfile } = await admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();
    const planRaw = String((pProfile as any)?.plan || "").toLowerCase();
    const improveLimit = PLAN_LIMITS[planRaw] ?? PLAN_LIMITS.default;
    const usedImprove = Number((art as any).seo_improve_count || 0);
    if (usedImprove >= improveLimit) {
      return json({
        ok: false,
        limit_reached: true,
        error: `Лимит улучшений для вашего плана исчерпан (${improveLimit}). Обновите тариф для продолжения.`,
      }, 429);
    }

    // ── Cooldown: 60s between improve calls per article ──
    if (art.last_improve_at) {
      const elapsed = Date.now() - new Date(art.last_improve_at as string).getTime();
      if (elapsed < 60_000) {
        return json({
          ok: false,
          cooldown: true,
          retry_after: Math.ceil((60_000 - elapsed) / 1000),
          message: `Подождите ${Math.ceil((60_000 - elapsed) / 1000)} сек. перед повторной доработкой`,
        });
      }
    }

    // Snapshot BEFORE any change so user can rollback
    try {
      await admin.from("article_versions").insert({
        article_id,
        user_id: user.id,
        title: art.title ?? null,
        content: originalContent,
        reason: "auto_improve_before",
        word_count: stripHtml(originalContent).split(/\s+/).filter(Boolean).length,
        metadata: { ai_score_before: originalAiScore },
      } as any);
    } catch (e) {
      console.warn("[improve-article] snapshot failed", e);
    }
    await admin.from("articles").update({ last_improve_at: new Date().toISOString() }).eq("id", article_id);

    // Mark as checking
    await admin.from("articles").update({ quality_status: "checking" }).eq("id", article_id);

    // Determine primary keyword
    let primaryKeyword = "";
    if (art.keyword_id) {
      const { data: kw } = await admin.from("keywords").select("seed_keyword").eq("id", art.keyword_id).maybeSingle();
      primaryKeyword = String(kw?.seed_keyword || "");
    }
    if (!primaryKeyword && Array.isArray(art.keywords) && art.keywords.length) {
      primaryKeyword = String(art.keywords[0]);
    }

    const aiScore = Number(art.ai_score ?? 100);
    const burstStatus = String(art.burstiness_status || "ok");
    const dStatus = String(art.keyword_density_status || "ok");

    // 1) Rewrite-pass when ai_score is too low (looks AI-ish)
    if (aiScore < 70 && (orKey || lovableKey)) {
      const sys = "Ты редактор-человек. Переписываешь HTML-контент сохраняя ВСЕ факты, цифры, бренды, ссылки, теги. Возвращаешь только итоговый HTML без markdown-обёрток.";
      const usr = `Перепиши текст сохранив все факты и структуру. Сделай ритм живым: чередуй короткие предложения (3-6 слов) с длинными (20-30 слов). Убери канцелярит. Добавь разговорные вставки типа "на практике это выглядит так", "вот что важно понять", "и вот тут начинается интересное". Не меняй факты, цифры, названия брендов. Сохрани все HTML-теги (<h2>, <h3>, <p>, <ul>, <table>, <a>).

HTML:
${content}`;
      let rewritten: string | null = null;
      if (orKey) {
        rewritten = await callOpenRouter("anthropic/claude-sonnet-4", sys, usr, orKey, 12000);
      }
      if (!rewritten && lovableKey) {
        rewritten = await callGateway("google/gemini-2.5-pro", sys, usr, lovableKey);
      }
      if (rewritten && rewritten.length > 200) {
        // Strip stray markdown code fences
        const candidate = rewritten.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const integrity = htmlIntegrityOk(content, candidate);
        if (integrity.ok) {
          content = candidate;
        } else {
          console.warn("[improve-article] rewrite rejected:", integrity.reason);
        }
      }
    }

    // 2) Keyword density: overuse → remove every 3rd; underuse → ask LLM to insert 2-3 times
    if (primaryKeyword && dStatus === "overuse") {
      content = removeEveryNthKeyword(content, primaryKeyword, 3);
    } else if (primaryKeyword && dStatus === "underuse" && (orKey || lovableKey)) {
      const sys = "Ты редактор. Вставляешь фразу в текст органично. Возвращаешь только итоговый HTML.";
      const usr = `Вставь фразу "${primaryKeyword}" органично в 2-3 места текста где это звучит естественно. Не меняй факты. Сохрани все HTML-теги. Верни только исправленный HTML.

HTML:
${content}`;
      let added: string | null = null;
      if (lovableKey) added = await callGateway("google/gemini-2.5-flash", sys, usr, lovableKey);
      if (!added && orKey) added = await callOpenRouter("google/gemini-2.5-flash", sys, usr, orKey);
      if (added && added.length > 200) {
        const candidate = added.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const integrity = htmlIntegrityOk(content, candidate);
        if (integrity.ok) content = candidate;
        else console.warn("[improve-article] density-fix rejected:", integrity.reason);
      }
    }

    // 3) Burstiness fix: split long sentences (JS post-processor)
    if (burstStatus === "fail" || burstStatus === "warning") {
      // Apply only to text inside <p>/<li> blocks
      content = content.replace(/(<(?:p|li)[^>]*>)([\s\S]*?)(<\/(?:p|li)>)/gi, (_m, open, inner, close) => {
        return `${open}${splitLongSentences(inner)}${close}`;
      });
    }

    // 4) Turgenev (Yandex Baden-Baden) fix when status = fail (RU only, needs OpenRouter)
    const turgStatus = String((art as any).turgenev_status || "ok");
    const isRu = String((art as any).language || "ru").toLowerCase() === "ru";
    if (turgStatus === "fail" && isRu && orKey) {
      const sys = "Ты редактор. Улучшаешь текст под требования Яндекса. Возвращай ТОЛЬКО исправленный HTML без комментариев и markdown-обёрток.";
      const usr = `Улучши текст чтобы снизить риск фильтра Яндекса Баден-Баден:

1. Найди фразы длиннее 4 слов которые повторяются более 3 раз - перефразируй каждое повторение по-разному.
2. Убери канцеляризмы: "является", "осуществляет", "в целях", "в рамках", "на сегодняшний день", "на протяжении", "в настоящее время".
3. Убери воду: "следует отметить", "стоит сказать", "необходимо учитывать", "как известно", "не секрет что", "само собой разумеется".
4. Предложения длиннее 30 слов - разбей на два.
5. Сохрани все факты, цифры, H2/H3, таблицы, FAQ и HTML-структуру (теги <h2>, <h3>, <p>, <ul>, <li>, <table>, <a>).

Текст:
${content}`;
      const fixed = await callOpenRouter("anthropic/claude-sonnet-4", sys, usr, orKey, 12000);
      if (fixed && fixed.length > 200) {
        const candidate = fixed.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const integrity = htmlIntegrityOk(content, candidate);
        if (integrity.ok) content = candidate;
        else console.warn("[improve-article] turgenev-fix rejected:", integrity.reason);
      }
    }

    // Save improved content
    await admin.from("articles").update({
      content,
      quality_status: "checking",
      updated_at: new Date().toISOString(),
    }).eq("id", article_id);

    // Re-trigger auto quality check in background
    const reCheck = (async () => {
      try {
        await fetch(`${supabaseUrl}/functions/v1/quality-check`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
          },
          body: JSON.stringify({ article_id, content, mode: "auto" }),
        });
      } catch (e) {
        console.error("[improve-article] re-check failed", e);
      }
    })();
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(reCheck); } catch (_) { void reCheck; }

    return json({ ok: true });
  } catch (e: any) {
    console.error("[improve-article] fatal", e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});