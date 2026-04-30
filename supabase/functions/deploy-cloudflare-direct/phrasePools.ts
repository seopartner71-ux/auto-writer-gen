// ============================================================================
// Deterministic phrase-pool picker.
//
// All hardcoded UI phrases on PBN sites used to be byte-identical across the
// network, which made textual fingerprint clustering trivial. This module
// exposes pools of synonyms and a seed-stable picker so each site renders a
// distinct (but always sensible) variant — and the SAME variant on every
// re-deploy.
//
// Seed convention: callers pass `${projectId}:${poolName}` so different pools
// on the same site pick independently.
// ============================================================================

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic xorshift32 stream seeded from a string. */
export function seedRng(seed: string): () => number {
  let s = fnv1a(seed) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s;
  };
}

/** Pick one element from `pool` deterministically by seed. */
export function pickFromSeed<T>(pool: T[], seed: string): T {
  if (!pool || pool.length === 0) return undefined as unknown as T;
  const h = fnv1a(seed);
  return pool[h % pool.length];
}

/** Integer in [min, max] inclusive, deterministic by seed. */
export function intFromSeed(min: number, max: number, seed: string): number {
  const h = fnv1a(seed);
  const span = Math.max(1, max - min + 1);
  return min + (h % span);
}

// ----------------------------- Phrase pools ---------------------------------

const POOLS: Record<string, { ru: string[]; en: string[] }> = {
  // Footer trust line.
  trustLine: {
    ru: [
      "Безопасная оплата · SSL · Visa · Mastercard · МИР · СБП",
      "Защищенная оплата · Visa · МИР · СБП · Наличные",
      "Оплата онлайн и наличными · SSL защита · МИР · СБП",
      "Принимаем · Visa · Mastercard · МИР · СБП · Наличные",
      "Безопасные платежи · Карты · СБП · Наличные",
    ],
    en: [
      "Secure payment · SSL · Visa · Mastercard",
      "Protected payments · Visa · Mastercard · Apple Pay",
      "Online and on-site payments · SSL protected",
      "We accept · Visa · Mastercard · Amex · PayPal",
      "Trusted checkout · Cards · Apple Pay · Google Pay",
    ],
  },

  // AI-summary block label on post pages.
  aiSummaryLabel: {
    ru: [
      "Коротко о главном",
      "Главное из статьи",
      "Кратко о теме",
      "Суть материала",
      "Ключевые моменты",
    ],
    en: [
      "Quick answer",
      "Key takeaways",
      "In short",
      "The gist",
      "What you need to know",
    ],
  },

  // "Related posts" sidebar heading.
  relatedTitle: {
    ru: [
      "Читайте также",
      "Похожие материалы",
      "Может быть интересно",
      "Смотрите еще",
      "По теме",
    ],
    en: [
      "Related posts",
      "You might also like",
      "More on the topic",
      "Keep reading",
      "See also",
    ],
  },

  // Landing CTA section subtitle.
  ctaSectionText: {
    ru: [
      "Оставьте заявку — перезвоним за 15 минут",
      "Свяжитесь с нами — ответим в течение часа",
      "Напишите нам — консультация бесплатно",
      "Получите консультацию — звоним в день обращения",
      "Оставьте контакт — специалист свяжется с вами",
    ],
    en: [
      "Leave a request — we will call back within 15 minutes",
      "Contact us — we reply within an hour",
      "Write to us — consultation is free",
      "Request a quote — same-day callback",
      "Leave your contact — a specialist will reach out",
    ],
  },

  // Landing "Why choose us" heading.
  whyTitle: {
    ru: [
      "Почему мы",
      "Наши преимущества",
      "Чем мы лучше",
      "Наши плюсы",
      "О нас",
    ],
    en: [
      "Why choose us",
      "Our advantages",
      "What sets us apart",
      "Our strengths",
      "About us",
    ],
  },

  // "About us at a glance" facts card.
  atGlance: {
    ru: [
      "Коротко о нас",
      "В двух словах",
      "Главное о компании",
      "Факты о нас",
      "Цифры и факты",
    ],
    en: [
      "At a glance",
      "Company snapshot",
      "Key facts",
      "By the numbers",
      "About us in brief",
    ],
  },

  // 404 page subtitle.
  notFoundSub: {
    ru: [
      "Кажется, вы заблудились",
      "Такой страницы не существует",
      "Страница переехала или удалена",
      "Здесь ничего нет — но это поправимо",
      "Похоже, ссылка устарела",
    ],
    en: [
      "Looks like you got lost",
      "This page does not exist",
      "The page moved or was removed",
      "Nothing here — but we can fix that",
      "The link looks outdated",
    ],
  },

  // ----- Magazine homepage pools (template №2) -----
  magAboutTitle: {
    ru: [
      "О журнале",
      "Что мы пишем",
      "Наша редакция",
      "О проекте",
      "Кто мы такие",
    ],
    en: [
      "About the magazine",
      "What we cover",
      "Our editorial",
      "About the project",
      "Who we are",
    ],
  },
  magAboutText: {
    ru: [
      "Независимое издание о практике и опыте — без воды и инфоповодов ради инфоповодов.",
      "Разбираем рынок изнутри: гайды, кейсы, интервью с практиками и обзоры инструментов.",
      "Пишем простым языком о сложных вещах. Каждый материал проверяет редактор-практик.",
      "Собираем материалы, которые помогают принимать решения, а не пугают трендами.",
      "Журнал для тех, кто работает руками и хочет читать редакторский, а не рекламный контент.",
    ],
    en: [
      "An independent publication about real practice — no fluff, no clickbait.",
      "We cover the industry from the inside: guides, case studies, interviews and tool reviews.",
      "We explain complex things in plain language. Every story is reviewed by a hands-on editor.",
      "Materials that help you decide, not scare you with trends.",
      "A magazine for people who actually do the work and want editorial, not ads.",
    ],
  },
  magReadAll: {
    ru: ["Читать все материалы", "Все статьи журнала", "Открыть архив", "Перейти к материалам", "Читать дальше"],
    en: ["Read all stories", "All articles", "Open the archive", "See all materials", "Keep reading"],
  },
  magCategoriesTitle: {
    ru: ["Тематические рубрики", "Разделы журнала", "О чём пишем", "Темы материалов", "Рубрики"],
    en: ["Topics we cover", "Sections", "What we write about", "Categories", "Browse by topic"],
  },
  magPopularTitle: {
    ru: ["Самое читаемое", "Топ материалов недели", "Популярное", "Что читают сейчас", "Хиты редакции"],
    en: ["Most read", "Top of the week", "Popular", "Trending now", "Editor's hits"],
  },
  magExpertTitle: {
    ru: ["Экспертная колонка", "Слово редактора", "От первого лица", "Колонка эксперта", "Мнение редакции"],
    en: ["Expert column", "Editor's note", "From the editor", "Expert opinion", "Editorial"],
  },
  magExpertCta: {
    ru: ["Все материалы автора", "Читать колонку", "Все статьи автора", "Архив автора", "Больше от автора"],
    en: ["All posts by author", "Read the column", "All author's articles", "Author archive", "More from the author"],
  },
  magNewsletterTitle: {
    ru: ["Подпишитесь на рассылку", "Дайджест на почту", "Лучшее за неделю — на почту", "Письмо от редакции", "Получайте новые материалы"],
    en: ["Subscribe to the newsletter", "Weekly digest", "Best of the week — by email", "Editor's letter", "Get new stories"],
  },
  magNewsletterButton: {
    ru: ["Подписаться", "Получать письма", "Хочу дайджест", "Подпишите меня", "Готов читать"],
    en: ["Subscribe", "Get the letter", "Sign me up", "Send the digest", "Subscribe me"],
  },
  magCommentsTitle: {
    ru: ["Обсуждение", "Комментарии", "Что вы думаете?", "Ваше мнение", "Дискуссия"],
    en: ["Discussion", "Comments", "What do you think?", "Your opinion", "Join the conversation"],
  },
  magReadingTime: {
    ru: ["мин чтения", "минут чтения", "мин на чтение", "мин"],
    en: ["min read", "minutes read", "min", "min to read"],
  },
  magViews: {
    ru: ["просмотров", "прочтений", "читателей"],
    en: ["views", "reads", "readers"],
  },
  magCategoryAll: {
    ru: ["Все", "Все материалы", "Главная лента"],
    en: ["All", "All stories", "Main feed"],
  },
  magCategoryTips: {
    ru: ["Советы", "Лайфхаки", "Подсказки", "Практика"],
    en: ["Tips", "Hacks", "How-tos", "Practice"],
  },
  magCategoryReviews: {
    ru: ["Обзоры", "Разборы", "Тесты", "Сравнения"],
    en: ["Reviews", "Breakdowns", "Tests", "Comparisons"],
  },
  magCategoryNews: {
    ru: ["Новости", "События", "Анонсы", "Свежее"],
    en: ["News", "Events", "Announcements", "Latest"],
  },
  magCategoryGuides: {
    ru: ["Гайды", "Инструкции", "Чек-листы", "Пошагово"],
    en: ["Guides", "How-tos", "Checklists", "Step by step"],
  },

  // Brand tagline rendered under siteName in header (deterministic per project).
  // Keep generic — actual topic is appended at the call-site if needed.
  brandTagline: {
    ru: [
      "Журнал о практике",
      "Экспертный блог",
      "Гайды и обзоры",
      "Полезные материалы",
      "Издание для практиков",
      "Разбираемся в деталях",
      "Опыт и кейсы",
      "Простыми словами",
    ],
    en: [
      "Practical journal",
      "Expert blog",
      "Guides and reviews",
      "Useful stories",
      "Hands-on magazine",
      "Details that matter",
      "Cases and experience",
      "In plain language",
    ],
  },
};

/**
 * Get a deterministic localized phrase from `pool`.
 * Caller must pass a seed (e.g. projectId).
 */
export function pickPhrase(
  pool: keyof typeof POOLS,
  lang: string,
  seed: string,
): string {
  const isRu = String(lang || "").toLowerCase().startsWith("ru");
  const list = (POOLS[pool]?.[isRu ? "ru" : "en"]) || [];
  return pickFromSeed(list, `${seed}:${String(pool)}`);
}