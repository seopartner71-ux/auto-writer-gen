// AI Content Enhancement Layer for Site Factory articles.
//
// Non-destructive: does NOT rewrite the base article. Generates
// AI Knowledge Asset blocks (Entity Block, Expert Summary, Action Framework
// / How-To steps, Checklist, Common Mistakes, FAQ expansion, GEO cues) and
// a set of quality scores (SEO / GEO / Expertise / Structure / AI Ready).
// The result is stored in `articles.ai_enhancement` (jsonb). Optionally the
// enhancement blocks are appended to `articles.content` in a fenced section
// so they show up on the deployed site.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";

const PRIMARY_MODEL = "google/gemini-2.5-pro";
const FALLBACK_MODEL = "google/gemini-2.5-flash";

interface ReqBody {
  article_id: string;
  /** Append enhancement blocks to article.content markdown. Default true. */
  append_to_content?: boolean;
}

interface Scores {
  seo_score: number;
  geo_score: number;
  expertise_score: number;
  structure_score: number;
  ai_ready_score: number;
}

interface EnhancementPayload {
  detected_format:
    | "how_to"
    | "step_by_step"
    | "checklist"
    | "comparison"
    | "faq"
    | "expert_article"
    | "commercial_guide";
  recommended_format: string;
  entity_block: {
    topic: string;
    category: string;
    main_entities: string[];
    related_concepts: string[];
    expert_terms: string[];
  };
  expert_summary: {
    verdict: string;
    audience: string;
    main_takeaway: string;
  };
  action_framework: Array<{
    step: number;
    title: string;
    what_to_do: string;
    why: string;
    common_mistakes: string;
    pro_tip: string;
  }>;
  checklist: { title: string; items: string[] };
  common_mistakes: Array<{ mistake: string; why: string; how_to_avoid: string }>;
  faq: Array<{ q: string; a: string }>;
  geo_optimization: {
    has_direct_answer: boolean;
    one_paragraph_answer: string;
    definitions_present: boolean;
    tables_present: boolean;
    structured_lists_present: boolean;
    notes: string;
  };
  scores: Scores;
}

const SYSTEM_PROMPT = `Ты — AI Content Enhancement Layer для SEO/GEO статей.
Твоя задача: НЕ переписывать статью, а СГЕНЕРИРОВАТЬ дополнительный слой
AI Knowledge Asset поверх существующего текста. Работаешь строго в JSON.

Правила:
- Определи оптимальный формат по теме и содержанию (how_to для запросов
  "как выбрать / как сделать / как установить / как проверить / как настроить
  / как купить").
- Пиши в языке исходной статьи.
- Кратко, конкретно, без "воды" и клише. Никаких обещаний вида "в этой статье
  вы узнаете".
- Никакого Markdown внутри JSON-полей, только чистый текст.
- Все оценки от 0 до 100, целые числа. ai_ready_score — интегральная,
  примерно среднее остальных с учётом полноты слоёв.
- FAQ: 5-10 вопросов, реальные пользовательские, короткие структурированные ответы.
- Action Framework: 3-8 шагов ТОЛЬКО если формат how_to / step_by_step / commercial_guide,
  иначе пустой массив.
- Common mistakes: 5-10 записей.
- Checklist: 5-15 пунктов.
`;

function buildUserPrompt(title: string, keyword: string, content: string): string {
  const trimmed = content.length > 12_000 ? content.slice(0, 12_000) + "\n\n[...truncated]" : content;
  return `Заголовок: ${title}
Ключ: ${keyword}

Текст статьи:
"""
${trimmed}
"""

Верни JSON строго по этой схеме (не добавляй лишних полей):
{
  "detected_format": "how_to|step_by_step|checklist|comparison|faq|expert_article|commercial_guide",
  "recommended_format": "string",
  "entity_block": {
    "topic": "string",
    "category": "string",
    "main_entities": ["string"],
    "related_concepts": ["string"],
    "expert_terms": ["string"]
  },
  "expert_summary": { "verdict": "string", "audience": "string", "main_takeaway": "string" },
  "action_framework": [
    { "step": 1, "title": "string", "what_to_do": "string", "why": "string",
      "common_mistakes": "string", "pro_tip": "string" }
  ],
  "checklist": { "title": "string", "items": ["string"] },
  "common_mistakes": [ { "mistake": "string", "why": "string", "how_to_avoid": "string" } ],
  "faq": [ { "q": "string", "a": "string" } ],
  "geo_optimization": {
    "has_direct_answer": true,
    "one_paragraph_answer": "string",
    "definitions_present": true,
    "tables_present": true,
    "structured_lists_present": true,
    "notes": "string"
  },
  "scores": {
    "seo_score": 0, "geo_score": 0, "expertise_score": 0,
    "structure_score": 0, "ai_ready_score": 0
  }
}`;
}

function clampScore(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function normalize(raw: any): EnhancementPayload {
  const scores = raw?.scores || {};
  return {
    detected_format: raw?.detected_format || "expert_article",
    recommended_format: String(raw?.recommended_format || raw?.detected_format || ""),
    entity_block: {
      topic: String(raw?.entity_block?.topic || ""),
      category: String(raw?.entity_block?.category || ""),
      main_entities: Array.isArray(raw?.entity_block?.main_entities) ? raw.entity_block.main_entities.map(String) : [],
      related_concepts: Array.isArray(raw?.entity_block?.related_concepts) ? raw.entity_block.related_concepts.map(String) : [],
      expert_terms: Array.isArray(raw?.entity_block?.expert_terms) ? raw.entity_block.expert_terms.map(String) : [],
    },
    expert_summary: {
      verdict: String(raw?.expert_summary?.verdict || ""),
      audience: String(raw?.expert_summary?.audience || ""),
      main_takeaway: String(raw?.expert_summary?.main_takeaway || ""),
    },
    action_framework: Array.isArray(raw?.action_framework)
      ? raw.action_framework.map((s: any, i: number) => ({
          step: Number(s?.step) || i + 1,
          title: String(s?.title || ""),
          what_to_do: String(s?.what_to_do || ""),
          why: String(s?.why || ""),
          common_mistakes: String(s?.common_mistakes || ""),
          pro_tip: String(s?.pro_tip || ""),
        }))
      : [],
    checklist: {
      title: String(raw?.checklist?.title || ""),
      items: Array.isArray(raw?.checklist?.items) ? raw.checklist.items.map(String) : [],
    },
    common_mistakes: Array.isArray(raw?.common_mistakes)
      ? raw.common_mistakes.map((m: any) => ({
          mistake: String(m?.mistake || ""),
          why: String(m?.why || ""),
          how_to_avoid: String(m?.how_to_avoid || ""),
        }))
      : [],
    faq: Array.isArray(raw?.faq)
      ? raw.faq.map((f: any) => ({ q: String(f?.q || ""), a: String(f?.a || "") })).filter((f: any) => f.q && f.a)
      : [],
    geo_optimization: {
      has_direct_answer: !!raw?.geo_optimization?.has_direct_answer,
      one_paragraph_answer: String(raw?.geo_optimization?.one_paragraph_answer || ""),
      definitions_present: !!raw?.geo_optimization?.definitions_present,
      tables_present: !!raw?.geo_optimization?.tables_present,
      structured_lists_present: !!raw?.geo_optimization?.structured_lists_present,
      notes: String(raw?.geo_optimization?.notes || ""),
    },
    scores: {
      seo_score: clampScore(scores.seo_score),
      geo_score: clampScore(scores.geo_score),
      expertise_score: clampScore(scores.expertise_score),
      structure_score: clampScore(scores.structure_score),
      ai_ready_score: clampScore(scores.ai_ready_score),
    },
  };
}

const ENHANCEMENT_MARKER = "<!-- AI_ENHANCEMENT_LAYER -->";

function renderEnhancementMarkdown(p: EnhancementPayload): string {
  const parts: string[] = [];
  parts.push(ENHANCEMENT_MARKER);
  parts.push("");
  parts.push("## Экспертное резюме");
  if (p.expert_summary.verdict) parts.push(p.expert_summary.verdict);
  if (p.expert_summary.audience) parts.push(`**Кому подходит:** ${p.expert_summary.audience}`.replace(/\*\*/g, ""));
  if (p.expert_summary.main_takeaway) parts.push(`Главный вывод: ${p.expert_summary.main_takeaway}`);
  parts.push("");

  const eb = p.entity_block;
  if (eb.topic || eb.main_entities.length) {
    parts.push("## Ключевые сущности");
    if (eb.topic) parts.push(`Тема: ${eb.topic}`);
    if (eb.category) parts.push(`Категория: ${eb.category}`);
    if (eb.main_entities.length) parts.push(`Основные сущности: ${eb.main_entities.join(", ")}`);
    if (eb.related_concepts.length) parts.push(`Связанные понятия: ${eb.related_concepts.join(", ")}`);
    if (eb.expert_terms.length) parts.push(`Экспертные термины: ${eb.expert_terms.join(", ")}`);
    parts.push("");
  }

  if (p.action_framework.length) {
    parts.push("## Пошаговая инструкция");
    for (const s of p.action_framework) {
      parts.push(`### Шаг ${s.step}. ${s.title}`);
      if (s.what_to_do) parts.push(`Что сделать: ${s.what_to_do}`);
      if (s.why) parts.push(`Зачем: ${s.why}`);
      if (s.common_mistakes) parts.push(`Типичные ошибки: ${s.common_mistakes}`);
      if (s.pro_tip) parts.push(`Совет: ${s.pro_tip}`);
      parts.push("");
    }
  }

  if (p.checklist.items.length) {
    parts.push(`## ${p.checklist.title || "Чек-лист"}`);
    for (const it of p.checklist.items) parts.push(`- ☐ ${it}`);
    parts.push("");
  }

  if (p.common_mistakes.length) {
    parts.push("## Типичные ошибки");
    for (const m of p.common_mistakes) {
      parts.push(`- ${m.mistake} - ${m.why} - ${m.how_to_avoid}`);
    }
    parts.push("");
  }

  if (p.faq.length) {
    parts.push("## Часто задаваемые вопросы");
    for (const f of p.faq) {
      parts.push(`### ${f.q}`);
      parts.push(f.a);
      parts.push("");
    }
  }

  return parts.join("\n").trim() + "\n";
}

function stripPreviousEnhancement(content: string): string {
  const idx = content.indexOf(ENHANCEMENT_MARKER);
  if (idx === -1) return content;
  return content.slice(0, idx).trimEnd() + "\n";
}

async function callModel(apiKey: string, model: string, article: any, userId: string) {
  const keyword = Array.isArray(article.keywords) ? String(article.keywords[0] || "") : "";
  return await chatJson<any>({
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(article.title || "", keyword, article.content || ""),
    temperature: 0.4,
    maxTokens: 4000,
    timeoutMs: 90_000,
    appTitle: "enhance-article-ai",
    functionName: "enhance-article-ai",
    userId,
    articleId: article.id,
    projectId: article.project_id,
  });
}

serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const body: ReqBody = await req.json();
    if (!body?.article_id) {
      return new Response(JSON.stringify({ error: "article_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appendToContent = body.append_to_content !== false;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: article, error: aErr } = await supabase
      .from("articles")
      .select("id, user_id, project_id, title, content, keywords")
      .eq("id", body.article_id)
      .maybeSingle();

    if (aErr) {
      console.error("[enhance-article-ai] article lookup failed", aErr);
      return new Response(JSON.stringify({ error: aErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!article) {
      return new Response(JSON.stringify({ error: "article not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (article.user_id !== userId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!article.content || article.content.trim().length < 200) {
      return new Response(JSON.stringify({ error: "article content too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let jsonRes: any;
    try {
      jsonRes = await callModel(apiKey, PRIMARY_MODEL, article, userId);
    } catch (e) {
      if (e instanceof AiError && (e.retryable || e.kind === "parse_failed")) {
        console.warn("[enhance-article-ai] primary failed, trying fallback", e.kind, e.message);
        jsonRes = await callModel(apiKey, FALLBACK_MODEL, article, userId);
      } else {
        throw e;
      }
    }

    const payload = normalize(jsonRes.data);

    const enhancedAt = new Date().toISOString();
    const update: Record<string, unknown> = {
      ai_enhancement: { ...payload, model: jsonRes.model, enhanced_at: enhancedAt, version: 1 },
    };

    if (appendToContent) {
      const base = stripPreviousEnhancement(article.content);
      const block = renderEnhancementMarkdown(payload);
      update.content = `${base}\n\n${block}`;
    }

    const { error: upErr } = await supabase.from("articles").update(update).eq("id", article.id);
    if (upErr) {
      console.error("[enhance-article-ai] update failed", upErr);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, scores: payload.scores, detected_format: payload.detected_format, appended: appendToContent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[enhance-article-ai] error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});