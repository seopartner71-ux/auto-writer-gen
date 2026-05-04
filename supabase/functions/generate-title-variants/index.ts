import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

interface Body {
  keyword: string;
  content?: string;
  language?: "ru" | "en";
  current_title?: string;
  current_meta?: string;
}

function buildPrompt(b: Body): string {
  const lang = b.language === "en" ? "English" : "Russian";
  return `You are an expert SEO copywriter. Generate 3 strikingly different title and meta-description variants for the given keyword and article. The variants must each follow a different angle so the user can A/B test them.

LANGUAGE: ${lang}
KEYWORD: ${b.keyword}
${b.current_title ? `CURRENT TITLE: ${b.current_title}` : ""}
${b.current_meta ? `CURRENT META: ${b.current_meta}` : ""}
${b.content ? `ARTICLE EXCERPT (first 2000 chars):\n${b.content.slice(0, 2000)}` : ""}

RULES:
- Title: 50-60 chars, must contain the keyword, no clickbait, no quotes around the whole string.
- Meta: 140-160 chars, must contain the keyword, end with a clear value or CTA.
- Each variant has its own angle: variant A = informational/expert, variant B = problem-solution/benefit, variant C = listicle/numeric/curiosity.
- DO NOT use bold, em-dashes, or emojis. Use hyphen "-" if a dash is needed.
- Russian: never use the letter "ё" - always replace with "е".

Return STRICT JSON ONLY (no prose, no code fences):
{"variants":[{"angle":"informational","title":"...","meta":"..."},{"angle":"benefit","title":"...","meta":"..."},{"angle":"curiosity","title":"...","meta":"..."}]}`;
}

function tryParseJson(s: string): any | null {
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("Invalid JSON", 400); }
  if (!body?.keyword || typeof body.keyword !== "string") {
    return errorResponse("keyword is required", 400);
  }

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an SEO copywriter. Always reply with valid JSON only." },
          { role: "user", content: buildPrompt(body) },
        ],
        temperature: 0.85,
      }),
    });

    if (resp.status === 429) return errorResponse("Rate limit, try again later", 429);
    if (resp.status === 402) return errorResponse("AI credits exhausted", 402);
    if (!resp.ok) return errorResponse(`AI gateway: ${resp.status}`, 502);

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = tryParseJson(raw);
    if (!parsed?.variants || !Array.isArray(parsed.variants)) {
      return errorResponse("AI returned invalid format", 502, { raw });
    }

    // Sanitize: strip ё, em-dash, bold
    const clean = (s: string) => String(s || "")
      .replace(/\*\*/g, "")
      .replace(/[—–]/g, "-")
      .replace(/ё/g, "е").replace(/Ё/g, "Е")
      .replace(/^["'«»]+|["'«»]+$/g, "")
      .trim();

    const variants = parsed.variants.slice(0, 3).map((v: any) => ({
      angle: clean(v.angle) || "variant",
      title: clean(v.title),
      meta: clean(v.meta),
    })).filter((v: any) => v.title && v.meta);

    if (variants.length === 0) return errorResponse("No valid variants generated", 502);

    return jsonResponse({ variants });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});
