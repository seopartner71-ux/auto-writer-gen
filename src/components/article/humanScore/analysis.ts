import { ALL_AI_STOP_WORDS, AI_STOP_WORDS_RU, AI_STOP_WORDS_EN, detectContentLanguage } from "./constants";

// ─── Burstiness: sentence length variation ──────────────────────────────
export function computeBurstiness(text: string): { score: number; lengths: number[] } {
  const sentences = text
    .replace(/([.!?])\s+/g, "$1\n")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 2);

  if (sentences.length < 5) return { score: 0, lengths: [] };

  const lengths = sentences.map(s => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;
  const score = Math.min(100, Math.round(cv * 1.5));
  return { score, lengths };
}

// ─── Structural symmetry: detect uniform list items ─────────────────────
export function computeSymmetry(text: string): { isRobotic: boolean; message: string; lang: "ru" | "en" } {
  const lang = detectContentLanguage(text);
  const listItems = text
    .split("\n")
    .filter(l => /^\s*[-*•]\s|^\s*\d+[.)]\s/.test(l))
    .map(l => l.trim());

  if (listItems.length < 3) return { isRobotic: false, message: lang === "ru" ? "Естественная" : "Natural", lang };

  const charLens = listItems.map(l => l.length);
  const mean = charLens.reduce((a, b) => a + b, 0) / charLens.length;
  if (mean === 0) return { isRobotic: false, message: lang === "ru" ? "Естественная" : "Natural", lang };

  const maxDiff = Math.max(...charLens.map(l => Math.abs(l - mean) / mean));
  if (maxDiff < 0.1) {
    return { isRobotic: true, message: lang === "ru" ? "Роботизированная" : "Robotic", lang };
  }
  return { isRobotic: false, message: lang === "ru" ? "Естественная" : "Natural", lang };
}

// ─── Localized labels helper ────────────────────────────────────────────
export function getLocalizedLabels(lang: "ru" | "en") {
  return lang === "ru" ? {
    noCliches: "Отсутствие ИИ-клише",
    authorVoice: "Авторское «Я» / «Мы»",
    paragraphVariety: "Вариативность абзацев",
    paragraphStarts: "Разнообразие начал абзацев",
    burstiness: "Burstiness",
    rhetoricalQuestions: "Риторические вопросы",
    safe: "Безопасно",
    mediumRisk: "Средний риск",
    highRisk: "Высокий риск",
    excellent: "Отлично",
    medium: "Средне",
    low: "Низкая",
    expert: "Экспертный",
    rich: "Богатый",
    simple: "Простой",
    notEnoughText: "Недостаточно текста",
    detectorSafety: "Безопасность от детекторов",
    lexicalComplexity: "Сложность лексики",
    vocabularyDesc: "Ваш текст использует",
    vocabularySuffix: "словарный запас",
    clean: "Чисто ✓",
    found: "найдено",
    noClichesFound: "ИИ-клише не обнаружены",
    hideHighlight: "Скрыть подсветку",
    highlightInText: "Подсветить в тексте",
    fix: "Исправить",
    fixAllProblems: "Исправить все проблемы",
    replaceTip: "Замените эти слова на более живые синонимы, чтобы снизить риск детекции",
    sentenceVariety: "Разнообразие длины предложений",
    higherIsBetter: "Чем выше — тем больше вариация (как у человека)",
    structure: "Структура:",
    roboticWarning: "Слишком симметричный список — это признак ИИ. Измените длину пунктов.",
    words: "слов",
    customKeysPlaceholder: "Свои ключи через запятую...",
    selectKeyword: "Выберите ключевое слово для LSI",
    spam: "спам",
    generateText: "Сгенерируйте или вставьте текст для анализа на человечность",
  } : {
    noCliches: "No AI clichés",
    authorVoice: "Author's \"I\" / \"We\"",
    paragraphVariety: "Paragraph variety",
    paragraphStarts: "Paragraph start diversity",
    burstiness: "Burstiness",
    rhetoricalQuestions: "Rhetorical questions",
    safe: "Safe",
    mediumRisk: "Medium risk",
    highRisk: "High risk",
    excellent: "Excellent",
    medium: "Medium",
    low: "Low",
    expert: "Expert",
    rich: "Rich",
    simple: "Simple",
    notEnoughText: "Not enough text",
    detectorSafety: "AI detector safety",
    lexicalComplexity: "Lexical complexity",
    vocabularyDesc: "Your text uses",
    vocabularySuffix: "vocabulary",
    clean: "Clean ✓",
    found: "found",
    noClichesFound: "No AI clichés found",
    hideHighlight: "Hide highlight",
    highlightInText: "Highlight in text",
    fix: "Fix",
    fixAllProblems: "Fix all issues",
    replaceTip: "Replace these words with more natural synonyms to reduce detection risk",
    sentenceVariety: "Sentence length variety",
    higherIsBetter: "Higher = more variation (human-like)",
    structure: "Structure:",
    roboticWarning: "Too symmetrical list — this is an AI pattern. Vary item lengths.",
    words: "words",
    customKeysPlaceholder: "Custom keywords, comma-separated...",
    selectKeyword: "Select a keyword for LSI",
    spam: "spam",
    generateText: "Generate or paste text to analyze for human-likeness",
  };
}

// ─── AI Probability ─────────────────────────────────────────────────────
export function computeAiProbability(text: string): { score: number; flags: { label: string; passed: boolean }[]; lang: "ru" | "en" } {
  const lang = detectContentLanguage(text);
  const labels = getLocalizedLabels(lang);
  const flags: { label: string; passed: boolean }[] = [];
  let penalty = 0;
  const lower = text.toLowerCase();

  // Use language-specific stop words
  const stopWords = lang === "ru" ? AI_STOP_WORDS_RU : AI_STOP_WORDS_EN;
  const foundStopWords = stopWords.filter(p => lower.includes(p));
  const noCliches = foundStopWords.length === 0;
  flags.push({ label: `${labels.noCliches}${!noCliches ? ` (${foundStopWords.length})` : ""}`, passed: noCliches });
  if (!noCliches) penalty += foundStopWords.length * 8;

  // 2) Check for author's first-person voice
  const firstPerson = lang === "ru"
    ? /\b(я считаю|по моему|на мой взгляд|я уверен|мы видим|мы считаем)\b/i
    : /\b(i believe|in my experience|from what i've seen|we think|we found)\b/i;
  const hasFirstPerson = firstPerson.test(text);
  flags.push({ label: labels.authorVoice, passed: hasFirstPerson });
  if (!hasFirstPerson) penalty += 10;

  // 3) Paragraph uniformity
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 3) {
    const pLens = paragraphs.map(p => p.split(/\s+/).length);
    const pMean = pLens.reduce((a, b) => a + b, 0) / pLens.length;
    const pVariance = pLens.reduce((s, l) => s + Math.pow(l - pMean, 2), 0) / pLens.length;
    const pCv = pMean > 0 ? Math.sqrt(pVariance) / pMean : 0;
    const isUniform = pCv < 0.25;
    flags.push({ label: labels.paragraphVariety, passed: !isUniform });
    if (isUniform) penalty += 15;
  }

  // 4) Same-start paragraphs
  if (paragraphs.length >= 4) {
    const starts = paragraphs.map(p => p.trim().split(/\s+/)[0]?.toLowerCase());
    const startCounts: Record<string, number> = {};
    starts.forEach(s => { if (s) startCounts[s] = (startCounts[s] || 0) + 1; });
    const maxRepeat = Math.max(...Object.values(startCounts));
    const varied = maxRepeat < 3;
    flags.push({ label: labels.paragraphStarts, passed: varied });
    if (!varied) penalty += 12;
  }

  // 5) Burstiness check
  const { score: burstScore } = computeBurstiness(text);
  const burstOk = burstScore >= 50;
  flags.push({ label: labels.burstiness, passed: burstOk });
  if (burstScore < 30) penalty += 20;
  else if (burstScore < 50) penalty += 10;

  // 6) Rhetorical questions
  const questions = (text.match(/[а-яёa-z][^.!]*\?/gi) || []).length;
  const hasQuestions = questions >= 2;
  flags.push({ label: labels.rhetoricalQuestions, passed: hasQuestions });
  if (!hasQuestions) penalty += 8;

  const safety = Math.max(0, Math.min(100, 100 - penalty));
  return { score: safety, flags, lang };
}

// ─── Perplexity Score: lexical richness ─────────────────────────────────
export function computePerplexity(text: string): { score: number; label: string; lang: "ru" | "en" } {
  const lang = detectContentLanguage(text);
  const labels = getLocalizedLabels(lang);
  const words = text
    .toLowerCase()
    .replace(/[^a-zа-яёА-ЯЁ\s-]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (words.length < 30) return { score: 0, label: labels.notEnoughText, lang };

  const uniqueWords = new Set(words);
  const ttr = uniqueWords.size / words.length;

  const freq: Record<string, number> = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const hapax = Object.values(freq).filter(c => c === 1).length;
  const hapaxRatio = hapax / uniqueWords.size;

  const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  const lenBonus = Math.min(1, (avgLen - 3) / 5);

  const raw = (ttr * 40) + (hapaxRatio * 35) + (lenBonus * 25);
  const score = Math.min(100, Math.round(raw));

  let label: string;
  if (score >= 70) label = labels.expert;
  else if (score >= 45) label = labels.rich;
  else label = labels.simple;

  return { score, label, lang };
}

// ─── AI Stop-Words finder (language-aware) ──────────────────────────────
export function findAiStopWords(text: string): { word: string; count: number }[] {
  const lang = detectContentLanguage(text);
  const stopWordsList = lang === "ru" ? AI_STOP_WORDS_RU : AI_STOP_WORDS_EN;
  const lower = text.toLowerCase();
  const found: { word: string; count: number }[] = [];

  for (const word of stopWordsList) {
    const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = lower.match(regex);
    if (matches && matches.length > 0) {
      found.push({ word, count: matches.length });
    }
  }

  return found.sort((a, b) => b.count - a.count);
}

// ─── LSI keyword density check ──────────────────────────────────────────
export function getKeywordDensity(text: string, keyword: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const kwLower = keyword.toLowerCase();
  const count = words.filter(w => w.includes(kwLower)).length;
  return (count / words.length) * 100;
}
