// Auto-improve article based on quality flags: rewrite-pass for low ai_score,
// keyword density fix (overuse/underuse), burstiness fix (split long sentences,
// shorten consecutive same-length runs).
//
// Body: { article_id: string }
// Returns: { ok: true } and re-triggers quality-check auto-mode in background.

import { verifyAuth } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chatComplete, AiError } from "../_shared/aiClient.ts";
import { logPipelineEvent, startTimer } from "../_shared/pipelineLogger.ts";
import { getPlanLimit, IMPROVE_LIMITS, normalizePlanKey } from "../_shared/planLimits.ts";
import { analyzeSentenceStructure, buildSentenceStructureFixHint } from "../_shared/sentenceStructure.ts";
import { analyzeCancellary, buildCancellaryFixHint } from "../_shared/validators/cancellaryGuard.ts";
import { analyzeKeywordFrequency, buildKeywordFrequencyFixHint } from "../_shared/validators/keywordFrequencyGuard.ts";
import { analyzeDanglingThoughts, buildDanglingFixHint } from "../_shared/validators/danglingThoughtGuard.ts";
import {
  getStyleProfile,
  sentenceOptionsFromStyleProfile,
  keywordOptionsFromStyleProfile,
  cancellaryOptionsFromStyleProfile,
  type StyleProfile,
} from "../_shared/styleProfile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Count critical structural HTML elements to detect rewrite damage.
function countTags(html: string): { h: number; a: number; p: number; li: number; table: number; words: number } {
  return {
    h: (html.match(/<h[1-6][\s>]/gi) || []).length,
    a: (html.match(/<a\s[^>]*href=/gi) || []).length,
    p: (html.match(/<p[\s>]/gi) || []).length,
    li: (html.match(/<li[\s>]/gi) || []).length,
    table: (html.match(/<table[\s>]/gi) || []).length,
    words: stripHtml(html).split(/\s+/).filter(Boolean).length,
  };
}

// Returns true if the rewritten HTML preserves structure (within tolerance).
function htmlIntegrityOk(before: string, after: string): { ok: boolean; reason?: string } {
  const b = countTags(before);
  const a = countTags(after);
  if (a.words < b.words * 0.6) return { ok: false, reason: `words shrunk ${b.words}->${a.words}` };
  if (a.words > b.words * 1.6) return { ok: false, reason: `words inflated ${b.words}->${a.words}` };
  if (a.h < b.h) return { ok: false, reason: `headings lost ${b.h}->${a.h}` };
  if (a.a < b.a) return { ok: false, reason: `links lost ${b.a}->${a.a}` };
  if (a.table < b.table) return { ok: false, reason: `tables lost ${b.table}->${a.table}` };
  return { ok: true };
}

// Remove every Nth occurrence of keyword (default every 3rd) from HTML, preserving tags.
function removeEveryNthKeyword(html: string, keyword: string, n = 3): string {
  if (!keyword) return html;
  const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  let i = 0;
  return html.replace(re, (m) => {
    i++;
    return i % n === 0 ? "" : m;
  });
}

// Split sentences longer than 30 words by comma or conjunction.
function splitLongSentences(text: string): string {
  return text.replace(/([^.!?]{120,}?[.!?])/g, (chunk) => {
    const words = chunk.trim().split(/\s+/);
    if (words.length < 30) return chunk;
    // try split at first comma or ' и ' / ' но ' / ' а ' after word 12
    const idx = words.findIndex((w, i) =>
      i > 10 && (/,$/.test(w) || /^(и|но|а|или|однако|причем|тогда)$/i.test(w))
    );
    if (idx === -1 || idx >= words.length - 5) return chunk;
    const first = words.slice(0, idx + 1).join(" ").replace(/,?$/, ".");
    const rest = words.slice(idx + 1).join(" ");
    return `${first} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  });
}

async function callOpenRouterEx(
  model: string, system: string, user: string, key: string, maxTokens = 8000, timeoutMs = 120_000,
): Promise<{ content: string | null; error?: string; duration_ms: number }> {
  const t0 = Date.now();
  try {
    const r = await chatComplete({
      apiKey: key, model, system, user,
      maxTokens, temperature: 0.85, timeoutMs,
      appTitle: "SEO-Modul improve-article",
    });
    const content = r.content || null;
    const duration_ms = Date.now() - t0;
    if (!content) return { content: null, error: "empty_content", duration_ms };
    return { content, duration_ms };
  } catch (e) {
    const duration_ms = Date.now() - t0;
    const msg = (e as Error)?.message || String(e);
    console.error("[improve-article] OR exception", model, msg);
    let kind = "exception";
    if (/timeout|timed out|aborted/i.test(msg)) kind = "timeout";
    else if (/402/.test(msg)) kind = "http_402_credits";
    else if (/429/.test(msg)) kind = "http_429_rate_limit";
    else if (/5\d\d/.test(msg)) kind = "http_5xx";
    else if (/4\d\d/.test(msg)) kind = "http_4xx";
    return { content: null, error: `${kind}: ${msg.slice(0, 200)}`, duration_ms };
  }
}
async function callOpenRouter(model: string, system: string, user: string, key: string, maxTokens = 8000): Promise<string | null> {
  const r = await callOpenRouterEx(model, system, user, key, maxTokens);
  return r.content;
}

async function callGateway(model: string, system: string, user: string, key: string): Promise<string | null> {
  try {
    const r = await chatComplete({
      apiKey: key, model, system, user, timeoutMs: 120_000,
      appTitle: "SEO-Modul improve-article",
    });
    return r.content || null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const elapsed = startTimer();
  let logCtx: { user_id?: string; article_id?: string; phase?: string } = {};
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("OPENROUTER_API_KEY");
    const orKey = Deno.env.get("OPENROUTER_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as any));
    const { article_id, fix_type, user_id: bodyUserId, source } = body || {};

    // Internal service-role invocation (e.g. quality-check auto-turgenev-fix).
    const isServiceCall =
      authHeader === `Bearer ${serviceKey}` && typeof bodyUserId === "string" && bodyUserId.length > 0;
    const isAutoTurgenev = isServiceCall && source === "auto_turgenev";
    const isAutoSentence = isServiceCall && source === "auto_sentence_structure";
    const isAutoDangling = isServiceCall && source === "auto_dangling";
    const isAutoCancellary = isServiceCall && source === "auto_cancellary";
    const isAutoKwFreq = isServiceCall && source === "auto_keyword_freq";
    const bypassLimits = isAutoTurgenev || isAutoSentence || isAutoDangling || isAutoCancellary || isAutoKwFreq;

    let user: { id: string } | null = null;
    if (isServiceCall) {
      user = { id: bodyUserId };
    } else {
      const __auth = await verifyAuth(req);
      if (__auth instanceof Response) return __auth;
      user = { id: __auth.userId };
    }
    if (!user) return json({ error: "Unauthorized" }, 401);

    if (!article_id) return json({ error: "article_id required" }, 400);
    const phase: "humanize" | "turgenev" | "sentence" | "dangling" | "cancellary" | "keyword_freq" | "all" =
      fix_type === "humanize" ? "humanize" :
      fix_type === "turgenev" ? "turgenev" :
      fix_type === "sentence_structure" ? "sentence" :
      fix_type === "dangling" ? "dangling" :
      fix_type === "cancellary" ? "cancellary" :
      fix_type === "keyword_freq" ? "keyword_freq" : "all";
    logCtx = { user_id: user.id, article_id, phase };

    const { data: art } = await admin.from("articles")
      .select("id,user_id,content,title,keyword_id,keywords,ai_score,burstiness_status,keyword_density_status,keyword_density,last_improve_at,turgenev_status,language,seo_improve_count,author_profile_id,quality_details,quality_status")
      .eq("id", article_id).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Article not found" }, 404);

    const initialContent: string = art.content || "";
    if (!initialContent) return json({ error: "Article has no content" }, 400);
    const originalAiScore = art.ai_score;

    // Prevent overlapping runs on the same article.
    if ((art as any).quality_status === "improving") {
      return json({
        ok: false,
        already_running: true,
        message: "Улучшение уже выполняется, дождитесь завершения",
      }, 202);
    }

    const { data: pProfile } = await admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();
    const planRaw = (pProfile as any)?.plan ?? null;
    const improveLimit = getPlanLimit(planRaw, IMPROVE_LIMITS);
    const usedImprove = Number((art as any).seo_improve_count || 0);
    console.log("[improve-article][plan-check] user:", user.id, "plan:", planRaw, "key:", normalizePlanKey(planRaw), "limit:", improveLimit, "used:", usedImprove);
    if (!bypassLimits && usedImprove >= improveLimit) {
      return json({
        ok: false,
        limit_reached: true,
        error: `Лимит улучшений для вашего плана исчерпан (${improveLimit}). Обновите тариф для продолжения.`,
      }, 429);
    }

    // ── Cooldown: 60s between improve calls per article ──
    if (!bypassLimits && art.last_improve_at) {
      const elapsedCd = Date.now() - new Date(art.last_improve_at as string).getTime();
      if (elapsedCd < 60_000) {
        return json({
          ok: false,
          cooldown: true,
          retry_after: Math.ceil((60_000 - elapsedCd) / 1000),
          message: `Подождите ${Math.ceil((60_000 - elapsedCd) / 1000)} сек. перед повторной доработкой`,
        });
      }
    }

    // Snapshot BEFORE any change so user can rollback
    try {
      await admin.from("article_versions").insert({
        article_id,
        user_id: user.id,
        title: art.title ?? null,
        content: initialContent,
        reason: "auto_improve_before",
        word_count: stripHtml(initialContent).split(/\s+/).filter(Boolean).length,
        metadata: { ai_score_before: originalAiScore },
      } as any);
    } catch (e) {
      console.warn("[improve-article] snapshot failed", e);
    }
    // Mark as "improving" and record cooldown timestamp synchronously so the
    // client can start polling immediately and the cooldown gate holds.
    await admin.from("articles").update({
      last_improve_at: new Date().toISOString(),
      quality_status: "improving",
    }).eq("id", article_id);

    // Kick off all LLM work in the background — LLM passes are far longer than
    // the edge-function response deadline. Client polls quality_status.
    const bg = runImprovePipeline({
      admin, supabaseUrl, article_id, user, phase, art,
      initialContent, primaryKeywordSeed: null, orKey, lovableKey,
      authHeader, elapsed, source, bypassLimits,
    });
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg); } catch { void bg; }

    return json({ ok: true, accepted: true, async: true }, 202);
  } catch (e: any) {
    console.error("[improve-article] fatal", e);
    logPipelineEvent({
      stage: "improve",
      user_id: logCtx.user_id,
      article_id: logCtx.article_id,
      verdict: "fail",
      duration_ms: elapsed(),
      error_kind: e instanceof AiError ? e.kind : "upstream",
      error_message: e?.message,
      meta: { phase: logCtx.phase },
    });
    return json({ error: e?.message || "Unknown error" }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Background pipeline — runs the actual LLM passes and writes the result.
// Mirrors the previous synchronous body; on completion clears
// quality_status='improving' and either kicks off quality-check ("checking")
// or records an error in quality_details.improve_error.
// ──────────────────────────────────────────────────────────────────────
interface PipelineArgs {
  admin: ReturnType<typeof createClient>;
  supabaseUrl: string;
  article_id: string;
  user: { id: string };
  phase: "humanize" | "turgenev" | "sentence" | "dangling" | "cancellary" | "keyword_freq" | "all";
  art: any;
  initialContent: string;
  primaryKeywordSeed: string | null;
  orKey: string | undefined;
  lovableKey: string | undefined;
  authHeader: string;
  elapsed: () => number;
  source: string | undefined;
  bypassLimits: boolean;
}

async function runImprovePipeline(args: PipelineArgs): Promise<void> {
  const { admin, supabaseUrl, article_id, user, phase, art, orKey, lovableKey, authHeader, elapsed, source, bypassLimits } = args;
  let content = args.initialContent;
  // ── Observability trace: per-pass metrics, prompt blocks, integrity verdicts.
  // Written to pipeline_events.meta.prompt_trace at the end and mirrored in
  // articles.quality_details.improve_last. Does NOT influence any decision.
  type PassTrace = {
    step: string;
    model: string;
    blocks?: Record<string, unknown>;
    metrics_before: ReturnType<typeof metricsOf>;
    metrics_llm: ReturnType<typeof metricsOf> | null;
    integrity: { ok: boolean; reason?: string } | null;
    applied: boolean;
    llm_bytes: number;
    llm_null: boolean;
    prompt: { system: string; user: string; user_bytes: number } | null;
  };
  const trace: PassTrace[] = [];
  const integrityRejections: Array<{ step: string; reason: string; metrics_llm: any; metrics_before: any }> = [];

  function metricsOf(html: string) {
    try {
      const m = analyzeSentenceStructure(stripHtml(html));
      return {
        sents: m.sentenceCount,
        avg: m.avgWords,
        max_short_run: m.maxShortRun,
        short_ratio: m.shortRatio,
        bytes: html.length,
      };
    } catch {
      return { sents: 0, avg: 0, max_short_run: 0, short_ratio: 0, bytes: html.length };
    }
  }

  // Wraps trace push + integrity-rejection pipeline event. Called AFTER the
  // caller has already made its accept/reject decision (behaviour untouched).
  function recordPass(entry: PassTrace) {
    trace.push(entry);
    if (entry.integrity && !entry.integrity.ok) {
      integrityRejections.push({
        step: entry.step,
        reason: entry.integrity.reason || "unknown",
        metrics_llm: entry.metrics_llm,
        metrics_before: entry.metrics_before,
      });
      logPipelineEvent({
        stage: "improve",
        user_id: user.id,
        article_id,
        verdict: "warning",
        duration_ms: elapsed(),
        meta: {
          event: "integrity_rejected",
          step: entry.step,
          model: entry.model,
          reason: entry.integrity.reason,
          metrics_before: entry.metrics_before,
          metrics_llm: entry.metrics_llm,
          phase,
          source: source ?? null,
        },
      });
    }
  }

  const metricsInitial = metricsOf(content);

  try {
    // Determine primary keyword
    let primaryKeyword = "";
    if (art.keyword_id) {
      const { data: kw } = await admin.from("keywords").select("seed_keyword").eq("id", art.keyword_id).maybeSingle();
      primaryKeyword = String(kw?.seed_keyword || "");
    }
    if (!primaryKeyword && Array.isArray(art.keywords) && art.keywords.length) {
      primaryKeyword = String(art.keywords[0]);
    }

    const aiScore = Number(art.ai_score ?? 100);
    const burstStatus = String(art.burstiness_status || "ok");
    const dStatus = String(art.keyword_density_status || "ok");

    // ── Validator context: read prior quality-check verdicts so the humanize
    // pass gets CONCRETE tasks (e.g. "lengthen sentences") instead of blindly
    // chopping. Prevents the improve-loop from making the same defect worse.
    const validators = ((art as any).quality_details?.validators ?? {}) as Record<string, any>;
    const vSentence = validators.sentence_structure ?? null;
    const vCancellary = validators.cancellary ?? null;
    const vDangling = validators.dangling_thoughts ?? null;
    const vKwFreq = validators.keyword_frequency ?? null;

    // Detect "sentences too short" specifically — the exact failure mode that
    // triggers over-chopping. Signals:  avg_words < 10 OR max_short_run >= 4
    // OR any issue text mentions "коротк" / "short" / "ниже нормы".
    const sentenceIssuesText = Array.isArray(vSentence?.issues) ? vSentence.issues.join(" | ") : "";
    const sentenceTooShort =
      vSentence?.verdict === "fail" &&
      (
        (typeof vSentence?.avg_words === "number" && vSentence.avg_words < 10) ||
        (typeof vSentence?.max_short_run === "number" && vSentence.max_short_run >= 4) ||
        /коротк|ниже нормы|short/i.test(sentenceIssuesText)
      );

    // Build a plain-text "прошлые проверки нашли" block for the LLM.
    const validatorTasks: string[] = [];
    if (vSentence?.verdict === "fail" && Array.isArray(vSentence.issues) && vSentence.issues.length) {
      const action = sentenceTooShort
        ? "УДЛИНЯЙ и СКЛЕИВАЙ короткие предложения — но чередуй способы: двоеточие, тире, причастный оборот, соседние предложения без связки. Связки-костыли (поскольку, при этом, так как, тогда как, поэтому) — не более 2 раз на весь текст каждая."
        : "Выровняй ритм — избегай серий одинаковой длины.";
      validatorTasks.push(`Структура предложений (${action})\n  - ${vSentence.issues.join("\n  - ")}`);
    }
    if (vCancellary?.verdict === "fail" && Array.isArray(vCancellary.issues) && vCancellary.issues.length) {
      validatorTasks.push(`Канцелярит и штампы (заменяй конкретикой, не выкидывай слова механически)\n  - ${vCancellary.issues.slice(0, 8).join("\n  - ")}`);
    }
    if (vDangling?.verdict === "fail" && Array.isArray(vDangling.issues) && vDangling.issues.length) {
      validatorTasks.push(`Оборванные мысли (допиши логическое завершение, не обрывай на "и", "но", "поэтому")\n  - ${vDangling.issues.slice(0, 6).join("\n  - ")}`);
    }
    if (vKwFreq?.verdict === "fail" && Array.isArray(vKwFreq.issues) && vKwFreq.issues.length) {
      validatorTasks.push(`Частотность слов (используй синонимы, местоимения, перестройку фразы)\n  - ${vKwFreq.issues.slice(0, 6).join("\n  - ")}`);
    }
    const validatorContextBlock = validatorTasks.length
      ? `\n\nПРОШЛАЯ ПРОВЕРКА КАЧЕСТВА НАШЛА КОНКРЕТНЫЕ ПРОБЛЕМЫ — ИСПРАВЬ ИХ ПРИЦЕЛЬНО:\n${validatorTasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nЭто приоритетные задачи текущего прохода. Не создавай новых дефектов того же класса.\n`
      : "";

    // Rhythm block for the humanize pass. If sentenceTooShort — instruct to
    // LENGTHEN, not chop; otherwise use the standard cadence rules.
    // Shared rules for BOTH modes: cap connectors, vary joins, vary paragraph openings.
    const rhythmSharedRules = `
ЛИМИТЫ НА СВЯЗКИ (жёстко, считай по всему тексту):
- "поскольку" — не более 2 раз на весь текст.
- "при этом" — не более 2 раз.
- "тогда как" — не более 2 раз.
- "так как" — не более 2 раз.
- "поэтому" — не более 2 раз.
Если нужно соединить мысли — чередуй способы: двоеточие, тире, причастный/деепричастный оборот, соседние предложения БЕЗ связки, вопрос → ответ. Одна и та же схема соединения не должна повторяться в двух соседних абзацах.

РАСПРЕДЕЛЕНИЕ ДЛИН (в каждой секции H2/H3):
- 1-2 коротких предложения-акцента (до 8 слов).
- Основная масса — 12-18 слов.
- 1-2 длинных предложения (22-30 слов).
- Запрещены серии из 3+ коротких подряд.
- Запрещены серии из 4+ длинных подряд.
- Ни одно предложение не длиннее 30 слов.

РАЗНООБРАЗИЕ АБЗАЦЕВ:
- Запрещено начинать более 2 абзацев подряд с утверждения, содержащего цифры/проценты/года.
- Чередуй заходы абзацев: вопрос к читателю, пример из практики, возражение/сомнение, короткий тезис, наблюдение, сценарий "если … то".
- Одна и та же схема абзаца ("утверждение → связка → причина") не должна встречаться подряд более 2 раз.

ЗАГОЛОВКИ (H2/H3/H4) — НЕ ТРОГАТЬ:
- Текст заголовков, порядок слов и регистр букв оставляй как есть (первая буква — заглавная, имена собственные — с заглавной).
- НЕ приводи заголовки к нижнему регистру, НЕ переписывай их в вопрос/тезис, НЕ добавляй туда разговорные вставки.
- Все правила ритма, длин, связок и разнообразия применяются ТОЛЬКО к тексту абзацев и пунктам списков, НЕ к строкам заголовков.`;

    const rhythmBlock = sentenceTooShort
      ? `РИТМ (текст уже перерублен — СКЛЕИВАЙ, НЕ ДРОБИ; но не превращай в поток однотипных связок):
- Средняя длина предложения 14-18 слов.
- Короткие (до 8 слов) — редкий акцент, не более 1 подряд, не чаще 1 на 4-5 предложений.
- Категорически запрещено 2+ коротких предложения подряд.
- Каждая мысль развёрнута до законченного суждения (подлежащее + сказуемое + пояснение/причина/следствие).
${rhythmSharedRules}`
      : `РИТМ (жёсткие рамки):
- Средняя длина предложения 12-16 слов.
- Короткие предложения (до 8 слов) — инструмент акцента, а не основной ритм.
- После 1-2 коротких подряд ОБЯЗАТЕЛЬНО идёт длинное (18+ слов).
- Запрет более 2 коротких предложений подряд.
${rhythmSharedRules}`;

    // Resolve StyleProfile for this article (same source-of-truth as quality-check).
    let styleProfile: StyleProfile = getStyleProfile(null);
    if ((art as any).author_profile_id) {
      try {
        const { data: author } = await admin.from("author_profiles")
          .select("style_analysis").eq("id", (art as any).author_profile_id).maybeSingle();
        const preset = (author?.style_analysis as any)?.syntax_profile;
        styleProfile = getStyleProfile(preset);
      } catch (_) { /* keep default */ }
    }

    // 1) Rewrite-pass when ai_score is too low (looks AI-ish)
    if ((phase === "humanize" || phase === "all") && aiScore < 70 && (orKey || lovableKey)) {
      const sys = "Ты редактор-человек. Переписываешь HTML-контент сохраняя ВСЕ факты, цифры, бренды, ссылки, теги. Возвращаешь только итоговый HTML без markdown-обёрток.";
      const usr = `Перепиши текст так, чтобы он одновременно прошёл AI-детектор И Тургенев (Баден-Баден).
${validatorContextBlock}
${rhythmBlock}

ЦЕЛЬ AI-детектор:
- Живой ритм в рамках правил выше — НЕ телеграфный стиль.
- Разговорные вставки: "на практике", "вот что важно", "и тут начинается интересное" — точечно, а не в каждом абзаце.
- Разнообразие начал абзацев.

ЦЕЛЬ Тургенев (НЕ нарушать при гуманизации):
- Не использовать канцелярит: "является", "осуществляет", "в целях", "в рамках", "на сегодняшний день", "в настоящее время".
- Не использовать воду: "следует отметить", "стоит сказать", "как известно", "не секрет что".
- Если фраза длиннее 4 слов повторяется более 2 раз - перефразируй.

Не меняй факты, цифры, бренды. Сохрани все HTML-теги (<h2>, <h3>, <p>, <ul>, <table>, <a>).

HTML:
${content}`;
      let rewritten: string | null = null;
      const humanizeBefore = metricsOf(content);
      const humanizeBlocks = {
        validators: validatorTasks.length > 0,
        validator_task_count: validatorTasks.length,
        rhythm: sentenceTooShort ? "lengthen" : "normal",
        opus_micro_pass_planned: aiScore < 40 && !!orKey,
        sentence_too_short: sentenceTooShort,
        ai_score_at_entry: aiScore,
      };
      let humanizeModel = orKey ? "anthropic/claude-sonnet-4" : "google/gemini-2.5-pro";
      let humanizeLlmError: string | undefined;
      let humanizeDurationMs = 0;
      if (orKey) {
        const r = await callOpenRouterEx("anthropic/claude-sonnet-4", sys, usr, orKey, 12000, 90_000);
        rewritten = r.content;
        humanizeLlmError = r.error;
        humanizeDurationMs = r.duration_ms;
      }
      if (!rewritten && lovableKey) {
        humanizeModel = "google/gemini-2.5-pro";
        rewritten = await callGateway("google/gemini-2.5-pro", sys, usr, lovableKey);
        if (!rewritten && !humanizeLlmError) humanizeLlmError = "gemini_fallback_empty";
      }
      let humanizeApplied = false;
      let humanizeIntegrity: { ok: boolean; reason?: string } | null = null;
      let humanizeCandidateMetrics: ReturnType<typeof metricsOf> | null = null;
      if (rewritten && rewritten.length > 200) {
        // Strip stray markdown code fences
        const candidate = rewritten.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
        humanizeCandidateMetrics = metricsOf(candidate);
        const integrity = htmlIntegrityOk(content, candidate);
        humanizeIntegrity = integrity;
        if (integrity.ok) {
          content = candidate;
          humanizeApplied = true;
        } else {
          console.warn("[improve-article] rewrite rejected:", integrity.reason);
        }
      }
      recordPass({
        step: "humanize.sonnet",
        model: humanizeModel,
        blocks: humanizeBlocks,
        metrics_before: humanizeBefore,
        metrics_llm: humanizeCandidateMetrics,
        integrity: humanizeIntegrity,
        applied: humanizeApplied,
        llm_bytes: rewritten ? rewritten.length : 0,
        llm_null: !rewritten,
        llm_null_reason: !rewritten ? (humanizeLlmError || "unknown") : null,
        llm_duration_ms: humanizeDurationMs,
        prompt: { system: sys, user: usr, user_bytes: usr.length },
      });

      // 1b) Severe AI-detected (ai_score < 40) → run a second Opus micro-pass
      // for "AI fingerprints" removal. Best-effort with HTML integrity guard.
      if (aiScore < 40 && orKey) {
        const sysOpus = "Ты редактор-человек. Делаешь микро-проход по HTML: убираешь монотонность синтаксиса, одинаковые начала абзацев, лексические всплески. Сохраняешь ВСЕ HTML-теги, факты, цифры, ссылки. Возвращаешь только итоговый HTML без markdown-обёрток.";
        const usrOpus = `Микро-проход: убери оставшиеся "ИИ-подписи" — монотонность синтаксиса, одинаковые зачины абзацев, лексические всплески. Цель: AI-детектор <30%. НЕ трогай факты, цифры, ссылки, теги (<h2>,<h3>,<p>,<ul>,<table>,<a>).
${validatorContextBlock}
${rhythmBlock}

ВАЖНО: не превращай текст в набор коротких рубленых фраз ради «живости» — соблюдай рамки ритма выше.

HTML:
${content}`;
        const opusBefore = metricsOf(content);
        // Opus can take 40-90s. Give it real head-room; log the exact reason on failure.
        const opusRes = await callOpenRouterEx("anthropic/claude-opus-4", sysOpus, usrOpus, orKey, 6000, 90_000);
        const polished = opusRes.content;
        const opusLlmError = opusRes.error;
        const opusDurationMs = opusRes.duration_ms;
        let opusApplied = false;
        let opusIntegrity: { ok: boolean; reason?: string } | null = null;
        let opusCandidateMetrics: ReturnType<typeof metricsOf> | null = null;
        if (polished && polished.length > 200) {
          const cand2 = polished.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
          opusCandidateMetrics = metricsOf(cand2);
          const integrity2 = htmlIntegrityOk(content, cand2);
          opusIntegrity = integrity2;
          if (integrity2.ok) {
            content = cand2;
            opusApplied = true;
          } else {
            console.warn("[improve-article] opus pass rejected:", integrity2.reason);
          }
        }
        // Fallback to Sonnet if Opus returned nothing — micro-polish is still valuable.
        let opusFallbackUsed: string | undefined;
        if (!polished) {
          const fb = await callOpenRouterEx("anthropic/claude-sonnet-4", sysOpus, usrOpus, orKey, 6000, 60_000);
          if (fb.content && fb.content.length > 200) {
            const cand3 = fb.content.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
            const int3 = htmlIntegrityOk(content, cand3);
            opusCandidateMetrics = metricsOf(cand3);
            opusIntegrity = int3;
            if (int3.ok) {
              content = cand3;
              opusApplied = true;
              opusFallbackUsed = "sonnet_fallback";
            }
          } else {
            opusFallbackUsed = fb.error || "sonnet_fallback_empty";
          }
        }
        recordPass({
          step: "humanize.opus",
          model: "anthropic/claude-opus-4",
          blocks: {
            validators: validatorTasks.length > 0,
            rhythm: sentenceTooShort ? "lengthen" : "normal",
            opus_micro_pass: true,
            fallback: opusFallbackUsed || null,
          },
          metrics_before: opusBefore,
          metrics_llm: opusCandidateMetrics,
          integrity: opusIntegrity,
          applied: opusApplied,
          llm_bytes: polished ? polished.length : 0,
          llm_null: !polished,
          llm_null_reason: !polished ? (opusLlmError || "unknown") : null,
          llm_duration_ms: opusDurationMs,
          prompt: { system: sysOpus, user: usrOpus, user_bytes: usrOpus.length },
        });
      }
    }

    // 2) Keyword density: overuse → remove every 3rd; underuse → ask LLM to insert 2-3 times
    if ((phase === "humanize" || phase === "all") && primaryKeyword && dStatus === "overuse") {
      content = removeEveryNthKeyword(content, primaryKeyword, 3);
    } else if ((phase === "humanize" || phase === "all") && primaryKeyword && dStatus === "underuse" && (orKey || lovableKey)) {
      const sys = "Ты редактор. Вставляешь фразу в текст органично. Возвращаешь только итоговый HTML.";
      const usr = `Вставь фразу "${primaryKeyword}" органично в 2-3 места текста где это звучит естественно. Не меняй факты. Сохрани все HTML-теги. Верни только исправленный HTML.

HTML:
${content}`;
      const before = metricsOf(content);
      let added: string | null = null;
      let usedModel = "google/gemini-2.5-flash";
      if (lovableKey) added = await callGateway("google/gemini-2.5-flash", sys, usr, lovableKey);
      if (!added && orKey) added = await callOpenRouter("google/gemini-2.5-flash", sys, usr, orKey);
      let applied = false;
      let integrityRes: { ok: boolean; reason?: string } | null = null;
      let candMetrics: ReturnType<typeof metricsOf> | null = null;
      if (added && added.length > 200) {
        const candidate = added.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
        candMetrics = metricsOf(candidate);
        const integrity = htmlIntegrityOk(content, candidate);
        integrityRes = integrity;
        if (integrity.ok) { content = candidate; applied = true; }
        else console.warn("[improve-article] density-fix rejected:", integrity.reason);
      }
      recordPass({
        step: "keyword_density.underuse",
        model: usedModel,
        blocks: { primary_keyword: primaryKeyword, density_status: dStatus },
        metrics_before: before,
        metrics_llm: candMetrics,
        integrity: integrityRes,
        applied,
        llm_bytes: added ? added.length : 0,
        llm_null: !added,
        prompt: { system: sys, user: usr, user_bytes: usr.length },
      });
    }

    // 3) Burstiness fix: split long sentences (JS post-processor)
    if ((phase === "humanize" || phase === "all") && (burstStatus === "fail" || burstStatus === "warning")) {
      // Apply only to text inside <p>/<li> blocks
      content = content.replace(/(<(?:p|li)[^>]*>)([\s\S]*?)(<\/(?:p|li)>)/gi, (_m, open, inner, close) => {
        return `${open}${splitLongSentences(inner)}${close}`;
      });
    }

    // 4) Turgenev (Yandex Baden-Baden) fix when status = fail (RU only, needs OpenRouter)
    const turgStatus = String((art as any).turgenev_status || "ok");
    const isRu = String((art as any).language || "ru").toLowerCase() === "ru";
    if ((phase === "turgenev" || phase === "all") && turgStatus === "fail" && isRu && orKey) {
      const sys = "Ты редактор. Улучшаешь текст под Яндекс Баден-Баден, но СОХРАНЯЕШЬ человечность стиля. Возвращай ТОЛЬКО исправленный HTML без комментариев и markdown-обёрток.";
      const usr = `Снизь риск фильтра Баден-Баден, НЕ ухудшая человечность текста.

ИСПРАВИТЬ:
1. Фразы длиннее 4 слов, повторяющиеся >2 раз - перефразируй каждое повторение по-разному.
2. Убери канцеляризмы: "является", "осуществляет", "в целях", "в рамках", "на сегодняшний день", "в настоящее время".
3. Убери воду: "следует отметить", "стоит сказать", "как известно", "не секрет что".
4. Предложения длиннее 30 слов - разбей на два.

СОХРАНИТЬ (чтобы не вырос AI-детектор):
- Чередование коротких (3-6 слов) и средних (15-25 слов) предложений - НЕ выравнивай длину.
- Разговорные вставки и личные конструкции - оставь.
- Разнообразие начал абзацев - не делай шаблонные зачины.
- НЕ заменяй живые формулировки на сухие ради краткости.

Сохрани факты, цифры, H2/H3, таблицы, FAQ и HTML-структуру.

Текст:
${content}`;
      const before = metricsOf(content);
      const fixed = await callOpenRouter("anthropic/claude-sonnet-4", sys, usr, orKey, 12000);
      let applied = false;
      let integrityRes: { ok: boolean; reason?: string } | null = null;
      let candMetrics: ReturnType<typeof metricsOf> | null = null;
      if (fixed && fixed.length > 200) {
        const candidate = fixed.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
        candMetrics = metricsOf(candidate);
        const integrity = htmlIntegrityOk(content, candidate);
        integrityRes = integrity;
        if (integrity.ok) { content = candidate; applied = true; }
        else console.warn("[improve-article] turgenev-fix rejected:", integrity.reason);
      }
      recordPass({
        step: "turgenev",
        model: "anthropic/claude-sonnet-4",
        blocks: { turgenev_status: turgStatus },
        metrics_before: before,
        metrics_llm: candMetrics,
        integrity: integrityRes,
        applied,
        llm_bytes: fixed ? fixed.length : 0,
        llm_null: !fixed,
        prompt: { system: sys, user: usr, user_bytes: usr.length },
      });
    }

    // 5) Sentence-structure fix: чиним «телеграфный» стиль —
    //    серии 3+ коротких подряд, низкая средняя длина, перекос коротких.
    if ((phase === "sentence" || phase === "all") && orKey) {
      const metrics = analyzeSentenceStructure(stripHtml(content), sentenceOptionsFromStyleProfile(styleProfile));
      if (metrics.verdict === "fail") {
        const hint = buildSentenceStructureFixHint(metrics) || "";
        const sys = "Ты редактор-человек. Переписываешь абзацы HTML так, чтобы предложения были связными и завершёнными. Сохраняешь ВСЕ HTML-теги, факты, цифры, ссылки. Возвращаешь только итоговый HTML без markdown-обёрток.";
        const usr = `Перепиши текст, исправив структуру предложений.

${hint}

ТРЕБОВАНИЯ:
- Средняя длина предложения 18-30 слов.
- Не более 1 короткого предложения подряд как акцент.
- Соединяй связанные мысли через "поскольку", "при этом", "хотя", "однако", "так как".
- Каждое предложение должно быть завершённым, без обрывов на "и", "но", "поэтому".
- НЕ выравнивай длину механически: чередуй средние (15-22) и длинные (22-30).
- Не меняй факты, цифры, бренды, ссылки. Сохрани все HTML-теги (<h2>, <h3>, <p>, <ul>, <li>, <table>, <a>).

HTML:
${content}`;
        const before = metricsOf(content);
        const fixed = await callOpenRouter("anthropic/claude-sonnet-4", sys, usr, orKey, 12000);
        let applied = false;
        let integrityRes: { ok: boolean; reason?: string } | null = null;
        let candMetrics: ReturnType<typeof metricsOf> | null = null;
        if (fixed && fixed.length > 200) {
          const candidate = fixed.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
          candMetrics = metricsOf(candidate);
          const integrity = htmlIntegrityOk(content, candidate);
          integrityRes = integrity;
          if (integrity.ok) { content = candidate; applied = true; }
          else console.warn("[improve-article] sentence-fix rejected:", integrity.reason);
        }
        recordPass({
          step: "sentence",
          model: "anthropic/claude-sonnet-4",
          blocks: { verdict_before: metrics.verdict, avg_before: metrics.avgWords, max_short_run_before: metrics.maxShortRun },
          metrics_before: before,
          metrics_llm: candMetrics,
          integrity: integrityRes,
          applied,
          llm_bytes: fixed ? fixed.length : 0,
          llm_null: !fixed,
          prompt: { system: sys, user: usr, user_bytes: usr.length },
        });
      }
    }

    // 6) Dangling thoughts: висящие союзы и обрывы абзацев без терминатора.
    if ((phase === "dangling" || phase === "all") && orKey) {
      const metrics = analyzeDanglingThoughts(content);
      if (metrics.verdict === "fail") {
        const hint = buildDanglingFixHint(metrics) || "";
        const sys = "Ты редактор. Закрываешь оборванные мысли в HTML, сохраняя ВСЕ теги, факты, цифры, ссылки. Возвращаешь только итоговый HTML без markdown-обёрток.";
        const usr = `Закрой оборванные мысли в тексте. Каждое предложение должно быть завершённым; ни один абзац не должен заканчиваться висящим союзом ("и", "но", "поэтому", "однако") или без терминатора.

${hint}

Правила:
- Допиши логическое завершение там, где мысль обрывается.
- Не выкидывай абзацы целиком — дополни их.
- Сохрани все HTML-теги (<h2>, <h3>, <p>, <ul>, <li>, <table>, <a>).
- Не меняй факты, цифры, бренды, ссылки.

HTML:
${content}`;
        const before = metricsOf(content);
        const fixed = await callOpenRouter("anthropic/claude-sonnet-4", sys, usr, orKey, 12000);
        let applied = false;
        let integrityRes: { ok: boolean; reason?: string } | null = null;
        let candMetrics: ReturnType<typeof metricsOf> | null = null;
        if (fixed && fixed.length > 200) {
          const candidate = fixed.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
          candMetrics = metricsOf(candidate);
          const integrity = htmlIntegrityOk(content, candidate);
          integrityRes = integrity;
          if (integrity.ok) { content = candidate; applied = true; }
          else console.warn("[improve-article] dangling-fix rejected:", integrity.reason);
        }
        recordPass({
          step: "dangling",
          model: "anthropic/claude-sonnet-4",
          blocks: { verdict_before: metrics.verdict },
          metrics_before: before,
          metrics_llm: candMetrics,
          integrity: integrityRes,
          applied,
          llm_bytes: fixed ? fixed.length : 0,
          llm_null: !fixed,
          prompt: { system: sys, user: usr, user_bytes: usr.length },
        });
      }
    }

    // 7) Cancellary: канцеляризмы и штампы из BANLIST.
    if ((phase === "cancellary" || phase === "all") && orKey) {
      const metrics = analyzeCancellary(stripHtml(content), cancellaryOptionsFromStyleProfile(styleProfile));
      if (metrics.verdict === "fail") {
        const hint = buildCancellaryFixHint(metrics) || "";
        const sys = "Ты редактор. Убираешь канцеляризмы и штампы из HTML, сохраняя ВСЕ теги, факты, цифры, ссылки. Возвращаешь только итоговый HTML без markdown-обёрток.";
        const usr = `Перепиши фразы, содержащие запрещённые обороты. Заменяй конкретикой, фактом или действием — не выбрасывай слова механически.

${hint}

Правила:
- Сохрани все HTML-теги и структуру.
- Не меняй цифры, бренды, ссылки.
- Если фразу нечем заменить — выкидывай целиком, не оставляй обрубок.

HTML:
${content}`;
        const before = metricsOf(content);
        const fixed = await callOpenRouter("anthropic/claude-sonnet-4", sys, usr, orKey, 12000);
        let applied = false;
        let integrityRes: { ok: boolean; reason?: string } | null = null;
        let candMetrics: ReturnType<typeof metricsOf> | null = null;
        if (fixed && fixed.length > 200) {
          const candidate = fixed.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
          candMetrics = metricsOf(candidate);
          const integrity = htmlIntegrityOk(content, candidate);
          integrityRes = integrity;
          if (integrity.ok) { content = candidate; applied = true; }
          else console.warn("[improve-article] cancellary-fix rejected:", integrity.reason);
        }
        recordPass({
          step: "cancellary",
          model: "anthropic/claude-sonnet-4",
          blocks: { verdict_before: metrics.verdict },
          metrics_before: before,
          metrics_llm: candMetrics,
          integrity: integrityRes,
          applied,
          llm_bytes: fixed ? fixed.length : 0,
          llm_null: !fixed,
          prompt: { system: sys, user: usr, user_bytes: usr.length },
        });
      }
    }

    // 8) Keyword frequency: сверхчастые значимые слова и переспам seed-ключа в H2.
    if ((phase === "keyword_freq" || phase === "all") && orKey) {
      const metrics = analyzeKeywordFrequency(content, primaryKeyword || null, keywordOptionsFromStyleProfile(styleProfile));
      if (metrics.verdict === "fail") {
        const hint = buildKeywordFrequencyFixHint(metrics) || "";
        const sys = "Ты редактор. Снижаешь частотность повторяющихся слов в HTML через синонимы, местоимения и перестройку фраз. Сохраняешь ВСЕ теги, факты, цифры, ссылки. Возвращаешь только итоговый HTML без markdown-обёрток.";
        const usr = `Снизь частотность сверхчастых слов и seed-ключа. Используй синонимы, местоимения, перестройку фразы — не выкидывай слова механически.

${hint}

Правила:
- Норма: значимое слово ≤ 2 раз на 1000 знаков; seed-ключ ≤ 1 раз в каждом H2-блоке.
- Сохрани смысл и факты; не делай текст безличным.
- Сохрани все HTML-теги (<h2>, <h3>, <p>, <ul>, <li>, <table>, <a>).

HTML:
${content}`;
        const before = metricsOf(content);
        const fixed = await callOpenRouter("anthropic/claude-sonnet-4", sys, usr, orKey, 12000);
        let applied = false;
        let integrityRes: { ok: boolean; reason?: string } | null = null;
        let candMetrics: ReturnType<typeof metricsOf> | null = null;
        if (fixed && fixed.length > 200) {
          const candidate = fixed.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
          candMetrics = metricsOf(candidate);
          const integrity = htmlIntegrityOk(content, candidate);
          integrityRes = integrity;
          if (integrity.ok) { content = candidate; applied = true; }
          else console.warn("[improve-article] keyword-freq-fix rejected:", integrity.reason);
        }
        recordPass({
          step: "keyword_freq",
          model: "anthropic/claude-sonnet-4",
          blocks: { verdict_before: metrics.verdict, primary_keyword: primaryKeyword },
          metrics_before: before,
          metrics_llm: candMetrics,
          integrity: integrityRes,
          applied,
          llm_bytes: fixed ? fixed.length : 0,
          llm_null: !fixed,
          prompt: { system: sys, user: usr, user_bytes: usr.length },
        });
      }
    }

    // Save improved content + bump seo_improve_count for user-facing runs
    const nextImproveCount = bypassLimits
      ? Number((art as any).seo_improve_count || 0)
      : Number((art as any).seo_improve_count || 0) + 1;
    await admin.from("articles").update({
      content,
      quality_status: "checking",
      seo_improve_count: nextImproveCount,
      updated_at: new Date().toISOString(),
    }).eq("id", article_id);

    // Record success in quality_details.improve_last (best-effort JSON merge)
    try {
      const prevDetails = (art as any).quality_details && typeof (art as any).quality_details === "object"
        ? (art as any).quality_details : {};
      const metricsFinal = metricsOf(content);
      const appliedSteps = trace.filter((t) => t.applied).map((t) => t.step);
      const traceSummary = trace.map((t) => ({
        step: t.step,
        model: t.model,
        blocks: t.blocks || null,
        metrics_before: t.metrics_before,
        metrics_llm: t.metrics_llm,
        integrity: t.integrity,
        applied: t.applied,
        llm_bytes: t.llm_bytes,
        llm_null: t.llm_null,
      }));
      await admin.from("articles").update({
        quality_details: {
          ...prevDetails,
          improve_last: {
            status: "ok",
            phase,
            at: new Date().toISOString(),
            metrics_before: metricsInitial,
            metrics_after: metricsFinal,
            applied_steps: appliedSteps,
            integrity_rejections: integrityRejections,
            trace: traceSummary,
          },
          improve_error: null,
        },
      }).eq("id", article_id);
    } catch (_) { /* non-critical */ }

    // Re-trigger auto quality check (fire-and-forget)
    const reCheck = (async () => {
      try {
        await fetch(`${supabaseUrl}/functions/v1/quality-check`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
          },
          body: JSON.stringify({ article_id, content, mode: "auto" }),
        });
      } catch (e) {
        console.error("[improve-article] re-check failed", e);
      }
    })();
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(reCheck); } catch (_) { void reCheck; }

    logPipelineEvent({
      stage: "improve",
      user_id: user.id,
      article_id,
      verdict: "pass",
      duration_ms: elapsed(),
      meta: {
        phase,
        source: source ?? null,
        auto: bypassLimits,
        metrics_before: metricsInitial,
        metrics_after: metricsOf(content),
        applied_steps: trace.filter((t) => t.applied).map((t) => t.step),
        integrity_rejections: integrityRejections,
        // Full prompts of every LLM pass — including system + user (with article
        // body). Kept so we can verify exactly what went to the model.
        prompt_trace: trace,
      },
    });
  } catch (e: any) {
    console.error("[improve-article][bg] error", e);
    const errMsg = e?.message || "Unknown error";
    // Clear "improving" flag so client polling unblocks, record error.
    try {
      const prevDetails = (args.art as any).quality_details && typeof (args.art as any).quality_details === "object"
        ? (args.art as any).quality_details : {};
      await admin.from("articles").update({
        quality_status: null,
        quality_details: {
          ...prevDetails,
          improve_last: { status: "error", phase, at: new Date().toISOString(), error: errMsg },
          improve_error: errMsg,
        },
      }).eq("id", article_id);
    } catch (_) { /* noop */ }
    logPipelineEvent({
      stage: "improve",
      user_id: user.id,
      article_id,
      verdict: "fail",
      duration_ms: elapsed(),
      error_kind: e instanceof AiError ? e.kind : "upstream",
      error_message: errMsg,
      meta: { phase, source: source ?? null, auto: bypassLimits },
    });
  }
}