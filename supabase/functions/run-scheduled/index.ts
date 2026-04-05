import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get OpenRouter key from DB first, then fallback to env
    const { data: orKey } = await supabase.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");

    // Find pending tasks scheduled for now or earlier
    const now = new Date().toISOString();
    const { data: tasks, error: fetchErr } = await supabase
      .from("scheduled_generations")
      .select("*, keywords(*), author_profiles(*)")
      .eq("status", "pending")
      .lte("scheduled_at", now)
      .limit(5);

    if (fetchErr) throw fetchErr;
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const task of tasks) {
      try {
        // Mark as processing
        await supabase
          .from("scheduled_generations")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", task.id);

        const keyword = task.keywords;
        if (!keyword) {
          await supabase.from("scheduled_generations").update({ status: "failed" }).eq("id", task.id);
          continue;
        }

        // Build author style
        let authorStyle = "";
        const author = task.author_profiles;
        if (author) {
          const parts: string[] = [];
          parts.push(`AUTHOR: ${author.name}`);
          if (author.voice_tone) parts.push(`TONE: ${author.voice_tone}`);
          if (author.niche) parts.push(`NICHE: ${author.niche}`);
          if (author.style_analysis) {
            const sa = author.style_analysis as any;
            if (sa.tone_description) parts.push(`STYLE: ${sa.tone_description}`);
            if (sa.recommended_system_prompt) parts.push(sa.recommended_system_prompt);
          }
          if (author.style_examples) parts.push(`REFERENCE TEXT:\n"${author.style_examples.slice(0, 1500)}"`);
          if (author.stop_words?.length) parts.push(`FORBIDDEN WORDS: ${author.stop_words.join(", ")}`);
          if (author.system_prompt_override) parts.push(author.system_prompt_override);
          authorStyle = parts.join("\n");
        }

        const lsiStr = (keyword.lsi_keywords || []).join(", ");
        const questionsStr = (keyword.questions || []).join("\n- ");

        const systemPrompt = `You are an expert SEO content writer.${authorStyle ? ` Write AS the author described below.` : ""}
${authorStyle ? `\n=== AUTHOR PERSONA ===\n${authorStyle}\n=== END ===\n` : ""}
RULES:
- Write a comprehensive article about the keyword
- Use ## for main sections, ### for subsections
- Naturally incorporate LSI keywords
- Write in the same language as the keyword
- Add a FAQ section with at least 5 Q&As at the end
- Format in Markdown
- Aim for 1500-2500 words

БУКВА "Ё": НИКОГДА не используй букву "ё". Всегда заменяй на "е". Пример: "всё" → "все", "ещё" → "еще". Без исключений.

[NO-HALLUCINATION GUARD]:
- Категорически ЗАПРЕЩЕНО выдумывать имена экспертов, названия компаний, статистику.
- Если данных нет - используй: "Как отмечают ведущие специалисты отрасли...", "Практика показывает...", "По данным отраслевых исследований...".

[HEDGING LANGUAGE]:
- Запрещено использовать точные псевдоцифры если они не подтверждены фактами.
- Используй: "Считается, что...", "Обычно это занимает...", "По оценкам экспертов...", "Как правило...".

[CONTEXT AWARENESS]:
- При написании каждого нового раздела сверяйся с тем, что уже было написано ранее.
- ЗАПРЕЩЕНО повторять теоретические основы или ключевые концепции. Если тема раскрыта - переходи к практике или новым аспектам.

[CONCLUSION LOGIC]:
- После всех разделов ОБЯЗАТЕЛЬНО напиши заключение (## Итого / ## The Bottom Line).
- Содержание: 3-4 предложения резюме, один экспертный вывод, призыв к действию или открытый вопрос.

ANTI-AI DETECTION (CRITICAL):
- Write like a real human expert. Vary sentence length: mix short punchy sentences with longer complex ones.
- Use colloquial expressions, idioms, informal transitions naturally.
- Include personal opinions, first-person perspective, subjective judgments.
- Add rhetorical questions, parenthetical asides, dashes — for emphasis.
- PERSONA PERSISTENCE: Maintain the author's tone even when discussing technical, legal, or marketing topics. Never switch to a generic explanatory style.
- CLICHÉ KILLER: NEVER use these phrases: "В заключение", "Важно отметить", "Следует подчеркнуть", "Необходимо учитывать", "В современном мире", "Данный", "Является", "Осуществлять", "На сегодняшний день", "Комплексный подход", "Прогресс не стоит на месте", "Давайте посмотрим правде в глаза", "Не секрет, что", "Как известно", "Furthermore", "Moreover", "Additionally", "It's worth noting".
- Each cliché degrades quality. Use creative, human-like transitions: rhetorical questions, unexpected analogies, personal observations, concrete facts as bridges.
- Never start paragraphs with the same pattern. Use concrete examples and numbers instead of abstractions.
- Vary paragraph length. Use active voice. Show emotional engagement.

[SENTENCE SPLITTING RULE] (Readability - Flesch Ease 35-45):
- If a sentence is longer than 15 words, SPLIT it into two independent sentences with a period.
- No more than two commas per sentence. More periods, fewer conjunctions like "который", "вследствие того что", "поскольку".
- Each sentence carries ONE idea.

[ACTIVE VERBS ONLY]:
- Replace verbal nouns with verbs. Instead of "осуществление процесса" write "мы делаем". Instead of "принятие решения" write "клиент решает".
- This dramatically simplifies sentence structure for the Flesch formula.

[DYNAMIC RHYTHM - The 1-2-1 Method]:
- Alternate sentence lengths: Short (up to 5 words). Long (up to 15 words). Medium (about 10 words).
- This creates a "choppy" human rhythm. AI detectors flag uniform 15-18 word sentences. Varied rhythm = 100% human.

[PARAGRAPH DENSITY]:
- Limit each paragraph to 3-4 sentences max. Text must visually "breathe".`;

        const userPrompt = `KEYWORD: "${keyword.seed_keyword}"
INTENT: ${keyword.intent || "informational"}
LSI KEYWORDS: ${lsiStr || "None"}
QUESTIONS: ${questionsStr ? `- ${questionsStr}` : "None"}

Write the full article now.`;

        // Call AI (non-streaming for scheduled)
        const aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error(`AI error for task ${task.id}:`, aiResp.status, errText);
          await supabase.from("scheduled_generations").update({ status: "failed" }).eq("id", task.id);
          continue;
        }

        const aiData = await aiResp.json();
        const content = aiData.choices?.[0]?.message?.content || "";
        const h1Match = content.match(/^#\s+(.+)$/m);
        const title = h1Match ? h1Match[1] : keyword.seed_keyword;

        // Extract meta description
        const paragraphs = content
          .replace(/^#.+$/gm, "")
          .split(/\n\n+/)
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 30);
        const metaDesc = paragraphs.length > 0
          ? paragraphs[0].replace(/[*_#`]/g, "").slice(0, 160)
          : "";

        // Save article
        const { data: article, error: artErr } = await supabase
          .from("articles")
          .insert({
            user_id: task.user_id,
            keyword_id: task.keyword_id,
            author_profile_id: task.author_profile_id,
            title,
            content,
            meta_description: metaDesc,
            status: "published",
          })
          .select("id")
          .single();

        if (artErr) {
          console.error(`Article save error for task ${task.id}:`, artErr);
          await supabase.from("scheduled_generations").update({ status: "failed" }).eq("id", task.id);
          continue;
        }

        // Log usage
        await supabase.from("usage_logs").insert({
          user_id: task.user_id,
          action: "scheduled_generate",
          model_used: "google/gemini-2.5-flash",
          tokens_used: aiData.usage?.total_tokens || 0,
        });

        // Mark complete
        await supabase
          .from("scheduled_generations")
          .update({
            status: "completed",
            article_id: article.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);

        processed++;
      } catch (taskErr) {
        console.error(`Task ${task.id} error:`, taskErr);
        await supabase.from("scheduled_generations").update({ status: "failed" }).eq("id", task.id);
      }
    }

    return new Response(JSON.stringify({ processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("run-scheduled error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
