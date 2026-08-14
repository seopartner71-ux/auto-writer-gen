// Измеримый Style Fingerprint по образцам текста.
// Используется как дополнительный сигнал для Evaluation, не как единственный источник истины.

import type { StyleFingerprint } from "../types";

const FIRST_PERSON = /\b(я|меня|мне|мной|мы|нас|нам|нами|мой|моя|мои|наш|наша|наши)\b/gi;
const SUBJECTIVE = /\b(считаю|думаю|на мой взгляд|по-моему|уверен|кажется|лучше|хуже|стоит|не стоит|важно|глупо|разумно)\b/gi;
const EMOTIONAL = /\b(отлично|ужасно|прекрасно|кошмар|восторг|разочаров\w+|обидно|радует|бесит|круто|провал)\b|!/gi;
const DIRECT = /\b(сделайте|проверьте|используйте|не делайте|начните|возьмите|выберите|запомните|нужно|надо)\b/gi;

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function buildStyleFingerprint(samples: string[]): StyleFingerprint | null {
  const texts = samples.map(s => (s || "").trim()).filter(s => s.length > 100);
  if (!texts.length) return null;

  const joined = texts.join("\n\n");
  // Убираем таблицы и списки перед синтаксическим анализом.
  const prose = joined
    .split("\n")
    .filter(line => !/^\s*([-*+•]|\d+[.)]|\|)/.test(line))
    .join("\n");

  const sentences = prose
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 1);
  const sentenceLengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length);

  const paragraphs = joined.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const paragraphLengths = paragraphs.map(p => p.split(/\s+/).filter(Boolean).length);

  const words = joined.split(/\s+/).filter(Boolean);
  const wordCount = Math.max(words.length, 1);
  const per1000 = (n: number) => round((n / wordCount) * 1000);

  const lines = joined.split("\n");
  const listLines = lines.filter(l => /^\s*([-*+•]|\d+[.)])\s+/.test(l)).length;
  const headingLines = lines.filter(l => /^\s*#{1,6}\s+/.test(l)).length;

  // Плотность профессиональной лексики: длинные слова и латиница/аббревиатуры.
  const technical = words.filter(w => /^[A-Za-z]{3,}$/.test(w) || /^[А-ЯЁ]{2,}$/.test(w) || w.length >= 13).length;

  const avgSent = sentenceLengths.length
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;
  const avgPara = paragraphLengths.length
    ? paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length
    : 0;

  return {
    avg_sentence_length: round(avgSent, 1),
    sentence_length_variance: round(variance(sentenceLengths), 1),
    avg_paragraph_length: round(avgPara, 1),
    paragraph_length_variance: round(variance(paragraphLengths), 1),
    question_frequency: per1000(countMatches(joined, /\?/g)),
    first_person_frequency: per1000(countMatches(joined, FIRST_PERSON)),
    list_frequency: per1000(listLines),
    heading_frequency: per1000(headingLines),
    technical_term_density: per1000(technical),
    subjectivity_score: per1000(countMatches(joined, SUBJECTIVE)),
    emotionality_score: per1000(countMatches(joined, EMOTIONAL)),
    directness_score: per1000(countMatches(joined, DIRECT)),
    samples_count: texts.length,
  };
}