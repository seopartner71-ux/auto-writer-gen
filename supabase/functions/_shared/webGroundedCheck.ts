// Web-grounded fact-check via Perplexity Sonar (through OpenRouter).
// Used as a 3rd verification pass for PRO/FACTORY plans on top of:
//   1) regex anti-fake guard
//   2) cross-model LLM fact-check (different family than generator)
// This pass only triggers when the content contains "risky" factual claims:
// numbers, percentages, years, currency, named entities (capitalized phrases).
// It asks Perplexity to verify each claim against live web sources and returns
// rewritten HTML where unverified claims are softened to neutral wording.

export interface WebGroundedResult {
  html: string;
  verified: string[];      // claims confirmed by web sources
  unverified: string[];    // claims softened (no source found)
  citations: string[];     // source URLs used
  tokensIn: number;
  tokensOut: number;
  model: string;
  skipped: boolean;
  reason?: string;
}

/** Quick heuristic: does the HTML contain factual claims worth verifying? */
export function hasRiskyClaims(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, " ");
  // % or digits with units / years / currency
  if (/\b\d{1,4}\s?%/.test(text)) return true;                  // 87%
  if (/\b(19|20)\d{2}\s?(г|год|year)?/i.test(text)) return true; // 2024 г
  if (/\b\d[\d\s.,]{2,}\s?(₽|руб|\$|€|usd|eur|rub)/i.test(text)) return true;
  if (/\b(по\s+данным|согласно|исследовани|статистик|опрос)/i.test(text)) return true;
  return false;
}

export async function webGroundedFactCheck(opts: {
  apiKey: string;
  html: string;
  briefSummary: string;
  language?: "ru" | "en";
  timeoutMs?: number;
}): Promise<WebGroundedResult> {
  const lang = opts.language || "ru";
  const model = "perplexity/sonar"; // cheap, web-grounded
  const system = lang === "ru"
    ? `Ты web-grounded фактчекер. Дан HTML-блок и краткий контекст бизнеса.
Найди в HTML конкретные факты: проценты, статистики, годы, суммы, "по данным X".
Для каждого факта проверь его в открытых источниках в интернете.
Если факт НЕ подтверждается надежным источником - перепиши в нейтральную форму
("практика показывает", "по нашему опыту", "по разным оценкам", без конкретных цифр).
Сохрани HTML-структуру и общий смысл, не сокращай текст.

Формат ответа: СТРОГИЙ JSON без markdown:
{"html":"<HTML>","verified":["подтвержденный факт"],"unverified":["убранный факт"],"citations":["url1"]}`
    : `You are a web-grounded fact-checker. Given an HTML block and business context,
find concrete claims (percentages, stats, years, money, "according to X").
Verify each one against live web sources. If a claim is NOT supported by a
reliable source, rewrite it in neutral wording ("practice shows", "by various
estimates", without specific numbers). Preserve HTML structure and overall meaning.

Output: STRICT JSON, no markdown:
{"html":"<HTML>","verified":["claim"],"unverified":["claim"],"citations":["url"]}`;
  const user = `КОНТЕКСТ:\n${opts.briefSummary.slice(0, 2000)}\n\nHTML:\n${opts.html}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 75_000);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://seo-modul.pro",
        "X-Title": "SEO-Modul Web-Grounded FactCheck",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: Math.min(4000, opts.html.length + 1000),
      }),
    });
    if (!r.ok) {
      const t2 = await r.text().catch(() => "");
      return { html: opts.html, verified: [], unverified: [], citations: [], tokensIn: 0, tokensOut: 0, model, skipped: true, reason: `http_${r.status}:${t2.slice(0, 120)}` };
    }
    const j = await r.json();
    const raw = String(j?.choices?.[0]?.message?.content || "").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.html === "string" && parsed.html.length > 30) {
      return {
        html: parsed.html,
        verified: Array.isArray(parsed.verified) ? parsed.verified.map(String) : [],
        unverified: Array.isArray(parsed.unverified) ? parsed.unverified.map(String) : [],
        citations: Array.isArray(parsed.citations) ? parsed.citations.map(String) : [],
        tokensIn: Number(j?.usage?.prompt_tokens || 0),
        tokensOut: Number(j?.usage?.completion_tokens || 0),
        model,
        skipped: false,
      };
    }
    return { html: opts.html, verified: [], unverified: [], citations: [], tokensIn: 0, tokensOut: 0, model, skipped: true, reason: "parse_failed" };
  } catch (e) {
    return { html: opts.html, verified: [], unverified: [], citations: [], tokensIn: 0, tokensOut: 0, model, skipped: true, reason: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}