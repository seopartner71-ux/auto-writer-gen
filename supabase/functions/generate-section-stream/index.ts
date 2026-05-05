import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logCost } from "../_shared/costLogger.ts";
import { buildStealthSystemAddon, applyStealthPostProcess } from "../_shared/stealth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Streams a single H2 section of an article via the Lovable AI Gateway (SSE).
 *
 * Body:
 *   {
 *     article_id: string,
 *     section_id: string,         // row in article_sections
 *     h1_title: string,
 *     h2_title: string,
 *     all_h2_titles: string[],    // for context (avoid duplication)
 *     section_index: number,
 *     total_sections: number,
 *     keyword: string,
 *     language?: string,          // 'ru' | 'en' | ...
 *     persona_prompt?: string,    // author/persona system instruction
 *     section_kind?: 'intro'|'h2'|'faq'|'conclusion'
 *     extra_prompt?: string,      // optional user-edited prompt for this section
 *   }
 *
 * Returns: text/event-stream (OpenAI-compatible deltas).
 * Persists final content to article_sections (status='done') after stream completes.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return json({ error: "Unauthorized" }, 401);
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub as string;
    if (!userId) return json({ error: "Unauthorized" }, 401);

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
      section_kind = "h2",
      extra_prompt = "",
    } = body || {};

    if (!article_id || !section_id || !h2_title) {
      return json({ error: "article_id, section_id, h2_title are required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify ownership of article + section
    const { data: section } = await admin
      .from("article_sections")
      .select("id, user_id, article_id")
      .eq("id", section_id)
      .maybeSingle();
    if (!section || section.user_id !== userId || section.article_id !== article_id) {
      return json({ error: "Forbidden" }, 403);
    }

    // Mark as generating
    await admin
      .from("article_sections")
      .update({ status: "generating", error_message: null })
      .eq("id", section_id);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");

    // Resolve model via admin routing (task_key='section_writer'); default to Gemini Flash.
    const { data: routing } = await admin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "section_writer")
      .maybeSingle();
    const sectionModel = routing?.model_key || "google/gemini-2.5-flash";
    // Anthropic + OpenAI go through OpenRouter; Google stays on Lovable Gateway by default.
    const useOpenRouter = !!OPENROUTER_API_KEY && /^(anthropic|openai)\//.test(sectionModel);
    const aiUrl = useOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    const aiKey = useOpenRouter ? OPENROUTER_API_KEY! : LOVABLE_API_KEY;

    const langName: Record<string, string> = {
      ru: "русском", en: "English", es: "Spanish", de: "German",
      fr: "French", pt: "Portuguese", uk: "Ukrainian", it: "Italian",
    };
    const langLabel = langName[language] || "English";

    const otherH2 = (all_h2_titles as string[])
      .filter((_, i) => i !== section_index)
      .map((t, i) => `  ${i + 1}. ${t}`)
      .join("\n");

    let kindHint = "";
    if (section_kind === "intro") {
      kindHint = "Это вступление статьи. Без H2-заголовка. 2-3 коротких абзаца, заинтриговать и дать прямой ответ.";
    } else if (section_kind === "faq") {
      kindHint = "Сгенерируй блок FAQ из 4-6 вопросов. Каждый вопрос как H3, ответ 2-4 предложения.";
    } else if (section_kind === "conclusion") {
      kindHint = "Заключение: краткие выводы, без воды, 1-2 абзаца.";
    } else {
      kindHint = "Раскрой ТОЛЬКО эту H2-тему, не залезай в темы соседних разделов.";
    }

    const systemPrompt = [
      persona_prompt && `АВТОР И СТИЛЬ:\n${persona_prompt}`,
      `Ты пишешь раздел SEO-статьи на ${langLabel} языке.`,
      `Главное правило: НЕ повторяй контент соседних разделов.`,
      `Формат вывода: Markdown.`,
      `Жёсткие правила форматирования:`,
      `- Без жирного (**) и без подчёркиваний.`,
      `- Тире (—, –) заменяй на дефис (-).`,
      language === "ru" ? `- В русском НИКОГДА не используй букву 'ё', только 'е'.` : "",
      `- Без эмодзи и без воды.`,
      `- Прямой ответ в первых 1-2 предложениях.`,
      buildStealthSystemAddon(language),
    ].filter(Boolean).join("\n");

    const userPrompt = `Статья: "${h1_title}"
Ключевой запрос: ${keyword || h1_title}

Структура всей статьи (для контекста, НЕ дублируй темы):
${otherH2 || "(одиночный раздел)"}

Текущий раздел #${section_index + 1} из ${total_sections}:
## ${h2_title}

${kindHint}

${extra_prompt ? `Дополнительные инструкции пользователя:\n${extra_prompt}\n` : ""}
Объём раздела: 250-450 слов. Начни вывод СРАЗУ с заголовка "## ${h2_title}" (если это не intro/conclusion — тогда без H2).`;

    const upstream = await fetch(aiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: sectionModel,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      await admin.from("article_sections").update({
        status: "error",
        error_message: `Gateway ${upstream.status}: ${txt.slice(0, 200)}`,
      }).eq("id", section_id);
      if (upstream.status === 429) return json({ error: "Rate limit. Try again later." }, 429);
      if (upstream.status === 402) return json({ error: "Lovable AI credits depleted." }, 402);
      return json({ error: `Gateway ${upstream.status}` }, 500);
    }

    // Tee the upstream stream: send to client AND accumulate full text for DB.
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let fullText = "";

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(value);
            buffer += chunk;
            // Parse to accumulate fullText
            let idx: number;
            while ((idx = buffer.indexOf("\n")) !== -1) {
              let line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const j = JSON.parse(data);
                const delta = j?.choices?.[0]?.delta?.content;
                if (delta) fullText += delta;
              } catch { /* partial */ }
            }
          }
        } catch (e) {
          console.error("section stream read error", e);
        } finally {
          controller.close();

          // Sanitize + burstiness post-processing per shared stealth pipeline.
          const cleaned = applyStealthPostProcess(fullText, language);

          if (cleaned.trim().length > 0) {
            await admin.from("article_sections").update({
              status: "done",
              content: cleaned,
              generated_at: new Date().toISOString(),
              error_message: null,
            }).eq("id", section_id);
          } else {
            await admin.from("article_sections").update({
              status: "error",
              error_message: "Empty AI response",
            }).eq("id", section_id);
          }

          // Best-effort cost log (token counts not available from streaming response)
          await logCost(admin, {
            user_id: userId,
            operation_type: "article_generation",
            model: "google/gemini-2.5-flash",
            metadata: { kind: "section", section_id, article_id, section_index },
          });
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e) {
    console.error("generate-section-stream error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}