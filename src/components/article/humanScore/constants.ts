// AI Stop-Words / Clichés list
export const AI_STOP_WORDS_RU = [
  "является", "данный", "стоит отметить", "в заключение", "ключевой фактор",
  "инновационный", "в современном мире", "важно понимать", "кроме того",
  "важно отметить", "следует подчеркнуть", "необходимо учитывать",
  "на сегодняшний день", "комплексный подход", "таким образом",
  "в рамках", "обеспечивает", "позволяет", "представляет собой",
  "играет важную роль", "оказывает влияние", "в целом",
];

export const AI_STOP_WORDS_EN = [
  "it's important to note", "in conclusion", "it should be emphasized",
  "furthermore", "moreover", "additionally", "it's worth mentioning",
  "comprehensive", "leverage", "streamline", "utilize",
  "in today's world", "it is essential", "plays a crucial role",
  "in order to", "a wide range of", "at the end of the day",
];

export const ALL_AI_STOP_WORDS = [...AI_STOP_WORDS_RU, ...AI_STOP_WORDS_EN];
