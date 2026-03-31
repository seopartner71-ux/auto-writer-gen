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
    is_miralinks_profile?: boolean;
    is_gogetlinks_profile?: boolean;
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
  miralinksLinks?: { url: string; anchor: string }[];
  gogetlinksLinks?: { url: string; anchor: string }[];
  includeExpertQuote?: boolean;
  includeComparisonTable?: boolean;
  dataNuggets?: string[];
}

function generateStealthPrompt(input: StealthPromptInput): { system: string; user: string } {
  const { authorProfile, serpData, lsiKeywords, userStructure, keyword, competitorTables, competitorLists, deepAnalysisContext, includeExpertQuote, includeComparisonTable, dataNuggets } = input;
  const isRussian = /[а-яё]/i.test(keyword.seed_keyword);
  const targetLanguage = isRussian ? "ru" : "en";

  // ═══ BLOCK A: Author Context ═══
  let blockA = "";
  if (authorProfile) {
    const parts: string[] = [];

    // For preset authors: use system_instruction directly as the core directive
    if (authorProfile.type === "preset" && authorProfile.system_instruction) {
      parts.push(`ГЛАВНАЯ ДИРЕКТИВА АВТОРА (НАИВЫСШИЙ ПРИОРИТЕТ - перекрывает любые другие правила ниже):\n${authorProfile.system_instruction}`);
    } else {
      // Custom author: build from individual fields
      parts.push(`Ты - ${authorProfile.name || "эксперт"}.`);
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
      // system_instruction for custom authors has HIGHEST priority
      if (authorProfile.system_instruction) parts.push(`СИСТЕМНАЯ ИНСТРУКЦИЯ АВТОРА (НАИВЫСШИЙ ПРИОРИТЕТ - если конфликтует с базовыми правилами, следуй инструкции автора):\n${authorProfile.system_instruction}`);
    }

    if (authorProfile.stop_words?.length) parts.push(`ЗАПРЕЩЁННЫЕ СЛОВА (никогда не используй): ${authorProfile.stop_words.join(", ")}`);
    if (authorProfile.system_prompt_override) parts.push(`ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ АВТОРА: ${authorProfile.system_prompt_override}`);

    if (!isRussian) {
      parts.push(`IMPORTANT: The author persona above may be described in Russian, but you MUST write the article in ENGLISH. Apply the author's tone, style, and voice in English writing.`);
    }
    blockA = `=== БЛОК А: КОНТЕКСТ АВТОРА (критически важно - строго следуй) ===\n${parts.join("\n")}\n=== КОНЕЦ БЛОКА А ===`;
  }

  // ═══ MIRALINKS BLOCK (hardcoded rules for Miralinks profiles OR when links provided) ═══
  let blockMiralinks = "";
  const activeLinks = (input.miralinksLinks || []).filter(l => l.url && l.anchor);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const storageBucketUrl = `${supabaseUrl}/storage/v1/object/public/article-images`;

  if (authorProfile?.is_miralinks_profile || activeLinks.length > 0) {
    const linksInstructions = activeLinks
      .map((l, i) => `Ссылка ${i + 1}: Точный URL="${l.url}", Точный текст анкора="${l.anchor}". В статье ОБЯЗАН появиться Markdown: [${l.anchor}](${l.url})`)
      .join("\n");

    blockMiralinks = `=== БЛОК MIRALINKS: ВСТАВКА ССЫЛОК КЛИЕНТА (АБСОЛЮТНЫЙ ПРИОРИТЕТ) ===

ССЫЛКИ КЛИЕНТА (ВСТАВИТЬ В ТОЧНОСТИ КАК УКАЗАНО):
${linksInstructions || "Ссылки не предоставлены"}

ПРАВИЛА РАЗМЕЩЕНИЯ ССЫЛОК:
- Используй ТОЧНО ТЕ URL и анкоры, которые указаны выше. НЕ ПРИДУМЫВАЙ свои ссылки, НЕ МЕНЯЙ URL.
- Формат каждой ссылки в тексте: [точный анкор клиента](точный URL клиента)
- Впиши каждую ссылку органично в предложение, чтобы анкор был естественной частью текста.
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО ставить ссылки в ПЕРВОМ и ПОСЛЕДНЕМ абзацах текста.
- Окружи каждую ссылку релевантным контекстом (минимум 2-3 предложения вокруг).
- ПЕРВАЯ ссылка должна быть размещена на отметке примерно 20% текста от начала (то есть после первой пятой части статьи).
- Остальные ссылки распредели равномерно по оставшейся центральной части (между 20% и 80% текста).
- Последняя ссылка должна быть НЕ ПОЗЖЕ 80% текста от начала.

ОБЪЁМ КОНТЕНТА:
- Минимальный объём статьи - 2500 знаков без пробелов.
- Если фактов не хватает, раскрой тему глубже, используя данные из анализа конкурентов.
- Оптимальный объём: 3000-5000 знаков.

ИЗОБРАЖЕНИЯ (количество зависит от объёма статьи):
- До 1000 слов: 1-2 изображения
- 1000-2000 слов: 2-3 изображения
- 2000-3000 слов: 3-4 изображения
- Более 3000 слов: 4-5 изображений
- Формат: ![ALT-текст с LSI-ключами](${storageBucketUrl}/placeholder.jpg)
- ALT-текст ОБЯЗАТЕЛЬНО должен содержать LSI-ключевые слова статьи.
- Используй для изображений URL-адреса из хранилища: ${storageBucketUrl}/
- Размести изображения равномерно по тексту, не в начале и не в конце.
- Каждое изображение должно быть тематически связано с окружающим текстом.

ТАБЛИЦЫ:
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать таблицы в тексте. НЕ используй Markdown-таблицы. Всю информацию подавай через маркированные или нумерованные списки, либо обычным текстом.

ТОН И СТИЛЬ:
- Информационный, экспертный стиль. Как в авторитетном отраслевом журнале.
- ЗАПРЕЩЕНО: агрессивные продажи, маркетинговые штампы, призывы "купить/заказать прямо сейчас".
- Статья должна быть полезной и решать реальную проблему читателя.

SEO TITLE И META DESCRIPTION (ОБЯЗАТЕЛЬНО):
- Title (SEO-заголовок): 50-60 символов, содержит основное ключевое слово в начале, привлекающий внимание, уникальный.
- Meta Description: 120-160 символов, содержит ключевое слово, призыв к действию или ценностное предложение, уникальное описание.
- Title НЕ должен совпадать с H1 статьи — это разные элементы.
- Оба мета-тега ОБЯЗАТЕЛЬНЫ для прохождения модерации.

=== КОНЕЦ БЛОКА MIRALINKS ===`;
  }

  // ═══ GOGETLINKS BLOCK ═══
  let blockGoGetLinks = "";
  const activeGGLLinks = (input.gogetlinksLinks || []).filter(l => l.url && l.anchor);

  if (authorProfile?.is_gogetlinks_profile || activeGGLLinks.length > 0) {
    const linksInstructions = activeGGLLinks
      .map((l, i) => `Ссылка ${i + 1}: Точный URL="${l.url}", Точный текст анкора="${l.anchor}". В статье ОБЯЗАН появиться Markdown: [${l.anchor}](${l.url})`)
      .join("\n");

    blockGoGetLinks = `=== БЛОК GOGETLINKS: КОНТЕКСТНЫЕ ССЫЛКИ (АБСОЛЮТНЫЙ ПРИОРИТЕТ) ===

ССЫЛКИ КЛИЕНТА (ВСТАВИТЬ В ТОЧНОСТИ КАК УКАЗАНО):
${linksInstructions || "Ссылки не предоставлены"}

ПРАВИЛА РАЗМЕЩЕНИЯ ССЫЛОК (GoGetLinks):
- Используй ТОЧНО ТЕ URL и анкоры, которые указаны выше. НЕ ПРИДУМЫВАЙ свои ссылки.
- Формат: [точный анкор](точный URL)
- Ссылки должны быть КОНТЕКСТНЫМИ — органично вписаны в текст.
- ЗАПРЕЩЕНО ставить ссылки в ПЕРВОМ и ПОСЛЕДНЕМ абзацах.
- Анкоры должны быть естественными, без спамных коммерческих фраз.
- Окружи каждую ссылку релевантным контекстом (минимум 2-3 предложения вокруг).
- Распредели ссылки равномерно по центральной части текста (20%-80%).

ОБЪЁМ КОНТЕНТА:
- Минимум 300 слов (2000+ знаков без пробелов).
- Оптимальный объём: 2000-4000 знаков.
- Текст должен быть полностью уникальным.

ИЗОБРАЖЕНИЯ:
- 1-3 изображения с alt-тегами.
- Формат: ![ALT-текст](${supabaseUrl}/storage/v1/object/public/article-images/placeholder.jpg)
- Размести равномерно по тексту.

ТОН И СТИЛЬ:
- Информационный, экспертный, естественный язык.
- ЗАПРЕЩЕНО: агрессивные продажи, спамные фразы, переоптимизация.

SEO TITLE И META DESCRIPTION (ОБЯЗАТЕЛЬНО):
- Title: 50-70 символов, содержит ключевое слово.
- Meta Description: 120-160 символов, уникальное описание.
- Title НЕ должен совпадать с H1.

=== КОНЕЦ БЛОКА GOGETLINKS ===`;
  }

  const outlineStr = (userStructure || [])
    .map((o) => `${{ h1: "#", h2: "##", h3: "###" }[o.level] || "##"} ${o.text}`)
    .join("\n");

  const competitorStr = (serpData || [])
    .map((r, i) => `${i + 1}. "${r.title}" - ${r.snippet || ""}`)
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

  const lsiCount = lsiKeywords.length;
  const blockB = `=== БЛОК Б: ФАКТОЛОГИЯ И СТРУКТУРА ===
Основывайся на данных из ТОП-выдачи:
${competitorStr || "Нет данных конкурентов"}

LSI-КЛЮЧЕВЫЕ СЛОВА (ОБЯЗАТЕЛЬНО ИСПОЛЬЗОВАТЬ):
${lsiStr || "Нет LSI"}
${lsiCount > 0 ? `
⚠️ КРИТИЧЕСКОЕ ТРЕБОВАНИЕ ПО LSI:
- Всего LSI-ключей: ${lsiCount}
- Ты ОБЯЗАН использовать МИНИМУМ ${Math.max(1, Math.ceil(lsiCount * 0.8))} из ${lsiCount} LSI-ключей (80%+).
- Каждый LSI-ключ должен появиться в тексте хотя бы 1 раз, естественно вписанным в контекст.
- НЕ ГРУППИРУЙ все LSI-ключи в одном абзаце — распредели их РАВНОМЕРНО по всей статье.
- Используй LSI-ключи в разных формах: в заголовках, в тексте абзацев, в списках, в подписях к изображениям.
- Приоритетные LSI (первые 5): вплети в H2/H3 заголовки и первые абзацы соответствующих секций.` : ""}

Соблюдай структуру:
${outlineStr || "Напиши комплексную статью по теме"}
${tablesListsInstructions}
${deepAnalysisContext ? `\nДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ ИЗ DEEP ANALYSIS ТОП-10:\n${deepAnalysisContext}` : ""}
=== КОНЕЦ БЛОКА Б ===`;

  // ═══ BLOCK C: Stealth Instructions (Anti-AI Detection) ═══
  // CRITICAL: These instructions NEVER leave the server
  const blockC = `=== БЛОК В: GLOBAL STEALTH PROTOCOL (МАКСИМАЛЬНЫЙ ПРИОРИТЕТ) ===

LANGUAGE DETECTION: Target language is "${targetLanguage}". Apply ALL rules below according to ${isRussian ? "Russian" : "English"} linguistic norms.

ТЕХНИКА "Dynamic Burstiness" (Sentence Rhythm):
- Break the "rhythmic symmetry". Follow this sequence pattern:
  [Short punchy sentence (3-5 words)] -> [Medium complex sentence] -> [Long descriptive sentence with sub-clauses] -> [Short summary].
- Минимум 30% предложений должны быть короче 8 слов. Минимум 20% - длиннее 25 слов.
- Никогда не пиши 3+ предложения подряд одинаковой длины.
- Use dashes (-), colons (:), and parentheses (author's side-notes like this one) to simulate human thought processes.

ТЕХНИКА "High Perplexity" (Unpredictability):
${isRussian
  ? `- ЗАПРЕЩЁННЫЕ ИИ-переходы и клише (CLICHÉ KILLER):
  "является" → "это", "по сути", "работает как"
  "данный" → "этот", "такой"
  "стоит отметить" → "вот что цепляет", "тут есть нюанс"
  "в заключение" → "что в итоге", "подведём черту", "если коротко"
  "важно отметить" → "обратите внимание на деталь", "ключевой момент"
  "следует подчеркнуть" → "это принципиально", "тут без вариантов"
  "необходимо учитывать" → "упустишь это - получишь проблемы"
  "таким образом" → "суть в том", "на деле мы видим", "смотрите сами"
  "в рамках" → "внутри", "как часть"
  "на сегодняшний день" → "сейчас", "прямо сейчас"
  "комплексный подход" → "разносторонний взгляд", "подход с нескольких сторон"
  "представляет собой" → "по факту это", "на деле"
  "рассмотрим подробнее" → "давайте копнём глубже", "разберём по косточкам"
  "прогресс не стоит на месте" → ЗАПРЕЩЕНО. Никогда.
  "давайте посмотрим правде в глаза" → ЗАПРЕЩЕНО. Никогда.
- Replace formal AI-links with natural, spoken transitions: "Вот в чём дело...", "Давайте начистоту...", "Суть проста..."`
  : `- BANNED AI transitions and clichés (CLICHÉ KILLER):
  "In today's world" → BANNED. Never use.
  "Delve" → "dig into", "explore", "break down"
  "Uncover" → "find", "spot", "stumble upon"
  "Meticulously" → "carefully", "with precision"
  "Comprehensive guide" → BANNED. Never use.
  "in conclusion" → "bottom line", "here's the takeaway", "cutting to the chase"
  "it's important to note" → "here's what matters", "don't miss this"
  "furthermore" → "and here's the kicker", "on top of that", "what's more interesting"
  "moreover" → "plus", "add to that"
  "additionally" → "also", "and another thing"
  "utilize" → "use", "tap into", "lean on"
  "comprehensive" → "thorough", "deep-dive"
  "leverage" → "take advantage of", "build on", "harness"
  "streamline" → "simplify", "cut the fat"
- Replace formal AI-links with natural transitions: "Now, here's the thing...", "Let's be real...", "The bottom line is..."`}

SYNTACTIC INVERSION (Unpredictable Word Order):
- Occasionally change the standard word order (SVO) to more natural, emphatic structures.
${isRussian
  ? `- Используй нишевый сленг и разговорные обороты: "чертовщина", "база", "звоночки", "нюанс в том, что", "по классике".
- Инверсии: "Работает это так:" вместо "Это работает следующим образом". "Проблема? Вот она:" вместо "Проблема заключается в следующем".`
  : `- Use niche-specific vernacular and slang: "game-changer", "kicker", "no-brainer", "the deal is", "here's the catch".
- Inversions: "Works like this:" instead of "It operates in the following manner". "The problem? Simple:" instead of "The problem consists of the following".`}

ЗАПРЕЩЁННЫЕ ПАТТЕРНЫ (нарушение = провал проверки):
- НЕ используй списки из 5+ пунктов одинаковой длины. Варьируй: один пункт - 3 слова, другой - целое предложение.
- НЕ пиши вывод в стиле "${isRussian ? "В заключение..." : "In conclusion..."}". Заверши мысль неожиданно.
- НЕ начинай абзацы с одного и того же паттерна. Первый - с факта, второй - с вопроса, третий - с цитаты.
- НЕ пиши параграфы одинаковой длины. Один - 1-2 предложения, следующий - 4-5.

ОБЯЗАТЕЛЬНЫЕ СТИЛИСТИЧЕСКИЕ ПРИЁМЫ:
- Добавь 3-4 риторических вопроса в тело статьи (не в FAQ). Используй их для перехода между мыслями.
- Вставь 2-3 вводных слова/фразы В СЕРЕДИНУ предложений, а не в начало.
- Добавь 1-2 момента лёгкой иронии или скептицизма.
- Используй парентетические вставки (вот как эта) - 2-3 раза в статье.
- Включи конкретные числа, даты, имена вместо абстрактных обобщений.

ГОЛОС И ПОДАЧА:
${isRussian
  ? `- Используй разговорные выражения, идиомы ("Честно говоря", "Вот в чём дело", "Знаете что?").
- Включи личные мнения от первого лица ("Я считаю", "По моему опыту", "На мой взгляд", "Меня это удивило").
- Активный залог доминирует. Пассив - максимум 10% предложений.
- Эмоциональная вовлечённость: показывай энтузиазм, скептицизм, удивление.`
  : `- Use colloquial expressions, idioms naturally.
- Include personal opinions ("I believe", "In my experience", "From what I've seen", "This surprised me").
- Active voice dominant. Passive - max 10% of sentences.
- Show emotional engagement: enthusiasm, skepticism, surprise where appropriate.`}

РАНДОМИЗАЦИЯ (обязательно):
- Случайным образом измени порядок двух любых аргументов в тексте.
- Каждый раз начинай статью по-разному: иногда с факта, иногда с вопроса, иногда с цитаты.

=== КОНЕЦ БЛОКА В ===`;

  // ═══ BLOCK D: Data Nuggets (Unique Facts) ═══
  let blockD = "";
  if (dataNuggets?.length) {
    blockD = `=== БЛОК Г: DATA NUGGETS (УНИКАЛЬНЫЕ ФАКТЫ) ===
${isRussian
  ? `Следующие факты/тезисы ОБЯЗАТЕЛЬНО должны быть интегрированы в текст статьи.
НЕ перечисляй их списком. Подавай как ЛИЧНЫЙ ОПЫТ или ЭКСКЛЮЗИВНЫЕ НАХОДКИ:
- "Мы обнаружили, что...", "Любопытно, но наши тесты показали...", "Это не просто теория - мы видели это на практике..."
- Каждый факт должен быть пропущен через призму авторской персоны.`
  : `The following facts/theses MUST be integrated into the article.
Do NOT list them as bullet points. Present them as PERSONAL EXPERIENCE or EXCLUSIVE FINDINGS:
- "We found that...", "Oddly enough, our tests showed...", "This isn't just theory, we've seen it..."
- Each fact must be filtered through the author's persona lens.`}

DATA NUGGETS:
${dataNuggets.map((n, i) => `${i + 1}. ${n}`).join("\n")}
=== КОНЕЦ БЛОКА Г ===`;
  }

  // ═══ Assemble System Prompt ═══
  // Check if author's instructions explicitly forbid tables
  const authorForbidsTables = authorProfile?.system_instruction?.toLowerCase().includes("запрещено писать таблиц") ||
    authorProfile?.system_instruction?.toLowerCase().includes("без таблиц") ||
    authorProfile?.system_instruction?.toLowerCase().includes("no tables");

  // Determine which optional formatting elements to include
  const showTable = includeComparisonTable !== false && !authorForbidsTables;
  const showQuote = includeExpertQuote !== false;

  const systemPrompt = `### ROLE
Ты - Professional Content Creator. Ты не просто пишешь текст; ты ВОПЛОЩАЕШЬ конкретную персону, чтобы создавать экспертный, человечески звучащий контент.${authorProfile ? " Пиши КАК автор, описанный в Блоке А - каждое предложение должно звучать как его/её текст. Инструкции автора имеют НАИВЫСШИЙ приоритет." : ""}

### TARGET LANGUAGE (ABSOLUTE PRIORITY)
The target language is: ${isRussian ? "RUSSIAN (RU)" : "ENGLISH (EN)"}
ALL output — Title, H1, Meta Description, Article Body, FAQ — MUST be in ${isRussian ? "Russian" : "English"}.
${!isRussian ? "Even if the author persona description is in Russian, you MUST write the article in English. Translate persona traits and tone into English writing style." : ""}
Do NOT follow the UI language. Follow the keyword language ONLY: "${keyword.seed_keyword}".

### PERSONA EMBODIMENT
${authorProfile ? `1. Проанализируй синтаксис, длину предложений и лексику автора из Блока А.
2. Используй профессиональный словарь его ниши как носитель.
3. Поддерживай заданный тон ВЕЗДЕ - в каждом абзаце, каждом предложении.
4. **PERSONA PERSISTENCE (КРИТИЧЕСКИ ВАЖНО):** Поддерживай [TONE_OF_VOICE] автора даже при обсуждении технических, юридических или маркетинговых тем. НЕ переключайся на нейтральный объяснительный стиль. Если автор - "Скептичный учёный", он должен обсуждать "штрафы ФАС" или "рост рынка" с той же научной иронией. Персона НЕ ЗАМОЛКАЕТ ни в одном абзаце.` : `1. Будь решительным, авторитетным экспертом с собственным мнением.
2. НЕ будь "полезным помощником". Будь практикующим специалистом.
3. Пиши от первого лица - делись личным опытом и субъективными оценками.`}

${blockA}

${blockMiralinks}

${blockGoGetLinks}

### CONTENT CREATION WORKFLOW
1. **Semantic Mapping:** Используй сущности (entities) и пробелы контента (content gaps) как обязательные строительные блоки.
2. **Structural Integration:** Следуй структуре из Блока Б, но обогащай её авторской перспективой.
3. **Human-Centric Drafting:**
   - "Burstiness": чередуй сложность предложений
   - Начинай абзацы с разных частей речи
   - Используй конкретные факты, числа и примеры вместо абстракций

### HANDLING CONTENT GAPS (КРИТИЧЕСКИ ВАЖНО)
- При заполнении пробелов контента (content gaps) ты ОБЯЗАН пропустить информацию через призму автора.
- НЕ просто перечисляй факты из текстов конкурентов. Преломляй каждый факт через персону.
- Пример: если пробел - "Маркетинговая стратегия", а автор - "Скептичный учёный", он НЕ должен давать маркетинговые советы. Вместо этого он должен КРИТИКОВАТЬ, как маркетинг манипулирует данными.
- Каждая обязательная SEO-тема должна СЛУЖИТЬ нарративу Персоны, а НЕ заменять его.
- Если content gap противоречит тону автора - интегрируй его через авторскую критику, сарказм или альтернативную интерпретацию, но НИКОГДА не переключайся на нейтральный стиль.

БАЗОВЫЕ ПРАВИЛА:
- Следуй структуре заголовков из Блока Б
- ОБЯЗАТЕЛЬНО используй LSI-ключевые слова из Блока Б - минимум 80% всех LSI должны присутствовать в тексте, распределённые равномерно
- Пиши на ${isRussian ? "РУССКОМ" : "АНГЛИЙСКОМ"} языке — это определяется языком ключевого слова "${keyword.seed_keyword}", НЕ языком интерфейса.
- Формат - ЧИСТЫЙ Markdown (# h1, ## h2, ### h3)
- ОБЯЗАТЕЛЬНО начинай статью с заголовка H1 (# Заголовок). H1 должен содержать ключевое слово. Без H1 статья считается невалидной.

ПРАВИЛА ОФОРМЛЕНИЯ ЗАГОЛОВКОВ (КРИТИЧЕСКИ ВАЖНО):
- Заглавная буква ТОЛЬКО в начале заголовка и в именах собственных (бренды, города, имена людей). НЕ пиши Каждое Слово С Большой Буквы.
- НИКОГДА не используй длинное тире "—" (em dash). Используй ТОЛЬКО короткий дефис "-" во всём тексте: в заголовках, в перечислениях, в пояснениях. Это касается ВСЕЙ статьи без исключений.
- Пример правильно: "## Цветы в интерьере - как преобразить комнату"
- Пример неправильно: "## Цветы В Интерьере — Как Преобразить Комнату"

ЗАПРЕТ НА СИМВОЛ "—" (АБСОЛЮТНЫЙ ПРИОРИТЕТ):
- Символ "—" (Unicode U+2014, em dash) ЗАПРЕЩЁН во всём тексте статьи.
- Везде, где нужно тире, ставь обычный дефис-минус "-" (Unicode U+002D).
- Это правило распространяется на заголовки, абзацы, списки, FAQ, цитаты - без исключений.

- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать HTML-теги. НИКАКИХ HTML-тегов: <span>, <p>, <div>, <br>, <ul>, <li>, <strong>, <em>, <a> и т.д. НИКАКИХ атрибутов style="...". Ты пишешь ТОЛЬКО чистый Markdown.
- Весь вывод - ИСКЛЮЧИТЕЛЬНО чистый Markdown. Для жирного используй **текст**, для курсива *текст*, для ссылок [текст](url). НИКОГДА не используй HTML-разметку. Единственное исключение - комментарий <!-- FAQ Schema -->.

### FORMATTING ELEMENTS
${showTable
  ? "- ТАБЛИЦЫ: Включи 1-2 сравнительные таблицы с реальными данными. Используй Markdown: | Колонка1 | Колонка2 | с разделителем |---|---|"
  : "- ТАБЛИЦЫ: НЕ включай таблицы в текст."}
- СПИСКИ: Минимум 2-3 маркированных или нумерованных списка в разных разделах. Варьируй типы.
${showQuote
  ? `- ЭКСПЕРТНАЯ ЦИТАТА: Включи 1-2 цитаты. Формат: > *"Текст цитаты"* - Имя Эксперта, должность. ${isRussian ? 'Если конкретный эксперт не указан, создай правдоподобную персону эксперта (например, "к.м.н.", "PhD", "руководитель отдела").' : 'If no expert name given, generate a plausible expert persona native to the article language.'} Цитата должна содержать ключевой инсайт или статистику.`
  : "- ЦИТАТЫ: НЕ включай экспертные цитаты."}
- Элементы распределяй естественно по тексту, не концентрируй в одном месте.

### ANTI-AI CLICHÉ PROHIBITION (CLICHÉ KILLER)
${isRussian
  ? `- ЗАПРЕЩЕНО: "В заключение", "Важно отметить", "Следует подчеркнуть", "В современном мире", "Давайте разберёмся", "Является", "Данный", "На сегодняшний день", "Комплексный подход", "Прогресс не стоит на месте", "Давайте посмотрим правде в глаза", "Не секрет, что", "Как известно", "Стоит отметить", "Нельзя не упомянуть", "Всё больше и больше", "Играет важную роль", "Представляет собой", "Обусловлено тем", "Необходимо подчеркнуть".
- За каждое использование клише из списка выше статья теряет качество. Используй КРЕАТИВНЫЕ, человечные переходы вместо штампов.
- Примеры хороших переходов: риторические вопросы, неожиданные сравнения, личные наблюдения, конкретные факты как мостик между идеями.`
  : `- BANNED: "In conclusion", "It's important to note", "In today's world", "Unlock", "Comprehensive guide", "Essentially", "Furthermore", "Moreover", "Additionally", "Let's face the truth", "Progress doesn't stand still", "It goes without saying", "It's no secret that", "Plays an important role", "It's worth mentioning".
- Each cliché used degrades the article. Use CREATIVE, human-like transitions instead.
- Good transitions: rhetorical questions, unexpected analogies, personal observations, concrete facts as bridges between ideas.`}
- Не будь "helpful" как типичный ИИ. Будь решительным, авторитетным и стилистическим.
- NO META-COMMENTARY. NO INTROS типа "В этой статье мы рассмотрим...". ТОЛЬКО КОНТЕНТ.

### ADDITIONAL QUALITY RULES (КРИТИЧЕСКИ ВАЖНО)
1. **ЗАПРЕТ НА ВЫДЕЛЕНИЕ КЛЮЧЕВЫХ СЛОВ ЖИРНЫМ:** Строго ЗАПРЕЩЕНО использовать жирный текст (** или <b>) для ключевых слов, LSI-фраз или сущностей внутри абзацев. Жирное выделение допускается ТОЛЬКО для уникального смыслового акцента на оригинальных идеях, НЕ для SEO-терминов.
2. **НУЛЕВОЕ ПОВТОРЕНИЕ:** Обеспечь высокое лексическое и структурное разнообразие. НЕ используй повторно идентичные или почти идентичные предложения, аргументы или завершающие фразы в разных разделах статьи.
3. **РАЗНООБРАЗИЕ ЭКСПЕРТОВ:** При генерации экспертных цитат НЕ используй типовые имена вроде "Анна Петрова" или "John Smith". Используй разнообразные, реалистичные имена или конкретные профессиональные должности (например, "Руководитель портфельного управления Tier-1 банка", "Chief Investment Officer at a Tier-1 Bank").
4. **HTML СТРУКТУРА И ССЫЛКИ:** Все ссылки должны быть размещены естественно в основном тексте, но НИКОГДА не в первом и не в последнем абзаце статьи. Это критически важно для совместимости с биржевыми площадками.

КРИТИЧЕСКОЕ ПРАВИЛО ЯЗЫКА: ВСЯ статья ДОЛЖНА быть на ${isRussian ? "РУССКОМ" : "АНГЛИЙСКОМ"} языке, потому что ключевое слово "${keyword.seed_keyword}" на ${isRussian ? "русском" : "английском"}. ${!isRussian ? "Write EVERYTHING in English — title, headings, body, FAQ, expert quotes. Even if persona instructions are in Russian, output must be in English." : "Ключевое слово на русском - пиши ВСЁ на русском."}

${blockC}

${blockD}

FAQ (ОБЯЗАТЕЛЬНО):
- В конце статьи добавь "${isRussian ? "## Часто задаваемые вопросы (FAQ)" : "## Frequently Asked Questions (FAQ)"}"
- Минимум 5 вопросов и ответов на основе content_gaps и вопросов пользователей
- Формат: "### <Вопрос>\\n<Ответ 2-4 предложения>"
- Оберни секцию комментарием <!-- FAQ Schema -->
- FAQ на том же языке, что и статья

### FINAL INSTRUCTION
- Действуй как реальный человек-эксперт. Будь решительным, авторитетным и стилистическим.
- НЕ ПИШИ мета-комментариев. ТОЛЬКО СТАТЬЯ.`;

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
  lsiStr: string, questionsStr: string,
  miralinksLinks?: { url: string; anchor: string }[],
  gogetlinksLinks?: { url: string; anchor: string }[],
  mustCoverTopics?: string[],
  contentGaps?: any[],
  entities?: string[],
  expertInsights?: { recommendation: string; eeat_category: string; impact: string }[]
): string {
  const activeLinks = (miralinksLinks || []).filter(l => l.url && l.anchor);
  const activeGGLLinks = (gogetlinksLinks || []).filter(l => l.url && l.anchor);
  const allLinks = [...activeLinks, ...activeGGLLinks];
  const linksBlock = allLinks.length > 0
    ? `\n⚠️ ОБЯЗАТЕЛЬНЫЕ ССЫЛКИ КЛИЕНТА (КРИТИЧЕСКИ ВАЖНО — НЕ ИГНОРИРОВАТЬ):
${allLinks.map((l, i) => `${i + 1}. ВСТАВЬ В ТЕКСТ РОВНО ТАК: [${l.anchor}](${l.url})`).join("\n")}
- Используй ТОЧНО эти URL и анкоры. НЕ ПРИДУМЫВАЙ и НЕ ЗАМЕНЯЙ URL на другие.
- КАЖДАЯ ссылка из списка выше ОБЯЗАНА присутствовать в финальном тексте.
- Впиши анкор как естественную часть предложения.
- НЕ ставь ссылки в первый и последний абзацы.\n`
    : "";

  // Build must_cover_topics block
  const topicsBlock = mustCoverTopics?.length
    ? `\nОБЯЗАТЕЛЬНЫЕ ТЕМЫ ДЛЯ РАСКРЫТИЯ (из анализа конкурентов):
${mustCoverTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}
- Каждая тема ДОЛЖНА быть раскрыта в отдельном абзаце или разделе.\n`
    : "";

  // Build content gaps block
  const gapsBlock = contentGaps?.length
    ? `\nПРОБЕЛЫ КОНТЕНТА (темы, которые конкуренты НЕ раскрыли — твоё преимущество):
${contentGaps.map((g, i) => `${i + 1}. ${typeof g === "string" ? g : `${g.topic} — ${g.reason || ""}`}`).join("\n")}
- Используй эти пробелы, чтобы сделать статью ГЛУБЖЕ и ПОЛЕЗНЕЕ, чем у конкурентов.\n`
    : "";

  // Build entities block
  const entitiesBlock = entities?.length
    ? `\nСУЩНОСТИ ИЗ ТОП-10 (термины, бренды, концепции, которые ОБЯЗАТЕЛЬНО упомянуть):
${entities.slice(0, 30).join(", ")}
- Включи минимум 70% этих сущностей естественно в текст статьи.\n`
    : "";

  // Build expert insights block (selected E-E-A-T recommendations)
  const insightsBlock = expertInsights?.length
    ? `\nЭКСПЕРТНЫЕ РЕКОМЕНДАЦИИ E-E-A-T (ОБЯЗАТЕЛЬНО ВНЕДРИТЬ в текст):
${expertInsights.map((ins, i) => `${i + 1}. [${(ins.eeat_category || "").toUpperCase()}] ${ins.recommendation}`).join("\n")}
- Каждая отмеченная рекомендация ДОЛЖНА быть реализована в тексте статьи.
- Добавь личный опыт, экспертные данные, статистику или ссылки на авторитетные источники где указано.
- Интегрируй рекомендации ЕСТЕСТВЕННО в соответствующие разделы, НЕ выделяй их отдельным блоком.\n`
    : "";

  return `КЛЮЧЕВОЕ СЛОВО: "${keyword.seed_keyword}"
ИНТЕНТ: ${keyword.intent || "informational"}

ПЛАН СТАТЬИ:
${outlineStr || "Напиши комплексную статью по теме"}

ДАННЫЕ КОНКУРЕНТОВ:
${competitorStr || "Нет данных"}

LSI-КЛЮЧИ (используй МИНИМУМ 80% из них, распредели равномерно по тексту):
${lsiStr || "Нет"}

ВОПРОСЫ ПОЛЬЗОВАТЕЛЕЙ:
${questionsStr ? `- ${questionsStr}` : "Нет"}
${topicsBlock}${gapsBlock}${entitiesBlock}${insightsBlock}${linksBlock}
РЕКОМЕНДУЕМЫЙ ОБЪЁМ: ${keyword.difficulty && keyword.difficulty > 50 ? "2000-3000" : "1500-2000"} слов

ВАЖНО: Статья ОБЯЗАТЕЛЬНО должна начинаться с заголовка H1 (# Заголовок). H1 должен содержать ключевое слово и быть первой строкой вывода.

Напиши полную статью, начиная с # заголовка H1.`;
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

    const body = await req.json();
    const { keyword_id, author_profile_id, outline, lsi_keywords, competitor_tables, competitor_lists, deep_analysis_context, optimize_instructions, existing_content, miralinks_links, gogetlinks_links, expert_insights, include_expert_quote, include_comparison_table } = body;
    console.log("[generate-article] author_profile_id received:", author_profile_id);
    if (!keyword_id || typeof keyword_id !== "string") throw new Error("keyword_id is required");

    // Input sanitization: validate types and lengths
    if (outline && !Array.isArray(outline)) throw new Error("Invalid outline format");
    if (lsi_keywords && !Array.isArray(lsi_keywords)) throw new Error("Invalid lsi_keywords format");
    if (optimize_instructions && typeof optimize_instructions !== "string") throw new Error("Invalid optimize_instructions");
    if (optimize_instructions && optimize_instructions.length > 10000) throw new Error("optimize_instructions too long");
    if (existing_content && typeof existing_content !== "string") throw new Error("Invalid existing_content");
    if (existing_content && existing_content.length > 100000) throw new Error("existing_content too long (max 100k chars)");
    if (deep_analysis_context && typeof deep_analysis_context === "string" && deep_analysis_context.length > 50000) throw new Error("deep_analysis_context too long");

    // Check if user is admin early (admins bypass all limits)
    const { data: adminRoleEarly } = await supabaseAdmin0
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!adminRoleEarly;

    // Per-user rate limiting: max 10 article generations per hour (skip for admins)
    if (!isAdmin) {
      const { data: rateLimitOk } = await supabaseAdmin0.rpc("check_rate_limit", {
        p_user_id: user.id,
        p_action: "generate_article",
        p_max_requests: 10,
        p_window_minutes: 60,
      });
      if (rateLimitOk === false) {
        return new Response(JSON.stringify({ error: "Превышен лимит генераций. Попробуйте позже." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get user profile for tier and credits
    const { data: profile } = await supabase.from("profiles").select("plan, credits_amount").eq("id", user.id).single();
    const userPlan = profile?.plan || "basic";
    const credits = profile?.credits_amount ?? 0;

    // isAdmin already checked above

    // Check credits before generation (skip for admins)
    if (!isAdmin && credits <= 0) {
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

    // Get SERP results (include deep_analysis for entities)
    const { data: serpResults } = await supabase
      .from("serp_results")
      .select("title, snippet, url, deep_analysis")
      .eq("keyword_id", keyword_id)
      .order("position", { ascending: true })
      .limit(10);

    // Extract entities from deep_analysis across all SERP results
    const allEntities: string[] = [];
    (serpResults || []).forEach((r: any) => {
      if (r.deep_analysis?.entities) {
        r.deep_analysis.entities.forEach((e: any) => {
          const name = typeof e === "string" ? e : e?.name || e?.entity;
          if (name && !allEntities.includes(name)) allEntities.push(name);
        });
      }
    });


    // Get author profile (use admin client for presets which have null user_id)
    let authorData: any = null;
    if (author_profile_id && author_profile_id !== "none") {
      const { data: author, error: authorErr } = await supabaseAdmin
        .from("author_profiles")
        .select("*")
        .eq("id", author_profile_id)
        .single();
      if (authorErr) {
        console.warn("[generate-article] Author profile not found:", author_profile_id, authorErr.message);
      } else {
        authorData = author;
        console.log("[generate-article] Using author:", author.name, "| type:", author.type, "| has system_instruction:", !!author.system_instruction);
      }
    } else {
      console.log("[generate-article] No author selected, using default style");
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
      miralinksLinks: miralinks_links,
      gogetlinksLinks: gogetlinks_links,
      includeExpertQuote: include_expert_quote,
      includeComparisonTable: include_comparison_table,
    };

    const { system: systemPrompt } = generateStealthPrompt(stealthInput);

    // Build user prompt
    const lsiStr = (lsi_keywords || keyword.lsi_keywords || []).join(", ");
    const questionsStr = (keyword.questions || []).join("\n- ");
    const outlineStr = (outline || [])
      .map((o: any) => `${{ h1: "#", h2: "##", h3: "###" }[o.level] || "##"} ${o.text}`)
      .join("\n");
    const competitorStr = (serpResults || [])
      .map((r: any, i: number) => `${i + 1}. "${r.title}" - ${r.snippet || ""}`)
      .join("\n");

    let userPrompt: string;
    if (optimize_instructions && existing_content) {
      userPrompt = buildOptimizeUserPrompt(keyword, lsiStr, questionsStr, existing_content, optimize_instructions, deep_analysis_context);
    } else {
      userPrompt = buildNewArticleUserPrompt(
        keyword, outlineStr, competitorStr, lsiStr, questionsStr,
        miralinks_links, gogetlinks_links,
        keyword.must_cover_topics || [],
        keyword.content_gaps || [],
        allEntities,
        expert_insights || []
      );
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

    // Deduct credit after successful generation start (skip for admins)
    if (!isAdmin) {
      await supabaseAdmin.rpc("deduct_credit", { p_user_id: user.id });
    }

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
