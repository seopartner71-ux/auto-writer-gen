// Prompt Compiler: Persona DNA -> Master Prompt / Article Prompt.
// Master Prompt всегда производный объект. Пользователь правит DNA, не промпт.

import type { PersonaDna, StyleDna, SiteDnaData, PlatformDna, StyleFingerprint } from "../types";

function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/—/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е").trim();
}

function list(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map(clean).filter(Boolean);
}

/** Дедупликация правил: одинаковые по смыслу строки объединяются. */
function dedupe(rules: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of rules) {
    const rule = clean(raw);
    if (!rule) continue;
    const key = rule.toLowerCase().replace(/[^a-zа-я0-9 ]/gi, "").replace(/\s+/g, " ").slice(0, 80);
    if (!seen.has(key)) seen.set(key, rule);
  }
  return [...seen.values()];
}

function scaleWord(v: number | undefined, low: string, mid: string, high: string): string | null {
  if (typeof v !== "number") return null;
  if (v <= 33) return low;
  if (v <= 66) return mid;
  return high;
}

/** Абстрактные формулировки переводим в наблюдаемое поведение. */
function voiceBlock(dna: PersonaDna): string[] {
  const v = dna.voice || {};
  const out: string[] = [];
  const push = (s: string | null) => { if (s) out.push(s); };
  push(scaleWord(v.formality, "Тон неформальный: обращайся к читателю просто, без канцелярита.", "Тон нейтрально-деловой: без канцелярита и без панибратства.", "Тон строгий и официальный: полные конструкции, без разговорных оборотов."));
  push(scaleWord(v.warmth, "Держи дистанцию, без сочувственных оборотов.", "Пиши доброжелательно, но сдержанно.", "Пиши тепло: признавай трудности читателя перед тем, как давать решение."));
  push(scaleWord(v.energy, "Ритм спокойный, длинные пояснения допустимы.", "Ритм умеренный: чередуй пояснение и вывод.", "Ритм быстрый: короткие абзацы, минимум разгона перед мыслью."));
  push(scaleWord(v.authority, "Формулируй осторожно, показывай альтернативы.", "Давай рекомендации с обоснованием.", "Давай прямые рекомендации и называй критерий выбора."));
  push(scaleWord(v.emotionality, "Без эмоциональных оценок, только факты и логика.", "Эмоции допустимы точечно, в оценке решений.", "Допустима выраженная авторская оценка, но без восклицательных серий."));
  push(scaleWord(v.directness, "Подводи к мысли постепенно.", "Сначала ответ, затем пояснение.", "Ответ в первом предложении блока, дальше обоснование."));
  push(scaleWord(v.subjectivity, "Личных оценок избегай, опирайся на данные.", "Личная оценка допустима, если помечена как оценка.", "Авторская позиция обязательна, но всегда с обоснованием."));
  push(scaleWord(v.conversationality, "Обращения к читателю не используй.", "Изредка обращайся к читателю напрямую.", "Обращайся к читателю напрямую, задавай уточняющие вопросы по ходу."));
  if (v.preferred_person) out.push(`Лицо повествования: ${clean(v.preferred_person)}.`);
  if (v.preferred_tense) out.push(`Время: ${clean(v.preferred_tense)}.`);
  if (v.preferred_sentence_complexity) out.push(`Сложность предложений: ${clean(v.preferred_sentence_complexity)}.`);
  if (v.preferred_paragraph_density) out.push(`Плотность абзацев: ${clean(v.preferred_paragraph_density)}.`);
  return out;
}

function styleBlock(style: StyleDna, fp?: StyleFingerprint | null): string[] {
  const out: string[] = [];
  const voc = style.vocabulary || {};
  const sent = style.sentence_style || {};
  const par = style.paragraph_style || {};
  const rhy = style.rhythm || {};
  if (voc.complexity) out.push(`Лексика: сложность ${clean(voc.complexity)}.`);
  if (voc.professionalism) out.push(`Профессиональность лексики: ${clean(voc.professionalism)}.`);
  if (voc.terminology) out.push(`Терминология: ${clean(voc.terminology)}.`);
  if (voc.colloquialisms) out.push(`Разговорные обороты: ${clean(voc.colloquialisms)}.`);
  if (sent.avg_length) out.push(`Средняя длина предложения около ${clean(sent.avg_length)} слов.`);
  if (sent.variance) out.push(`Вариативность длины предложений: ${clean(sent.variance)}. Не ставь подряд три предложения одинаковой длины.`);
  if (sent.questions) out.push(`Вопросы в тексте: ${clean(sent.questions)}.`);
  if (par.length) out.push(`Длина абзаца: ${clean(par.length)}.`);
  if (par.density) out.push(`Плотность абзаца: ${clean(par.density)}.`);
  if (par.logic) out.push(`Логика абзаца: ${clean(par.logic)}.`);
  if (rhy.dynamics) out.push(`Динамика: ${clean(rhy.dynamics)}.`);
  if (rhy.alternation) out.push(`Чередование: ${clean(rhy.alternation)}.`);
  if (rhy.accents) out.push(`Акценты: ${clean(rhy.accents)}.`);
  if (fp) {
    out.push(`Ориентир по замерам эталонных текстов: средняя длина предложения ${fp.avg_sentence_length} слов, средняя длина абзаца ${fp.avg_paragraph_length} слов.`);
  }
  return out;
}

function section(title: string, lines: string[]): string {
  const items = dedupe(lines);
  if (!items.length) return "";
  return `## ${title}\n${items.map(l => `- ${l}`).join("\n")}`;
}

export interface CompileInput {
  name: string;
  role?: string | null;
  personaDna: PersonaDna;
  styleDna: StyleDna;
  fingerprint?: StyleFingerprint | null;
}

/**
 * Master Prompt содержит только постоянные правила автора.
 * Никакой конкретной статьи, заголовка, ключей, URL и CTA здесь быть не должно.
 */
export function compileMasterPrompt(input: CompileInput): string {
  const { personaDna: dna, styleDna: style } = input;
  const identity = dna.identity || {};
  const expertise = (dna.expertise || {}) as Record<string, unknown>;
  const audience = (dna.audience || {}) as Record<string, unknown>;
  const purpose = dna.purpose || {};
  const narrative = (dna.narrative || {}) as Record<string, unknown>;

  const blocks: string[] = [];

  blocks.push(`# ROLE\nТы ${clean(input.role || identity.role || input.name)}. Ты пишешь как конкретный автор с устойчивой идентичностью, а не как универсальный AI-копирайтер.`);

  blocks.push(section("IDENTITY", [
    identity.competence_area ? `Область компетенции: ${clean(identity.competence_area)}.` : "",
    ...list(identity.competence_limits).map(l => `Граница компетенции: ${l}`),
    identity.status ? `Статус автора: ${clean(identity.status)}.` : "",
    "Не приписывай себе должности, образование, стаж, клиентов, сертификаты и личные истории, если они не переданы отдельно как проверенные данные.",
  ]));

  blocks.push(section("EXPERTISE", [
    ...list(expertise.knowledge_domains).map(d => `Домен знаний: ${d}`),
    ...list(expertise.decision_frameworks).map(d => `Модель принятия решения: ${d}`),
    expertise.argumentation_style ? `Аргументация: ${clean(expertise.argumentation_style)}.` : "",
    expertise.depth ? `Глубина: ${clean(expertise.depth)}.` : "",
    expertise.terminology_level ? `Уровень терминологии: ${clean(expertise.terminology_level)}.` : "",
    ...list(expertise.limitations).map(l => `Ограничение: ${l}`),
    "Экспертность показывай через объяснение причин, сравнение вариантов, практические критерии, разбор ошибок, ограничения и конкретные рекомендации.",
  ]));

  blocks.push(section("AUDIENCE", [
    audience.primary_audience ? `Основная аудитория: ${clean(audience.primary_audience)}.` : "",
    audience.knowledge_level ? `Уровень подготовки: ${clean(audience.knowledge_level)}.` : "",
    ...list(audience.needs).map(x => `Потребность: ${x}`),
    ...list(audience.pain_points).map(x => `Боль: ${x}`),
    ...list(audience.questions).map(x => `Вопрос читателя: ${x}`),
    ...list(audience.objections).map(x => `Возражение: ${x}`),
    ...list(audience.decision_factors).map(x => `Фактор выбора: ${x}`),
    "Сложность объяснения подстраивай под этот уровень подготовки.",
  ]));

  blocks.push(section("PURPOSE", [
    purpose.primary ? `Основная цель: ${clean(purpose.primary)}.` : "",
    purpose.secondary ? `Вторичная цель: ${clean(purpose.secondary)}.` : "",
    purpose.tertiary ? `Третичная цель: ${clean(purpose.tertiary)}.` : "",
    "При конфликте целей приоритет у основной, но достоверность выше любой цели.",
  ]));

  blocks.push(section("VOICE", voiceBlock(dna)));
  blocks.push(section("STYLE", styleBlock(style, input.fingerprint)));

  blocks.push(section("NARRATIVE", [
    narrative.person ? `Лицо: ${clean(narrative.person)}.` : "",
    narrative.first_person_policy ? `Первое лицо: ${clean(narrative.first_person_policy)}.` : "",
    narrative.storytelling ? `Storytelling: ${clean(narrative.storytelling)}.` : "",
    ...list(narrative.authority_markers).map(x => `Маркер экспертности: ${x}`),
  ]));

  blocks.push(section("FACT POLICY", [
    ...list(dna.fact_policy?.rules),
    dna.fact_policy?.on_missing_data ? `При нехватке данных: ${clean(dna.fact_policy.on_missing_data)}.` : "",
    "Не выдумывай факты, цифры, статистику, исследования, цитаты, отзывы и личный опыт.",
    "При нехватке информации используй проверенные данные, либо прямо обозначай неопределённость, либо запрашивай данные.",
  ]));

  blocks.push(section("SOURCE POLICY", [
    ...list(dna.source_policy?.allowed_sources).map(s => `Допустимый источник: ${s}`),
    ...list(dna.source_policy?.preferred_sources).map(s => `Предпочтительный источник: ${s}`),
    dna.source_policy?.citation_policy ? `Цитирование: ${clean(dna.source_policy.citation_policy)}.` : "",
    dna.source_policy?.verification_policy ? `Проверка: ${clean(dna.source_policy.verification_policy)}.` : "",
    "Не ссылайся на источник, который не был передан и не был проверен.",
  ]));

  blocks.push(section("SEO POLICY", [
    ...list(dna.seo_policy?.principles),
    ...list(dna.seo_policy?.forbidden).map(f => `Запрещено: ${f}`),
    "Ключевые слова употребляй естественно, без переспама.",
    "Запрещены шаблонные SEO-вступления и шаблонные SEO-заключения.",
    "SEO не может нарушать достоверность и естественность.",
  ]));

  if (dna.geo_policy?.enabled) {
    blocks.push(section("GEO POLICY", [
      ...list(dna.geo_policy?.principles),
      "Формулируй явные утверждения, поддерживай фактическую плотность и причинно-следственные связи.",
      "Блоки должны быть самодостаточными и извлекаемыми, но текст остаётся естественным для человека.",
    ]));
  }

  blocks.push(section("ANTI-AI", [
    ...list(dna.anti_ai_policy?.forbidden_patterns).map(p => `Не используй: ${p}`),
    ...list(dna.anti_ai_policy?.required_variety),
    "Не начинай подряд несколько абзацев одинаковой конструкцией.",
    "Чередуй объяснения с конкретными примерами.",
  ]));

  blocks.push(section("EDITORIAL RULES", [
    ...list(dna.editorial_rules),
    "Не используй жирный шрифт для выделения смысла.",
    "Используй короткий дефис вместо длинного тире.",
  ]));

  blocks.push(section("FORBIDDEN", list(dna.forbidden_behaviour)));

  const qc = dna.quality_control || {};
  const qcLines = Object.entries(qc).flatMap(([area, rules]) => list(rules).map(r => `${area}: ${r}`));
  blocks.push(section("SELF CHECK", [
    ...qcLines,
    "Перед выдачей проверь: роль соблюдена, границы компетенции не нарушены, тон и стиль совпадают, выдуманных фактов нет, автор не превратился в универсального копирайтера.",
  ]));

  blocks.push(`## SYSTEM LIMITS\n- Эта персона не отменяет системные ограничения, фактологическую политику и правила безопасности.`);

  return blocks.filter(Boolean).join("\n\n");
}

export interface ArticlePromptInput extends CompileInput {
  siteDna?: SiteDnaData | null;
  platform?: PlatformDna | null;
  brief?: string | null;
  research?: string | null;
  seo?: string | null;
  geo?: string | null;
}

/** Article Prompt: постоянные правила автора + контекст конкретной задачи. */
export function compileArticlePrompt(input: ArticlePromptInput): string {
  const parts: string[] = [compileMasterPrompt(input)];
  if (input.siteDna) {
    const s = input.siteDna;
    parts.push(section("SITE CONTEXT", [
      s.brand_name ? `Бренд: ${clean(s.brand_name)}` : "",
      s.business_type ? `Тип бизнеса: ${clean(s.business_type)}` : "",
      s.industry ? `Тематика: ${clean(s.industry)}` : "",
      s.audience ? `Аудитория сайта: ${clean(s.audience)}` : "",
      s.positioning ? `Позиционирование: ${clean(s.positioning)}` : "",
      ...list(s.usp).map(u => `Преимущество: ${u}`),
      ...list(s.terminology).map(u => `Терминология сайта: ${u}`),
      ...list(s.restrictions).map(u => `Ограничение: ${u}`),
      "Данные сайта используй как контекст. Не додумывай то, чего в них нет.",
    ]));
  }
  if (input.platform) {
    const p = input.platform;
    parts.push(section(`PLATFORM: ${p.label}`, [
      `Формат: ${p.format}`, `Объём: ${p.length}`, `Стиль площадки: ${p.style}`,
      `Storytelling: ${p.storytelling}`, `Структура: ${p.structure}`, `Коммерческая часть: ${p.commercial}`,
    ]));
  }
  if (input.brief) parts.push(`## ARTICLE BRIEF\n${clean(input.brief)}`);
  if (input.research) parts.push(`## RESEARCH\n${input.research}`);
  if (input.seo) parts.push(`## SEO\n${input.seo}`);
  if (input.geo) parts.push(`## GEO\n${input.geo}`);
  return parts.filter(Boolean).join("\n\n");
}

/** Компактный блок для передачи в существующий Writer как дополнительный контекст. */
export function buildWriterPersonaBlock(
  persona: { name: string; master_prompt: string | null },
  siteDna?: SiteDnaData | null,
  platform?: PlatformDna | null,
): string {
  if (!persona.master_prompt) return "";
  const parts = [`# AUTHOR INTELLIGENCE (Persona: ${persona.name})`, persona.master_prompt];
  if (siteDna) {
    parts.push(section("SITE CONTEXT", [
      siteDna.brand_name ? `Бренд: ${clean(siteDna.brand_name)}` : "",
      siteDna.industry ? `Тематика: ${clean(siteDna.industry)}` : "",
      siteDna.audience ? `Аудитория: ${clean(siteDna.audience)}` : "",
      ...list(siteDna.restrictions).map(u => `Ограничение: ${u}`),
    ]));
  }
  if (platform) {
    parts.push(section(`PLATFORM: ${platform.label}`, [
      `Формат: ${platform.format}`, `Стиль площадки: ${platform.style}`, `Структура: ${platform.structure}`,
    ]));
  }
  return parts.filter(Boolean).join("\n\n");
}