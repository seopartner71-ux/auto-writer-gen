import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Streams one article section from Lovable AI Gateway (OpenAI-compatible SSE),
 * forwarding the raw SSE chunks to the client and persisting the accumulated
 * content + status into public.article_sections.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return j({ error: "Unauthorized" }, 401);
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub as string;
    if (!userId) return j({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const {
      article_id,
      section_id,
      h1_title,
      h2_title,
      all_h2_titles = [],
      section_index = 0,
      total_sections = 1,
      keyword,
      language = "ru",
      persona_prompt = "",
      section_kind = "h2", // intro | h2 | faq | conclusion
      extra_prompt = "",
    } = body || {};

    if (!article_id || !section_id || !h2_title) {
      return j({ error: "article_id, section_id, h2_title required" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!LOVABLE_API_KEY) return j({ error: "OPENROUTER_API_KEY not configured" }, 500);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Mark section as generating
    await admin
      .from("article_sections")
      .update({ status: "generating", error_message: null })
      .eq("id", section_id)
      .eq("user_id", userId);

    const langName: Record<string, string> = {
      ru: "русском", en: "English", es: "Spanish", de: "German",
      fr: "French", pt: "Portuguese", uk: "Ukrainian",
    };
    const langLabel = langName[language] || "English";

    const isRu = language === "ru";
    const rules = isRu
      ? `Жесткие правила форматирования:
- Без жирного (не используй ** или __).
- Тире заменяй на дефис (-).
- В русском НИКОГДА не используй букву 'ё', только 'е'.
- Markdown: используй ## для подзаголовков внутри раздела (если нужно), списки через -, абзацы через пустую строку.
- НЕ повторяй H1 статьи.
- НЕ пиши вводные мета-фразы вроде "В этом разделе мы рассмотрим".`
      : `Strict formatting rules:
- No bold (do not use ** or __).
- Replace em/en dashes with hyphen (-).
- OUTPUT MUST BE 100% ENGLISH. NO CYRILLIC CHARACTERS anywhere.
- Markdown: use ## for subheadings inside the section (if needed), bullet lists with -, paragraphs separated by blank line.
- DO NOT repeat the article H1.
- DO NOT write meta intros like "In this section we will discuss".`;

    let userMsg = "";
    if (section_kind === "intro") {
      userMsg = isRu
        ? `Статья на ${langLabel} языке по теме: "${keyword}".
H1: "${h1_title}"
Структура (H2): ${all_h2_titles.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}

Напиши Введение (~150-200 слов). Direct Answer First: в первом абзаце дай прямой ответ на ключевой запрос пользователя. Без H2 в начале.`
        : `Article in ${langLabel} on the topic: "${keyword}".
H1: "${h1_title}"
Outline (H2): ${all_h2_titles.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}

Write the Introduction (~150-200 words). Direct Answer First: give a direct answer to the user's query in the first paragraph. Do not start with an H2.`;
    } else if (section_kind === "faq") {
      userMsg = isRu
        ? `Тема: "${keyword}" (H1: "${h1_title}"). Язык: ${langLabel}.
Сгенерируй блок "## Часто задаваемые вопросы" с 4-6 короткими Q/A. Формат:
### Вопрос?
Ответ 2-4 предложения.`
        : `Topic: "${keyword}" (H1: "${h1_title}"). Language: ${langLabel}.
Generate a block "## Frequently Asked Questions" with 4-6 short Q/A. Format:
### Question?
Answer in 2-4 sentences.`;
    } else if (section_kind === "conclusion") {
      userMsg = isRu
        ? `Тема: "${keyword}" (H1: "${h1_title}"). Язык: ${langLabel}.
Напиши Заключение (~100-150 слов) с заголовком "## Заключение". Кратко резюмируй и дай практический CTA-вывод без воды.`
        : `Topic: "${keyword}" (H1: "${h1_title}"). Language: ${langLabel}.
Write a Conclusion (~100-150 words) under the heading "## Conclusion". Summarise briefly and give a practical CTA takeaway without filler.`;
    } else {
      userMsg = isRu
        ? `Статья на ${langLabel} языке. Тема: "${keyword}". H1: "${h1_title}".
Полная структура (H2): ${all_h2_titles.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}

Напиши только раздел номер ${section_index} с заголовком:
## ${h2_title}

Объем 250-400 слов. Конкретика, цифры/факты где уместно, без воды. НЕ дублируй контент других H2.`
        : `Article in ${langLabel}. Topic: "${keyword}". H1: "${h1_title}".
Full outline (H2): ${all_h2_titles.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}

Write ONLY section number ${section_index} under the heading:
## ${h2_title}

Length 250-400 words. Concrete details, numbers/facts where relevant, no filler. Do NOT duplicate content from other H2 sections.`;
    }
    if (extra_prompt) userMsg += isRu
      ? `\n\nДополнительные инструкции пользователя:\n${extra_prompt}`
      : `\n\nAdditional user instructions:\n${extra_prompt}`;

    const systemPrompt = isRu
      ? `Ты опытный SEO-копирайтер. Пишешь экспертные статьи для людей.
${persona_prompt ? `\nПерсона автора:\n${persona_prompt}\n` : ""}
${rules}`
      : `You are an experienced SEO copywriter writing expert articles for humans. OUTPUT MUST BE 100% ENGLISH — NO CYRILLIC CHARACTERS.
${persona_prompt ? `\nAuthor persona:\n${persona_prompt}\n` : ""}
${rules}`;

    // EN sections: never use Flash (code-switching risk). Use Sonnet.
    const sectionModel = isRu ? "google/gemini-2.5-flash" : "anthropic/claude-sonnet-4";

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul generate-section-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: sectionModel,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => "");
      await admin
        .from("article_sections")
        .update({ status: "error", error_message: `Gateway ${upstream.status}: ${txt.slice(0, 200)}` })
        .eq("id", section_id);
      if (upstream.status === 429) return j({ error: "Rate limit" }, 429);
      if (upstream.status === 402) return j({ error: "AI credits depleted" }, 402);
      return j({ error: `Gateway ${upstream.status}: ${txt.slice(0, 200)}` }, 500);
    }

    // Pipe SSE to the client while accumulating content
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buf = "";
        let acc = "";
        let lastSavedLen = 0;
        let saveTimer: number | null = null;

        const scheduleSave = () => {
          if (saveTimer != null) return;
          saveTimer = setTimeout(async () => {
            saveTimer = null;
            if (acc.length !== lastSavedLen) {
              lastSavedLen = acc.length;
              try {
                await admin
                  .from("article_sections")
                  .update({ content: acc })
                  .eq("id", section_id);
              } catch (_) { /* ignore */ }
            }
          }, 800) as unknown as number;
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Forward raw chunk
            controller.enqueue(value);
            // Also parse for accumulation
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n")) !== -1) {
              let line = buf.slice(0, idx);
              buf = buf.slice(idx + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const json = JSON.parse(data);
                const delta = json?.choices?.[0]?.delta?.content;
                if (delta) acc += delta;
              } catch { /* partial */ }
            }
            scheduleSave();
          }

          // Final flush
          if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
          let cleaned = acc
            .replace(/\*\*/g, "")
            .replace(/__/g, "")
            .replace(/[—–]/g, "-");
          if (language === "ru") {
            cleaned = cleaned.replace(/ё/g, "е").replace(/Ё/g, "Е");
          }

          await admin
            .from("article_sections")
            .update({
              content: cleaned,
              status: cleaned.trim().length > 0 ? "done" : "error",
              error_message: cleaned.trim().length > 0 ? null : "Пустой ответ модели",
              generated_at: new Date().toISOString(),
            })
            .eq("id", section_id);

          // Log cost (rough — no usage in stream)
          let projectIdForCost: string | null = null;
          try {
            const { data: art } = await admin
              .from("articles").select("project_id").eq("id", article_id).maybeSingle();
            projectIdForCost = art?.project_id || null;
          } catch (_) { /* ignore */ }
          await logCost(admin, {
            user_id: userId,
            project_id: projectIdForCost,
            operation_type: "article_generation",
            model: "google/gemini-2.5-flash",
            tokens_input: Math.ceil(userMsg.length / 4),
            tokens_output: Math.ceil(cleaned.length / 4),
            metadata: {
              kind: "section_stream",
              article_id,
              section_id,
              section_index,
              section_kind,
            },
          });

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (e) {
          console.error("stream error", e);
          try {
            await admin
              .from("article_sections")
              .update({
                status: "error",
                error_message: e instanceof Error ? e.message.slice(0, 300) : "Stream error",
              })
              .eq("id", section_id);
          } catch (_) { /* ignore */ }
          try { controller.close(); } catch (_) { /* ignore */ }
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("generate-section-stream error", e);
    return j({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function j(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}