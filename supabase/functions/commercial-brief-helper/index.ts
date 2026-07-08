// Lightweight AI helper for commercial brief: generates UTP variants or benefits.
// Free of charge (no credit deduction). Rate-limited via check_rate_limit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient, requireAdminOrStaff } from "../_shared/auth.ts";
import { withTimeout } from "../_shared/withTimeout.ts";
import { logLLM } from "../_shared/costLogger.ts";

interface ReqBody {
  kind: "utp" | "benefits";
  niche?: string;
  page_type?: string;
  city?: string;
}

function tryParseJsonArray(text: string): string[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string").map((s) => String(s).replace(/ё/g, "е").replace(/Ё/g, "Е")) : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const forbidden = await requireAdminOrStaff(auth);
    if (forbidden) return forbidden;
    const userId = auth.userId;

    let body: ReqBody;
    try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }
    if (!body?.kind || (body.kind !== "utp" && body.kind !== "benefits")) {
      return errorResponse("kind must be 'utp' or 'benefits'", 400);
    }

    const sb = adminClient();
    const { data: rateOk } = await sb.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action: "commercial_brief_helper",
      p_max_requests: 30,
      p_window_minutes: 60,
    });
    if (rateOk === false) return errorResponse("Слишком много запросов. Попробуйте через минуту.", 429);

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return errorResponse("OPENROUTER_API_KEY not configured", 500);

    const isUtp = body.kind === "utp";
    const count = isUtp ? 5 : 8;
    const system = isUtp
      ? `Ты эксперт по коммерческим текстам и маркетингу. Сгенерируй 5 уникальных УТП для компании. Каждое УТП - одно предложение, конкретное, без воды, с измеримой выгодой. Без буквы "е с двумя точками". Формат ответа: JSON массив из 5 строк. Только JSON, без пояснений.`
      : `Сгенерируй 8 конкретных преимуществ компании для коммерческой страницы. Каждое преимущество - короткая фраза (3-7 слов), без воды и клише. Без буквы "е с двумя точками". Формат: JSON массив из 8 строк. Только JSON, без пояснений.`;

    const user = `Ниша: ${body.niche || "не указана"}. Тип страницы: ${body.page_type || "service"}. Город: ${body.city || "не указан"}.`;

    const upstream = await withTimeout(
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://seo-modul.pro",
          "X-Title": "SEO-Module Brief Helper",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          max_tokens: 600,
          temperature: 0.8,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      }),
      30_000,
      "brief helper timeout",
    );

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      return errorResponse(`Upstream ${upstream.status}: ${t.slice(0, 200)}`, 502);
    }
    const json = await upstream.json();
    try { logLLM({ functionName: "commercial-brief-helper", model: ((json as any)?.model) as string, tokensIn: Number((json as any)?.usage?.prompt_tokens || 0), tokensOut: Number((json as any)?.usage?.completion_tokens || 0) }); } catch(_) {}
    const text = (json?.choices?.[0]?.message?.content || "").trim();
    const items = tryParseJsonArray(text).slice(0, count);
    if (!items.length) return errorResponse("Не удалось разобрать ответ модели", 502);

    return jsonResponse({ items });
  } catch (e) {
    return errorResponse(`Server error: ${e instanceof Error ? e.message : "unknown"}`, 500);
  }
});
