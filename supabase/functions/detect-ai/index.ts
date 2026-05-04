// detect-ai: returns AI-likelihood score 0..100 (higher = more AI-ish).
// Hybrid: deterministic heuristics + LLM second opinion. No external paid API.
// Used by HumanScorePanel auto-loop to gate humanize-fix.

import { corsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

const RU_CLICHES = [
  "является","данный","стоит отметить","в заключение","важно отметить",
  "необходимо учитывать","следует подчеркнуть","таким образом","на сегодняшний день",
  "комплексный подход","представляет собой","рассмотрим подробнее",
  "прогресс не стоит на месте","давайте посмотрим правде в глаза",
  "в современном мире","играет важную роль","не секрет что",
];
const EN_CLICHES = [
  "in conclusion","it is important to note","in today's world","navigating the landscape",
  "delve into","in the realm of","it's worth noting","moreover","furthermore",
  "leverage","robust","seamless","cutting-edge","game-changer","comprehensive",
  "utilize","streamline","meticulously","uncover",
];

function detectLang(text: string): "ru" | "en" {
  const cyr = (text.match(/[А-Яа-я]/g) || []).length;
  const lat = (text.match(/[A-Za-z]/g) || []).length;
  return cyr > lat ? "ru" : "en";
}

function splitSentences(text: string): string[] {
  return text.replace(/([.!?])\s+/g, "$1\n").split("\n")
    .map(s => s.trim()).filter(s => s.length > 2);
}

interface Heuristics {
  ai_score: number;       // 0..100 (higher = more AI)
  burstiness_cv: number;  // coefficient of variation %
  cliche_count: number;
  cliche_density: number; // per 1000 words
  short_ratio: number;    // sentences <8 words
  long_ratio: number;     // sentences >25 words
  forbidden_chars: number;// **, em-dash, ё (RU)
  word_count: number;
  flags: string[];
}

function runHeuristics(text: string, lang: "ru" | "en"): Heuristics {
  const flags: string[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wc = words.length;
  const sentences = splitSentences(text);
  const lengths = sentences.map(s => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / Math.max(1, lengths.length);
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

  const shortCount = lengths.filter(l => l < 8).length;
  const longCount = lengths.filter(l => l > 25).length;
  const shortRatio = lengths.length ? shortCount / lengths.length : 0;
  const longRatio = lengths.length ? longCount / lengths.length : 0;

  const dict = lang === "ru" ? RU_CLICHES : EN_CLICHES;
  const lower = text.toLowerCase();
  let clicheCount = 0;
  for (const c of dict) {
    const re = new RegExp(c.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "gi");
    const m = lower.match(re);
    if (m) clicheCount += m.length;
  }
  const clicheDensity = wc ? (clicheCount / wc) * 1000 : 0;

  let forbidden = 0;
  forbidden += (text.match(/\*\*/g) || []).length;
  forbidden += (text.match(/[—–]/g) || []).length;
  if (lang === "ru") forbidden += (text.match(/ё/g) || []).length;

  // Score composition (0..100, higher = more AI)
  let score = 0;
  // Burstiness: ideal cv >= 60. cv 30 → +25 pts, cv 20 → +35 pts.
  if (cv < 60) score += Math.min(40, (60 - cv) * 0.8);
  if (cv < 60) flags.push("low_burstiness");

  // Cliché density: >2 per 1000 words is suspicious.
  if (clicheDensity > 2) score += Math.min(30, (clicheDensity - 2) * 6);
  if (clicheDensity > 2) flags.push("high_cliche_density");

  // Short sentence ratio: <0.20 is robotic.
  if (shortRatio < 0.20) score += (0.20 - shortRatio) * 80;
  if (shortRatio < 0.20) flags.push("missing_short_sentences");

  // Forbidden formatting characters.
  if (forbidden > 5) {
    score += Math.min(15, forbidden * 0.5);
    flags.push("forbidden_formatting");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    ai_score: score,
    burstiness_cv: Math.round(cv),
    cliche_count: clicheCount,
    cliche_density: Math.round(clicheDensity * 10) / 10,
    short_ratio: Math.round(shortRatio * 100) / 100,
    long_ratio: Math.round(longRatio * 100) / 100,
    forbidden_chars: forbidden,
    word_count: wc,
    flags,
  };
}

async function llmSecondOpinion(text: string, lang: "ru" | "en"): Promise<number | null> {
  const KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!KEY) return null;

  // Sample first 1500 chars to keep cost low.
  const sample = text.slice(0, 1500);
  const sys = lang === "ru"
    ? "Ты детектор ИИ-текста. Оцени текст по шкале 0..100, где 0 — точно живой человек, 100 — точно ИИ. Ответь ТОЛЬКО числом."
    : "You are an AI-text detector. Score the text 0..100, 0=clearly human, 100=clearly AI. Reply with ONLY the number.";

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: sample },
        ],
        temperature: 0.1,
        max_tokens: 10,
      }),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const txt = j?.choices?.[0]?.message?.content || "";
    const m = String(txt).match(/\d{1,3}/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return Math.max(0, Math.min(100, n));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { content, language, skip_llm } = await req.json();
    if (!content || typeof content !== "string" || content.trim().length < 50) {
      return errorResponse("content (>=50 chars) required", 400);
    }
    const lang = (language === "ru" || language === "en") ? language : detectLang(content);
    const heur = runHeuristics(content, lang);

    let llm: number | null = null;
    let final = heur.ai_score;
    if (!skip_llm && heur.word_count >= 100) {
      llm = await llmSecondOpinion(content, lang);
      if (llm !== null) {
        // Weighted blend: 60% heuristics, 40% LLM (LLM is noisier).
        final = Math.round(heur.ai_score * 0.6 + llm * 0.4);
      }
    }

    const verdict =
      final >= 70 ? "high_risk" :
      final >= 40 ? "medium_risk" : "human_like";

    return jsonResponse({
      ai_score: final,
      heuristic_score: heur.ai_score,
      llm_score: llm,
      verdict,
      language: lang,
      details: heur,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "detect-ai failed", 500);
  }
});