import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Stealth Prompt Builder (Block A + B + C) ───────────────────────────
// SECURITY: This logic NEVER leaves the server. The frontend only sends
// structured data (keyword_id, author_profile_id, outline, etc.).

interface StealthPromptInput {
  authorProfile: {
    name?: string;
    voice_tone?: string;
    niche?: string;
    style_analysis?: Record<string, any>;
    style_examples?: string;
    stop_words?: string[];
    system_prompt_override?: string;
    system_instruction?: string;
    type?: string;
    temperature?: number;
  } | null;
  serpData: { title: string; snippet: string; url: string }[];
  lsiKeywords: string[];
  userStructure: { text: string; level: string }[];
  keyword: {
    seed_keyword: string;
    intent?: string;
    difficulty?: number;
    questions?: string[];
  };
  competitorTables?: any[];
  competitorLists?: any[];
  deepAnalysisContext?: string;
}

function generateStealthPrompt(input: StealthPromptInput): { system: string; user: string } {
  const { authorProfile, serpData, lsiKeywords, userStructure, keyword, competitorTables, competitorLists, deepAnalysisContext } = input;
  const isRussian = /[а-яё]/i.test(keyword.seed_keyword);

  // ═══ BLOCK A: Author Context ═══
  let blockA = "";
  if (authorProfile) {
    const parts: string[] = [];

    // For preset authors: use system_instruction directly as the core directive
    if (authorProfile.type === "preset" && authorProfile.system_instruction) {
      parts.push(`ГЛАВНАЯ ДИРЕКТИВА АВТОРА:\n${authorProfile.system_instruction}`);
    } else {
      // Custom author: build from individual fields
      parts.push(`Ты — ${authorProfile.name || "эксперт"}.`);
      if (authorProfile.voice_tone) parts.push(`Твой стиль: ${authorProfile.voice_tone}. Ты ОБЯЗАН писать в этом стиле КАЖДОЕ предложение.`);
      if (authorProfile.niche) parts.push(`Используй профессиональный сленг ниши "${authorProfile.niche}" естественно, как носитель.`);

      if (authorProfile.style_analysis) {
        const sa = authorProfile.style_analysis;
        if (sa.tone_description) parts.push(`СТИЛЬ ПИСЬМА: ${sa.tone_description}`);
        if (sa.vocabulary_level) parts.push(`УРОВЕНЬ ЛЕКСИКИ: ${sa.vocabulary_level}`);
        if (sa.paragraph_length) parts.push(`ДЛИНА АБЗАЦЕВ: ${sa.paragraph_length}`);
        if (sa.sentence_style) parts.push(`СТИЛЬ ПРЕДЛОЖЕНИЙ: ${sa.sentence_style}`);
        if (sa.metaphor_usage) parts.push(`МЕТАФОРЫ: ${sa.metaphor_usage}`);
        if (sa.formality) parts.push(`ФОРМАЛЬНОСТЬ: ${sa.formality}`);
        if (sa.emotional_tone) parts.push(`ЭМОЦИОНАЛЬНЫЙ ТОН: ${sa.emotional_tone}`);
        if (sa.recommended_system_prompt) parts.push(`ДИРЕКТИВА СТИЛЯ: ${sa.recommended_system_prompt}`);
      }
      if (authorProfile.style_examples) {
        parts.push(`ЭТАЛОННЫЙ ПРИМЕР (копируй этот стиль максимально близко):\n"${authorProfile.style_examples.slice(0, 1500)}"`);
      }
      // Also apply system_instruction for custom authors if they defined one
      if (authorProfile.system_instruction) parts.push(`СИСТЕМНАЯ ИНСТРУКЦИЯ АВТОРА: ${authorProfile.system_instruction}`);
    }

    if (authorProfile.stop_words?.length) parts.push(`ЗАПРЕЩЁННЫЕ СЛОВА (никогда не используй): ${authorProfile.stop_words.join(", ")}`);
    if (authorProfile.system_prompt_override) parts.push(`ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ АВТОРА: ${authorProfile.system_prompt_override}`);

    blockA = `=== БЛОК А: КОНТЕКСТ АВТОРА (критически важно — строго следуй) ===\n${parts.join("\n")}\n=== КОНЕЦ БЛОКА А ===`;
  }

  // ═══ BLOCK B: Factology & Structure ═══
  const outlineStr = (userStructure || [])
    .map((o) => `${{ h1: "#", h2: "##", h3: "###" }[o.level] || "##"} ${o.text}`)
    .join("\n");

  const competitorStr = (serpData || [])
    .map((r, i) => `${i + 1}. "${r.title}" — ${r.snippet || ""}`)
    .join("\n");

  const lsiStr = lsiKeywords.join(", ");
  const questionsStr = (keyword.questions || []).join("\n- ");

  let tablesListsInstructions = "";
  if (competitorTables?.length) {
    tablesListsInstructions += "\n\nТАБЛИЦЫ (по данным анализа конкурентов):\n";
    competitorTables.forEach((t: any, i: number) => {
      tablesListsInstructions += `${i + 1}. Таблица о "${t.topic}" с колонками: ${(t.columns || []).join(" | ")}\n`;
    });
    tablesListsInstructions += "Создай эти таблицы с реальными полезными данными. Используй Markdown-синтаксис.";
  }
  if (competitorLists?.length) {
    tablesListsInstructions += "\n\nСПИСКИ (по данным анализа конкурентов):\n";
    competitorLists.forEach((l: any, i: number) => {
      tablesListsInstructions += `${i + 1}. ${l.type === "numbered" ? "Нумерованный" : l.type === "checklist" ? "Чеклист" : "Маркированный"} список о "${l.topic}"${l.estimated_items ? ` (~${l.estimated_items} пунктов)` : ""}\n`;
    });
    tablesListsInstructions += "Включи эти списки естественно в соответствующие разделы.";
  }

  const blockB = `=== БЛОК Б: ФАКТОЛОГИЯ И СТРУКТУРА ===
Основывайся на данных из ТОП-выдачи:
${competitorStr || "Нет данных конкурентов"}

Вплети LSI-слова естественно: ${lsiStr || "Нет LSI"}

Соблюдай структуру:
${outlineStr || "Напиши комплексную статью по теме"}
${tablesListsInstructions}
${deepAnalysisContext ? `\nДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИЗ DEEP ANALYSIS ТОП-10:\n${deepAnalysisContext}` : ""}
=== КОНЕЦ БЛОКА Б ===`;

  // ═══ BLOCK C: Stealth Instructions (Anti-AI Detection) ═══
  // CRITICAL: These instructions NEVER leave the server
  const blockC = `=== БЛОК В: STEALTH-ИНСТРУКЦИИ (МАКСИМАЛЬНЫЙ ПРИОРИТЕТ) ===

ТЕХНИКА "Dynamic Burstiness":
- Чередуй ОЧЕНЬ короткие предложения (3-5 слов) с длинными ветвистыми конструкциями (25-40 слов).
- Минимум 30% предложений должны быть короче 8 слов. Минимум 20% — длиннее 25 слов.
- Никогда не пиши 3+ предложения подряд одинаковой длины.

ТЕХНИКА "High Perplexity":
${isRussian
  ? `- Замени предсказуемые связки на живые авторские обороты:
  "таким образом" → "суть в том", "на деле мы видим", "смотрите сами"
  "важно отметить" → "вот что цепляет", "тут есть нюанс", "обратите внимание на деталь"
  "в заключение" → "что в итоге", "подведём черту", "если коротко"
  "необходимо учитывать" → "нельзя забывать про", "упустишь это — получишь проблемы"
  "следует подчеркнуть" → "ключевой момент здесь", "это принципиально"
  "является" → "это", "по сути", "работает как"
  "осуществлять" → "делать", "проводить", "заниматься"
  "данный" → "этот", "такой"
  "в рамках" → "внутри", "как часть"
  "на сегодняшний день" → "сейчас", "прямо сейчас"
  "комплексный подход" → "разносторонний взгляд", "подход с нескольких сторон"`
  : `- Replace predictable connectors with authentic authorial phrases:
  "in conclusion" → "bottom line", "here's the takeaway", "cutting to the chase"
  "it's important to note" → "here's what matters", "don't miss this", "the key thing"
  "furthermore" → "and here's the kicker", "on top of that", "what's more interesting"
  "utilize" → "use", "tap into", "lean on"
  "comprehensive" → "thorough", "all-encompassing", "deep-dive"
  "leverage" → "take advantage of", "build on", "harness"
  "streamline" → "simplify", "cut the fat", "make leaner"`}

ЗАПРЕЩЁННЫЕ ПАТТЕРНЫ (нарушение = провал проверки):
- НЕ используй списки из 5+ пунктов одинаковой длины. Варьируй: один пункт — 3 слова, другой — целое предложение.
- НЕ пиши вывод в стиле "${isRussian ? "В заключение..." : "In conclusion..."}". Заверши мысль неожиданно.
- НЕ начинай абзацы с одного и того же паттерна. Первый — с факта, второй — с вопроса, третий — с цитаты.
- НЕ используй "Moreover", "Furthermore", "Additionally", "It's worth noting" или их русские аналоги.
- НЕ пиши параграфы одинаковой длины. Один — 1-2 предложения, следующий — 4-5.

ОБЯЗАТЕЛЬНЫЕ СТИЛИСТИЧЕСКИЕ ПРИЁМЫ:
- Добавь 3-4 риторических вопроса в тело статьи (не в FAQ). Используй их для перехода между мыслями.
- Вставь 2-3 вводных слова/фразы В СЕРЕДИНУ предложений, а не в начало (разбивая привычный порядок).
- Добавь 1-2 момента лёгкой иронии или скептицизма — покажи, что автор думающий человек, а не машина.
- Используй парентетические вставки (вот как эта) — 2-3 раза в статье.
- Включи конкретные числа, даты, имена вместо абстрактных обобщений.

ГОЛОС И ПОДАЧА:
${isRussian
  ? `- Используй разговорные выражения, идиомы ("Честно говоря", "Давайте разберёмся", "Вот в чём дело", "Знаете что?").
- Включи личные мнения и субъективные оценки от первого лица ("Я считаю", "По моему опыту", "На мой взгляд", "Меня это удивило").
- Активный залог доминирует. Пассив — максимум 10% предложений.
- Эмоциональная вовлечённость: показывай энтузиазм, скептицизм, удивление где уместно.`
  : `- Use colloquial expressions, idioms naturally.
- Include personal opinions ("I believe", "In my experience", "From what I've seen", "This surprised me").
- Active voice dominant. Passive — max 10% of sentences.
- Show emotional engagement: enthusiasm, skepticism, surprise where appropriate.`}

РАНДОМИЗАЦИЯ (обязательно):
- Случайным образом измени порядок двух любых аргументов в тексте, чтобы избежать шаблонности.
- Каждый раз начинай статью по-разному: иногда с факта, иногда с вопроса, иногда с цитаты.

=== КОНЕЦ БЛОКА В ===`;

  // ═══ Assemble System Prompt ═══
  const systemPrompt = `Ты — экспертный SEO-копирайтер с уникальным авторским почерком.${authorProfile ? " Пиши КАК автор, описанный в Блоке А — каждое предложение должно звучать как его/её текст." : ""}

${blockA}

БАЗОВЫЕ ПРАВИЛА:
- Следуй структуре заголовков из Блока Б
- Естественно вплетай LSI-ключевые слова
- Пиши на том же языке, что и ключевое слово
- Формат — ЧИСТЫЙ Markdown (# h1, ## h2, ### h3)

ПРАВИЛА ОФОРМЛЕНИЯ ЗАГОЛОВКОВ (КРИТИЧЕСКИ ВАЖНО):
- Заглавная буква ТОЛЬКО в начале заголовка и в именах собственных (бренды, города, имена людей). НЕ пиши Каждое Слово С Большой Буквы.
- Используй дефис "-" вместо тире "—" в заголовках и тексте. НИКОГДА не используй длинное тире (—).
- Пример правильно: "## Цветы в интерьере - как преобразить комнату"
- Пример неправильно: "## Цветы В Интерьере — Как Преобразить Комнату"

- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать HTML-теги с атрибутом style. Никаких inline-стилей (style="..."). Никаких <span>, <p>, <div> с цветами или стилями.
- Весь вывод — ТОЛЬКО чистый Markdown без HTML-разметки. Единственное исключение — комментарий <!-- FAQ Schema -->.

ОБЯЗАТЕЛЬНЫЕ ЭЛЕМЕНТЫ ФОРМАТИРОВАНИЯ (включай в КАЖДУЮ статью):
- ТАБЛИЦЫ: Минимум 1-2 сравнительные таблицы с реальными данными. Используй Markdown: | Колонка1 | Колонка2 | с разделителем |---|---|
- СПИСКИ: Минимум 2-3 маркированных или нумерованных списка в разных разделах. Варьируй типы (буллеты, нумерация, чеклисты).
- ЦИТАТЫ: Минимум 1-2 экспертных цитаты или важных выделений через Markdown blockquote (> текст цитаты). Используй для ключевых инсайтов, статистики или экспертных мнений.
- Эти элементы должны быть распределены естественно по тексту, а не сконцентрированы в одном месте.

КРИТИЧЕСКОЕ ПРАВИЛО ЯЗЫКА: ВСЯ статья ДОЛЖНА быть на том же языке, что и ключевое слово "${keyword.seed_keyword}". ${isRussian ? "Ключевое слово на русском — пиши ВСЁ на русском." : "Write in the language of the keyword."}

${blockC}

FAQ (ОБЯЗАТЕЛЬНО):
- В конце статьи добавь "${isRussian ? "## Часто задаваемые вопросы (FAQ)" : "## Frequently Asked Questions (FAQ)"}"
- Минимум 5 вопросов и ответов
- Формат: "### <Вопрос>\\n<Ответ 2-4 предложения>"
- Оберни секцию комментарием <!-- FAQ Schema -->
- FAQ на том же языке, что и статья`;

  return { system: systemPrompt, user: "" }; // user prompt built separately
}

// ─── Optimization Mode User Prompt ──────────────────────────────────────
function buildOptimizeUserPrompt(
  keyword: any, lsiStr: string, questionsStr: string,
  existingContent: string, optimizeInstructions: string, deepContext?: string
): string {
  return `КЛЮЧЕВОЕ СЛОВО: "${keyword.seed_keyword}"
ИНТЕНТ: ${keyword.intent || "informational"}

ТЕКУЩАЯ СТАТЬЯ (для улучшения):
${existingContent}

ИНСТРУКЦИИ ПО ОПТИМИЗАЦИИ (на основе сравнения с ТОП-10):
${optimizeInstructions}

БЕНЧМАРК ТОП-10:
${deepContext || "Нет дополнительного контекста."}

LSI-КЛЮЧИ:
${lsiStr || "Нет"}

ВОПРОСЫ ПОЛЬЗОВАТЕЛЕЙ:
${questionsStr ? `- ${questionsStr}` : "Нет"}

ЗАДАЧА: Перепиши и расширь статью, исправив ВСЕ перечисленные проблемы. Сохрани хорошее, но используй данные бенчмарка ТОП-10 для:
- добавления недостающих разделов и подтем;
- добавления недостающих сущностей, терминов и LSI-фраз;
- выравнивания глубины и полноты с лидерами ТОП-10;
- улучшения полезности и экспертности.

Верни ПОЛНУЮ улучшенную статью в Markdown.`;
}

function buildNewArticleUserPrompt(
  keyword: any, outlineStr: string, competitorStr: string,
  lsiStr: string, questionsStr: string
): string {
  return `КЛЮЧЕВОЕ СЛОВО: "${keyword.seed_keyword}"
ИНТЕНТ: ${keyword.intent || "informational"}

ПЛАН СТАТЬИ:
${outlineStr || "Напиши комплексную статью по теме"}

ДАННЫЕ КОНКУРЕНТОВ:
${competitorStr || "Нет данных"}

LSI-КЛЮЧИ:
${lsiStr || "Нет"}

ВОПРОСЫ ПОЛЬЗОВАТЕЛЕЙ:
${questionsStr ? `- ${questionsStr}` : "Нет"}

РЕКОМЕНДУЕМЫЙ ОБЪЁМ: ${keyword.difficulty && keyword.difficulty > 50 ? "2000-3000" : "1500-2000"} слов

Напиши полную статью.`;
}

// ─── Main Handler ───────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin0 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: orKey } = await supabaseAdmin0.from("api_keys").select("api_key").eq("provider", "openrouter").eq("is_valid", true).single();
    const OPENROUTER_API_KEY = orKey?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OpenRouter API key not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const { keyword_id, author_profile_id, outline, lsi_keywords, competitor_tables, competitor_lists, deep_analysis_context, optimize_instructions, existing_content } = await req.json();
    if (!keyword_id) throw new Error("keyword_id is required");

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get user profile for tier and credits
    const { data: profile } = await supabase.from("profiles").select("plan, credits_amount").eq("id", user.id).single();
    const userPlan = profile?.plan || "basic";
    const credits = profile?.credits_amount ?? 0;

    // Check credits before generation
    if (credits <= 0) {
      return new Response(JSON.stringify({ error: "Недостаточно кредитов. Пополните баланс." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get model assignment
    const writerTask = userPlan === "pro" ? "writer_pro" : "writer_basic";
    const { data: assignment } = await supabaseAdmin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", writerTask)
      .single();
    const fallbackModel = userPlan === "pro" ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash-lite";
    const model = assignment?.model_key || fallbackModel;

    // Get keyword
    const { data: keyword } = await supabase.from("keywords").select("*").eq("id", keyword_id).single();
    if (!keyword) throw new Error("Keyword not found");

    // Get SERP results
    const { data: serpResults } = await supabase
      .from("serp_results")
      .select("title, snippet, url")
      .eq("keyword_id", keyword_id)
      .order("position", { ascending: true })
      .limit(10);

    // Get author profile (use admin client for presets which have null user_id)
    let authorData: any = null;
    if (author_profile_id) {
      const { data: author } = await supabaseAdmin
        .from("author_profiles")
        .select("*")
        .eq("id", author_profile_id)
        .single();
      authorData = author;
    }

    // Build stealth prompt via server-side function
    const stealthInput: StealthPromptInput = {
      authorProfile: authorData,
      serpData: (serpResults || []).map((r: any) => ({ title: r.title || "", snippet: r.snippet || "", url: r.url || "" })),
      lsiKeywords: lsi_keywords || keyword.lsi_keywords || [],
      userStructure: outline || [],
      keyword: {
        seed_keyword: keyword.seed_keyword,
        intent: keyword.intent,
        difficulty: keyword.difficulty,
        questions: keyword.questions,
      },
      competitorTables: competitor_tables,
      competitorLists: competitor_lists,
      deepAnalysisContext: deep_analysis_context,
    };

    const { system: systemPrompt } = generateStealthPrompt(stealthInput);

    // Build user prompt
    const lsiStr = (lsi_keywords || keyword.lsi_keywords || []).join(", ");
    const questionsStr = (keyword.questions || []).join("\n- ");
    const outlineStr = (outline || [])
      .map((o: any) => `${{ h1: "#", h2: "##", h3: "###" }[o.level] || "##"} ${o.text}`)
      .join("\n");
    const competitorStr = (serpResults || [])
      .map((r: any, i: number) => `${i + 1}. "${r.title}" — ${r.snippet || ""}`)
      .join("\n");

    let userPrompt: string;
    if (optimize_instructions && existing_content) {
      userPrompt = buildOptimizeUserPrompt(keyword, lsiStr, questionsStr, existing_content, optimize_instructions, deep_analysis_context);
    } else {
      userPrompt = buildNewArticleUserPrompt(keyword, outlineStr, competitorStr, lsiStr, questionsStr);
    }

    // Use author's temperature if set, otherwise default
    const authorTemperature = authorData?.temperature ? Number(authorData.temperature) : 0.85;

    // Stream AI response
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        temperature: authorTemperature,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    // Deduct credit after successful generation start
    await supabaseAdmin.rpc("deduct_credit", { p_user_id: user.id });

    // Log usage
    supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      action: "generate_article",
      model_used: model,
      tokens_used: 0,
    }).then(() => {});

    return new Response(aiResponse.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("generate-article error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
