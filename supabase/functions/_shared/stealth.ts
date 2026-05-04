// Shared Stealth/Cliché Killer addon. Used by bulk-generate, rewrite-fragment,
// inline-edit and any other writer pipeline so anti-AI-detection rules never
// drift between functions. The full Stealth Protocol lives inside
// generate-article/index.ts (generateStealthPrompt). This module exposes a
// compact, prompt-safe version that can be appended to ANY system prompt.

export type StealthLang = "ru" | "en" | string;

export function buildStealthSystemAddon(language: StealthLang = "ru"): string {
  const isRu = language === "ru" || language?.startsWith("ru");
  if (isRu) {
    return `
=== STEALTH PROTOCOL (обязательно, наивысший приоритет) ===
ЯЗЫК: пиши строго на русском. НИКОГДА не используй букву "ё" - всегда "е".
ФОРМАТ: без жирного (никаких **), тире заменяй на дефис (-).

RHYTHM (Burstiness):
- Чередуй длину предложений: короткое (3-6 слов) -> среднее -> длинное со вставками -> короткое.
- >=30% предложений короче 8 слов, >=20% длиннее 25 слов.
- Никогда 3+ предложения подряд одинаковой длины.

CLICHÉ KILLER (запрещено, zero tolerance):
- "является" -> "это"; "данный" -> "этот"; "стоит отметить" -> "вот что цепляет".
- "в заключение" -> "если коротко"; "важно отметить" -> "ключевой момент".
- "необходимо учитывать", "следует подчеркнуть", "таким образом", "на сегодняшний день",
  "комплексный подход", "представляет собой", "рассмотрим подробнее" - все ЗАПРЕЩЕНЫ.
- "прогресс не стоит на месте", "давайте посмотрим правде в глаза" - ЗАПРЕЩЕНО навсегда.

PERPLEXITY:
- Конкретные цифры и наблюдения вместо общих формулировок ("в 7 случаях из 10", а не "часто").
- Личные интонации: "по моему опыту", "практика показывает", "тут есть нюанс".
- Вариативные начала абзацев: вопрос, факт, наблюдение, короткая реплика.
- Запрещено выдумывать имена экспертов, компаний, исследований - используй обезличенное "практика показывает".
=== КОНЕЦ STEALTH PROTOCOL ===`.trim();
  }
  return `
=== STEALTH PROTOCOL (mandatory, highest priority) ===
LANGUAGE: write strictly in English. No bold (**), replace em-dashes with hyphens (-).

RHYTHM (Burstiness):
- Alternate sentence length: short (3-6 words) -> medium -> long with sub-clauses -> short.
- >=30% of sentences under 8 words, >=20% over 25 words.
- Never 3+ consecutive sentences of similar length.

CLICHÉ KILLER (zero tolerance, banned):
- "in conclusion", "it is important to note", "in today's world", "navigating the landscape",
  "delve into", "in the realm of", "it's worth noting", "moreover", "furthermore",
  "leverage", "robust", "seamless", "cutting-edge", "game-changer".
- Replace with rhetorical questions, concrete facts, casual connectors ("Here's the thing",
  "Plot twist though", "And here's the kicker").

PERPLEXITY:
- Use concrete numbers and observations instead of generic claims ("in 7 of 10 tested cases").
- Personal voice: "in my experience", "from what I've seen", "practice shows".
- Vary paragraph openings: question, fact, observation, short remark.
- Never fabricate expert names, companies or studies - use neutral "practice shows".
=== END STEALTH PROTOCOL ===`.trim();
}