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
      .select("id,user_id,content,keyword_id,keywords,ai_score,burstiness_status,keyword_density_status,keyword_density")
      .eq("id", article_id).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Article not found" }, 404);

    let content: string = art.content || "";
    if (!content) return json({ error: "Article has no content" }, 400);

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
        content = rewritten.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
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
        content = added.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
      }
    }

    // 3) Burstiness fix: split long sentences (JS post-processor)
    if (burstStatus === "fail" || burstStatus === "warning") {
      // Apply only to text inside <p>/<li> blocks
      content = content.replace(/(<(?:p|li)[^>]*>)([\s\S]*?)(<\/(?:p|li)>)/gi, (_m, open, inner, close) => {
        return `${open}${splitLongSentences(inner)}${close}`;
      });
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