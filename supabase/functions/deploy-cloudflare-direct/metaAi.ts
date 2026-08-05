// Resolves the short site positioning (3-6 words) and the homepage meta
// description. Uses the value stored on the project when present, otherwise
// asks the LLM once per deploy. Always degrades to a safe local fallback.

import { clampWords, buildMetaDescription, normalizeText, DESC_MAX } from "./metaTitles.ts";

export interface SiteMetaInput {
  siteName: string;
  topic: string;
  siteAbout?: string;
  positioning?: string;
  lang?: string;
}

export interface SiteMetaResult {
  positioning: string;
  metaDescription: string;
}

function localFallback(i: SiteMetaInput): SiteMetaResult {
  const positioning = clampWords(i.positioning || i.topic, 42);
  const isRu = String(i.lang || "ru").toLowerCase().startsWith("ru");
  const base = normalizeText(i.siteAbout) ||
    (isRu
      ? `Разбираем тему «${i.topic}»: практические материалы, пошаговые инструкции и ответы на частые вопросы.`
      : `Practical guides, step-by-step instructions and answers about ${i.topic}.`);
  return { positioning, metaDescription: buildMetaDescription(base, { fallback: base }) };
}

export async function resolveSiteMeta(input: SiteMetaInput): Promise<SiteMetaResult> {
  const fallback = localFallback(input);
  const apiKey = (Deno.env.get("OPENROUTER_API_KEY") || "").trim();
  const isRu = String(input.lang || "ru").toLowerCase().startsWith("ru");
  const needPositioning = !normalizeText(input.positioning);
  if (!apiKey) return fallback;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul site meta",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Write website SEO meta data in ${isRu ? "Russian" : "English"}. Return ONLY JSON: ` +
              `{"positioning":"3-6 words, no site name, no punctuation at the end",` +
              `"meta_description":"one finished sentence block of 130-160 characters"}. ` +
              `The description must not repeat the site name as its opening and must not start with ` +
              `"${isRu ? "Наш блог / Наш сайт" : "Our blog / Our site"}".`,
          },
          {
            role: "user",
            content: `Site: ${input.siteName}\nTopic: ${input.topic}\nAbout: ${normalizeText(input.siteAbout).slice(0, 400)}` +
              (needPositioning ? "" : `\nUse this positioning verbatim: ${input.positioning}`),
          },
        ],
        max_tokens: 220,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const data = await res.json();
    const parsed = JSON.parse(String(data?.choices?.[0]?.message?.content || "{}"));
    const positioning = needPositioning
      ? clampWords(parsed.positioning || fallback.positioning, 42)
      : fallback.positioning;
    const metaDescription = buildMetaDescription(parsed.meta_description, {
      fallback: fallback.metaDescription,
      max: DESC_MAX,
    }) || fallback.metaDescription;
    return { positioning: positioning || fallback.positioning, metaDescription };
  } catch (_) {
    return fallback;
  }
}
