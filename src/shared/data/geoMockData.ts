// Central mock data for GEO modules — Prompts, Groups, Sources, Mentions

export interface PromptGroup {
  id: string;
  name: string;
  slug: string;
}

export interface GeoPrompt {
  id: string;
  text: string;
  groupId: string | null;
  createdAt: string;
}

export interface MentionResult {
  promptId: string;
  model: string;
  mentioned: boolean;
  sentiment: "positive" | "negative" | "neutral";
  snippet: string | null;
  checkedAt: string;
  position: number | null;
  sourceUrl: string | null;
}

export interface GeoSource {
  id: string;
  url: string;
  domain: string;
  favicon: string;
  type: "service" | "media" | "marketplace" | "ugc" | "aggregator" | "content" | "store";
  occurrenceCount: number;
}

export const PROMPT_GROUPS: PromptGroup[] = [
  { id: "all", name: "Все", slug: "all" },
  { id: "unassigned", name: "Без группы", slug: "unassigned" },
  { id: "situational", name: "Ситуационные", slug: "situational" },
  { id: "comparative", name: "Сравнительные", slug: "comparative" },
  { id: "reputational", name: "Репутационные", slug: "reputational" },
  { id: "recommendation", name: "Рекомендательные", slug: "recommendation" },
];

export const AI_MODELS = [
  { key: "chatgpt", name: "ChatGPT", color: "#10a37f" },
  { key: "perplexity", name: "Perplexity", color: "#1fb8cd" },
  { key: "claude", name: "Claude", color: "#d97706" },
  { key: "gemini", name: "Gemini", color: "#4285f4" },
  { key: "yandex", name: "YandexGPT", color: "#fc3f1d" },
];

export const MOCK_PROMPTS: GeoPrompt[] = [
  { id: "p1", text: "Лучшие SEO инструменты для малого бизнеса", groupId: "recommendation", createdAt: "2025-06-01" },
  { id: "p2", text: "Сравни Ahrefs и SEMrush", groupId: "comparative", createdAt: "2025-06-01" },
  { id: "p3", text: "Что такое GEO оптимизация", groupId: "situational", createdAt: "2025-06-02" },
  { id: "p4", text: "Отзывы о сервисе ContentBot", groupId: "reputational", createdAt: "2025-06-02" },
  { id: "p5", text: "Как продвигать сайт в 2025 году", groupId: null, createdAt: "2025-06-03" },
  { id: "p6", text: "Какой AI лучше пишет статьи", groupId: "comparative", createdAt: "2025-06-03" },
  { id: "p7", text: "Рекомендации по контент маркетингу", groupId: "recommendation", createdAt: "2025-06-04" },
  { id: "p8", text: "Проблемы с индексацией Google", groupId: "situational", createdAt: "2025-06-04" },
  { id: "p9", text: "Топ платформы для генерации контента", groupId: "recommendation", createdAt: "2025-06-05" },
  { id: "p10", text: "Негативные отзывы о нейросетях", groupId: "reputational", createdAt: "2025-06-05" },
  { id: "p11", text: "AI tools for link building", groupId: null, createdAt: "2025-06-06" },
  { id: "p12", text: "Почему упали позиции в поиске", groupId: "situational", createdAt: "2025-06-06" },
];

export const MOCK_MENTIONS: MentionResult[] = (() => {
  const results: MentionResult[] = [];
  const sentiments: MentionResult["sentiment"][] = ["positive", "negative", "neutral"];
  MOCK_PROMPTS.forEach((p) => {
    AI_MODELS.forEach((m) => {
      const mentioned = Math.random() > 0.35;
      results.push({
        promptId: p.id,
        model: m.key,
        mentioned,
        sentiment: sentiments[Math.floor(Math.random() * 3)],
        snippet: mentioned ? `Ответ ${m.name} по запросу "${p.text.slice(0, 30)}..."` : null,
        checkedAt: "2025-06-07",
        position: mentioned ? Math.floor(Math.random() * 10) + 1 : null,
        sourceUrl: mentioned ? `https://example.com/${m.key}/${p.id}` : null,
      });
    });
  });
  return results;
})();

export const SOURCE_TYPES: Record<GeoSource["type"], { label: string; color: string }> = {
  service: { label: "Сервис", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  media: { label: "Медиа", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  marketplace: { label: "Маркетплейс", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  ugc: { label: "UGC", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  aggregator: { label: "Агрегатор", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  content: { label: "Контент", color: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200" },
  store: { label: "Магазин", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
};

export const MOCK_SOURCES: GeoSource[] = [
  { id: "s1", url: "https://vc.ru/marketing/seo-tools", domain: "vc.ru", favicon: "https://www.google.com/s2/favicons?domain=vc.ru", type: "media", occurrenceCount: 47 },
  { id: "s2", url: "https://habr.com/ru/articles/ai-content", domain: "habr.com", favicon: "https://www.google.com/s2/favicons?domain=habr.com", type: "content", occurrenceCount: 38 },
  { id: "s3", url: "https://www.ozon.ru/category/software", domain: "ozon.ru", favicon: "https://www.google.com/s2/favicons?domain=ozon.ru", type: "marketplace", occurrenceCount: 31 },
  { id: "s4", url: "https://pikabu.ru/tag/ai", domain: "pikabu.ru", favicon: "https://www.google.com/s2/favicons?domain=pikabu.ru", type: "ugc", occurrenceCount: 25 },
  { id: "s5", url: "https://sravni.ru/software", domain: "sravni.ru", favicon: "https://www.google.com/s2/favicons?domain=sravni.ru", type: "aggregator", occurrenceCount: 22 },
  { id: "s6", url: "https://serpstat.com/blog", domain: "serpstat.com", favicon: "https://www.google.com/s2/favicons?domain=serpstat.com", type: "service", occurrenceCount: 19 },
  { id: "s7", url: "https://rb.ru/story/ai-marketing", domain: "rb.ru", favicon: "https://www.google.com/s2/favicons?domain=rb.ru", type: "media", occurrenceCount: 17 },
  { id: "s8", url: "https://wildberries.ru/catalog/electronics", domain: "wildberries.ru", favicon: "https://www.google.com/s2/favicons?domain=wildberries.ru", type: "store", occurrenceCount: 14 },
  { id: "s9", url: "https://spark.ru/startup/ai-tools", domain: "spark.ru", favicon: "https://www.google.com/s2/favicons?domain=spark.ru", type: "content", occurrenceCount: 12 },
  { id: "s10", url: "https://yandex.ru/q/ai-tools", domain: "yandex.ru", favicon: "https://www.google.com/s2/favicons?domain=yandex.ru", type: "aggregator", occurrenceCount: 10 },
];
