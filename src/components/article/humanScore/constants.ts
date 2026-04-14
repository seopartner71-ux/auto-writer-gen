// AI Stop-Words / Clichés list
export const AI_STOP_WORDS_RU = [
  "является", "данный", "стоит отметить", "в заключение", "ключевой фактор",
  "инновационный", "в современном мире", "важно понимать", "кроме того",
  "важно отметить", "следует подчеркнуть", "необходимо учитывать",
  "на сегодняшний день", "комплексный подход", "таким образом",
  "в рамках", "обеспечивает", "позволяет", "представляет собой",
  "играет важную роль", "оказывает влияние", "в целом",
  "рассмотрим подробнее", "прогресс не стоит на месте",
  "давайте посмотрим правде в глаза", "не секрет, что", "как известно",
  "нельзя не упомянуть", "всё больше и больше", "обусловлено тем",
  "необходимо подчеркнуть",
];

export const AI_STOP_WORDS_EN = [
  "it's important to note", "in conclusion", "it should be emphasized",
  "furthermore", "moreover", "additionally", "it's worth mentioning",
  "comprehensive", "leverage", "streamline", "utilize",
  "in today's world", "it is essential", "plays a crucial role",
  "in order to", "a wide range of", "at the end of the day",
  "delve", "uncover", "meticulously", "comprehensive guide",
  "it goes without saying", "it's no secret that",
  "plays an important role",
  "it is worth noting that", "this is because", "in summary",
  "it should be noted", "one of the key", "it is important to",
  "essentially", "indeed", "notably", "significantly",
  "consequently", "subsequently", "nevertheless",
  "it is crucial", "it is vital", "paramount",
  "a plethora of", "myriad", "multifaceted",
];

export const ALL_AI_STOP_WORDS = [...AI_STOP_WORDS_RU, ...AI_STOP_WORDS_EN];

/**
 * Detect whether text is primarily Russian or English
 */
export function detectContentLanguage(text: string): "ru" | "en" {
  const sample = text.slice(0, 500);
  const cyrillicCount = (sample.match(/[а-яёА-ЯЁ]/g) || []).length;
  const latinCount = (sample.match(/[a-zA-Z]/g) || []).length;
  return cyrillicCount > latinCount ? "ru" : "en";
}

/**
 * Get stop-words list matching content language
 */
export function getStopWordsForLanguage(lang: "ru" | "en"): string[] {
  return lang === "ru" ? AI_STOP_WORDS_RU : AI_STOP_WORDS_EN;
}
