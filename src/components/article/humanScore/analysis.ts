import { ALL_AI_STOP_WORDS } from "./constants";

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
export function computeSymmetry(text: string): { isRobotic: boolean; message: string } {
  // Find list items (lines starting with - or * or numbered)
  const listItems = text
    .split("\n")
    .filter(l => /^\s*[-*•]\s|^\s*\d+[.)]\s/.test(l))
    .map(l => l.trim());

  if (listItems.length < 3) return { isRobotic: false, message: "Естественная" };

  const charLens = listItems.map(l => l.length);
  const mean = charLens.reduce((a, b) => a + b, 0) / charLens.length;
  if (mean === 0) return { isRobotic: false, message: "Естественная" };

  const maxDiff = Math.max(...charLens.map(l => Math.abs(l - mean) / mean));
  if (maxDiff < 0.1) {
    return { isRobotic: true, message: "Роботизированная" };
  }
  return { isRobotic: false, message: "Естественная" };
}

// ─── AI Probability ─────────────────────────────────────────────────────
export function computeAiProbability(text: string): { score: number; flags: { label: string; passed: boolean }[] } {
  const flags: { label: string; passed: boolean }[] = [];
  let penalty = 0;
  const lower = text.toLowerCase();

  // 1) Check for AI stop-words / clichés
  const foundStopWords = ALL_AI_STOP_WORDS.filter(p => lower.includes(p));
  const noCliches = foundStopWords.length === 0;
  flags.push({ label: `Отсутствие ИИ-клише${!noCliches ? ` (${foundStopWords.length})` : ""}`, passed: noCliches });
  if (!noCliches) penalty += foundStopWords.length * 8;

  // 2) Check for author's first-person voice ("Я" / "Мы")
  const firstPerson = /\b(я считаю|по моему|на мой взгляд|я уверен|мы видим|мы считаем|i believe|in my experience|from what i've seen|we think|we found)\b/i;
  const hasFirstPerson = firstPerson.test(text);
  flags.push({ label: "Авторское «Я» / «Мы»", passed: hasFirstPerson });
  if (!hasFirstPerson) penalty += 10;

  // 3) Paragraph uniformity
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 3) {
    const pLens = paragraphs.map(p => p.split(/\s+/).length);
    const pMean = pLens.reduce((a, b) => a + b, 0) / pLens.length;
    const pVariance = pLens.reduce((s, l) => s + Math.pow(l - pMean, 2), 0) / pLens.length;
    const pCv = pMean > 0 ? Math.sqrt(pVariance) / pMean : 0;
    const isUniform = pCv < 0.25;
    flags.push({ label: "Вариативность абзацев", passed: !isUniform });
    if (isUniform) penalty += 15;
  }

  // 4) Same-start paragraphs
  if (paragraphs.length >= 4) {
    const starts = paragraphs.map(p => p.trim().split(/\s+/)[0]?.toLowerCase());
    const startCounts: Record<string, number> = {};
    starts.forEach(s => { if (s) startCounts[s] = (startCounts[s] || 0) + 1; });
    const maxRepeat = Math.max(...Object.values(startCounts));
    const varied = maxRepeat < 3;
    flags.push({ label: "Разнообразие начал абзацев", passed: varied });
    if (!varied) penalty += 12;
  }

  // 5) Burstiness check
  const { score: burstScore } = computeBurstiness(text);
  const burstOk = burstScore >= 50;
  flags.push({ label: "Burstiness", passed: burstOk });
  if (burstScore < 30) penalty += 20;
  else if (burstScore < 50) penalty += 10;

  // 6) Rhetorical questions
  const questions = (text.match(/[а-яёa-z][^.!]*\?/gi) || []).length;
  const hasQuestions = questions >= 2;
  flags.push({ label: "Риторические вопросы", passed: hasQuestions });
  if (!hasQuestions) penalty += 8;

  const safety = Math.max(0, Math.min(100, 100 - penalty));
  return { score: safety, flags };
}

// ─── Perplexity Score: lexical richness ─────────────────────────────────
export function computePerplexity(text: string): { score: number; label: string } {
  const words = text
    .toLowerCase()
    .replace(/[^a-zа-яёА-ЯЁ\s-]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (words.length < 30) return { score: 0, label: "Недостаточно текста" };

  const uniqueWords = new Set(words);
  // Type-Token Ratio
  const ttr = uniqueWords.size / words.length;

  // Hapax legomena ratio (words appearing only once)
  const freq: Record<string, number> = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const hapax = Object.values(freq).filter(c => c === 1).length;
  const hapaxRatio = hapax / uniqueWords.size;

  // Average word length (longer words = richer vocabulary)
  const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  const lenBonus = Math.min(1, (avgLen - 3) / 5); // normalize 3-8 chars → 0-1

  // Combined score
  const raw = (ttr * 40) + (hapaxRatio * 35) + (lenBonus * 25);
  const score = Math.min(100, Math.round(raw));

  let label: string;
  if (score >= 70) label = "Экспертный";
  else if (score >= 45) label = "Богатый";
  else label = "Простой";

  return { score, label };
}

// ─── AI Stop-Words finder ───────────────────────────────────────────────
export function findAiStopWords(text: string): { word: string; count: number }[] {
  const lower = text.toLowerCase();
  const found: { word: string; count: number }[] = [];

  for (const word of ALL_AI_STOP_WORDS) {
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
