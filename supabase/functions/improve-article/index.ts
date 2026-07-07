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
import { ensureHtml, isStaleStatus } from "../_shared/ensureHtml.ts";
import { getPlanLimit, IMPROVE_LIMITS, normalizePlanKey } from "../_shared/planLimits.ts";
import { analyzeSentenceStructure, buildSentenceStructureFixHint } from "../_shared/sentenceStructure.ts";
import { analyzeCancellary, buildCancellaryFixHint } from "../_shared/validators/cancellaryGuard.ts";
import { analyzeKeywordFrequency, buildKeywordFrequencyFixHint } from "../_shared/validators/keywordFrequencyGuard.ts";
import { analyzeDanglingThoughts, buildDanglingFixHint } from "../_shared/validators/danglingThoughtGuard.ts";
import { analyzeSanity } from "../_shared/contentSanity.ts";
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

// Detect nominative-case keyword injections that hint the LLM glued the raw
// keyword into a sentence without declension. Heuristic:
//   - split plain-text into sentences,
//   - for every sentence that contains the keyword (case-insensitive, as a
//     whole word phrase),
//   - flag if the keyword is NOT preceded by a RU preposition/comma/dash/
//     sentence-start, OR is immediately followed by another content word
//     (noun-noun jam like "минитрактор цена приятная").
// Returns the list of flagged sentence excerpts (deduped, cap 6).
const RU_PREPS = new Set([
  "в","во","на","над","под","при","о","об","обо","у","от","до","для","из",
  "к","ко","с","со","по","за","про","через","среди","между","без","около",
  "вокруг","против","насчёт","насчет","благодаря",
]);
export function detectNominativeKeywordHits(html: string, keyword: string): string[] {
  if (!keyword) return [];
  const kw = keyword.trim().toLowerCase();
  if (!kw || kw.length < 4) return [];
  const kwWords = kw.split(/\s+/).filter(Boolean);
  if (!kwWords.length) return [];
  const plain = stripHtml(html);
  const sentences = plain.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 8);
  const hits: string[] = [];
  const seen = new Set<string>();
  const kwRe = new RegExp(
    // Match the keyword phrase as whole word sequence (case-insensitive).
    "\\b" + kwWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+") + "\\b",
    "i",
  );
  for (const sent of sentences) {
    const m = kwRe.exec(sent);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    // Prev token (a single word before the keyword, ignoring punctuation glue).
    const prevChunk = sent.slice(0, start).replace(/[,\-–—:;()"«»']/g, " ").trim();
    const prevToken = prevChunk.split(/\s+/).pop()?.toLowerCase() || "";
    const prevIsPrep = RU_PREPS.has(prevToken);
    const atStart = prevChunk.length === 0;
    // Next token: is it a content word (letters) with no preposition/comma
    // between? "минитрактор цена" fires; "минитрактор из Китая" does not
    // because "из" is a preposition; "минитрактор, отзывы" does not because
    // of the comma between.
    const tail = sent.slice(end);
    const nextRaw = tail.match(/^\s*([^\s,.:;!?()"«»–—]+)/);
    const nextToken = nextRaw?.[1]?.toLowerCase() || "";
    const nextIsContent =
      !!nextToken &&
      /^[а-яёa-z][а-яёa-z-]*$/i.test(nextToken) &&
      !RU_PREPS.has(nextToken);
    // Glued injection = keyword not "anchored" by a preposition AND followed
    // by another noun-like word with no glue punctuation.
    const injected = !prevIsPrep && !atStart && nextIsContent;
    if (!injected) continue;
    const key = sent.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(sent.length > 220 ? sent.slice(0, 217) + "…" : sent);
    if (hits.length >= 6) break;
  }
  return hits;
}

// Косметическая нормализация текста статьи перед сохранением:
// 1. Заголовки markdown (# / ## / ### / ####) с первой заглавной буквы.
// 2. Заголовки HTML (<h1>-<h6>) — первая буква содержимого заглавная.
// 3. Пробел после точки/восклицания/вопроса перед заглавной буквой ("гараж.Резко" → "гараж. Резко").
//    Затрагивает и кириллицу, и латиницу. НЕ ломает URL (после "://" не срабатывает),
//    аббревиатуры вида "и.т.д" и десятичные числа "3.14" остаются нетронутыми.
export function cosmeticNormalize(input: string): string {
  if (!input) return input;
  let out = input;

  // Markdown-заголовки: "## что лучше" → "## Что лучше".
  out = out.replace(/^(\s{0,3}#{1,6}\s+)(\S)(.*)$/gm, (_m, hash, first, rest) => {
    return hash + first.toLocaleUpperCase("ru-RU") + rest;
  });

  // HTML-заголовки.
  out = out.replace(/(<h[1-6][^>]*>)(\s*)(<[^>]+>)*(\s*)([a-zа-яё])/gi, (m, open, ws1, innerTag, ws2, ch) => {
    return open + ws1 + (innerTag || "") + ws2 + ch.toLocaleUpperCase("ru-RU");
  });

  // Пробел после терминатора перед заглавной. Не трогаем URL и десятичные числа.
  out = out.replace(/([а-яёa-z])([.!?])([A-ZА-ЯЁ])/g, (_m, prev, punct, next) => {
    return `${prev}${punct} ${next}`;
  });

  return out;
}

// Meta description: то же + удаление внутренних переносов строк.
export function normalizeMetaDescription(input: string): string {
  if (!input) return input;
  let out = input.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  out = out.replace(/([а-яёa-z])([.!?])([A-ZА-ЯЁ])/g, (_m, prev, punct, next) => `${prev}${punct} ${next}`);
  // Первая буква — заглавная.
  if (out) out = out.charAt(0).toLocaleUpperCase("ru-RU") + out.slice(1);
  return out;
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

async function callGateway(model: string, system: string, user: string, key: string, maxTokens = 12000): Promise<string | null> {
  try {
    const r = await chatComplete({
      apiKey: key, model, system, user, maxTokens, timeoutMs: 120_000,
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
    const { article_id, fix_type, user_id: bodyUserId, source, cycle, priority: bodyPriority, pass_index: bodyPassIndex } = body || {};
    const isCycle = cycle === true;
    const cyclePriority: "auto" | "ai" | "turgenev" =
      bodyPriority === "ai" || bodyPriority === "turgenev" ? bodyPriority : "auto";
    // pass_index > 0 means this is a relay call from a previous worker
    // (see runImproveCycleStep). pass_index = 1 or absent means "start pass 1".
    const passIndexRaw = Number(bodyPassIndex);
    const isRelay = Number.isFinite(passIndexRaw) && passIndexRaw >= 2;

    // Internal service-role invocation (e.g. quality-check auto-turgenev-fix).
    const isServiceCall =
      authHeader === `Bearer ${serviceKey}` && typeof bodyUserId === "string" && bodyUserId.length > 0;
    const isAutoTurgenev = isServiceCall && source === "auto_turgenev";
    const isAutoSentence = isServiceCall && source === "auto_sentence_structure";
    const isAutoDangling = isServiceCall && source === "auto_dangling";
    const isAutoCancellary = isServiceCall && source === "auto_cancellary";
    const isAutoKwFreq = isServiceCall && source === "auto_keyword_freq";
    const isCycleRelay = isServiceCall && source === "cycle_relay";
    const bypassLimits = isAutoTurgenev || isAutoSentence || isAutoDangling || isAutoCancellary || isAutoKwFreq || isCycleRelay;

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
      .select("id,user_id,content,title,meta_description,keyword_id,keywords,ai_score,ai_score_internal,ai_score_claude,burstiness_status,keyword_density_status,keyword_density,last_improve_at,turgenev_status,language,seo_improve_count,author_profile_id,quality_details,quality_status,improve_stop_requested")
      .eq("id", article_id).maybeSingle();
    if (!art || art.user_id !== user.id) return json({ error: "Article not found" }, 404);

    // ── Stop-barrier ─────────────────────────────────────────────────
    // If the user pressed "Stop", NO automatic source (auto_* from
    // quality-check, cycle_relay from a stray relay hop) may re-enter
    // this article. Only an explicit user click (source `cycle:ui` /
    // `ui` / `manual` / unset) resets the barrier by starting a fresh
    // cycle, which itself clears `improve_stop_requested` below.
    const isAutoSource =
      source === "auto_humanize" || source === "auto_turgenev" ||
      source === "auto_dangling" || source === "auto_sentence_structure" ||
      source === "auto_cancellary" || source === "auto_keyword_freq" ||
      source === "cycle_relay";
    if ((art as any).improve_stop_requested === true && isAutoSource) {
      logPipelineEvent({
        stage: "improve",
        user_id: user.id,
        article_id,
        verdict: "warning",
        duration_ms: 0,
        meta: { event: "blocked_after_user_stop", source: source || null },
      });
      return json({ ok: false, blocked: "user_stop", source: source || null }, 200);
    }

    let initialContent: string = art.content || "";
    if (!initialContent) return json({ error: "Article has no content" }, 400);
    const originalAiScore = art.ai_score;

    // ── Corruption gate ──────────────────────────────────────────────
    // Refuse to run any improve pass on token-salad content. The improve
    // cycle would just amplify the mess and burn credits. User must
    // regenerate the article first.
    {
      const sanity = analyzeSanity(stripHtml(initialContent));
      if (sanity.corrupted) {
        logPipelineEvent({
          stage: "improve",
          user_id: user.id,
          article_id,
          verdict: "fail",
          duration_ms: 0,
          error_kind: "content_corrupted",
          error_message: sanity.reasons.join(","),
          meta: { event: "blocked_content_corrupted", reasons: sanity.reasons },
        });
        try {
          const prevDet = (art as any).quality_details || {};
          await admin.from("articles").update({
            quality_status: "fail",
            quality_badge: "needs_work",
            quality_details: {
              ...prevDet,
              sanity: { ...sanity, checked_at: new Date().toISOString() },
              corrupted: true,
              corrupted_reason: sanity.reasons.join(", "),
            },
          }).eq("id", article_id);
        } catch (_) { /* ignore */ }
        return json({
          ok: false,
          blocked: "content_corrupted",
          reasons: sanity.reasons,
          message: "Содержимое статьи повреждено (token-salad). Сгенерируйте статью заново — улучшайзер не запускается на битом тексте.",
        }, 200);
      }
    }

    // ── Format normalization: pipeline expects HTML (metricsOf, htmlIntegrityOk,
    // validators). If content is pure Markdown (single-shot generation path
    // emits '# H1 / ## H2 ...' by design) — convert to HTML BEFORE any pass and
    // persist so the editor also sees HTML from here on.
    {
      const norm = ensureHtml(initialContent);
      if (norm.converted) {
        await admin.from("articles").update({ content: norm.html }).eq("id", article_id);
        (art as any).content = norm.html;
        // CRITICAL: also update the local var — otherwise the background
        // pipeline receives the pre-normalization Markdown as args.initialContent,
        // operates on 0-metric text, and finally overwrites the DB back to Markdown.
        initialContent = norm.html;
        logPipelineEvent({
          stage: "improve",
          user_id: user.id,
          article_id,
          verdict: "warning",
          duration_ms: 0,
          meta: { event: "md_to_html_conversion", reason: norm.reason, before_bytes: initialContent.length, after_bytes: norm.html.length },
        });
      }
    }

    // Prevent overlapping runs on the same article.
    // ── Stuck-detector (cycle-aware) ──────────────────────────────────
    // A cycle is stuck when quality_details.cycle_progress.status='running'
    // and its updated_at is older than 3 minutes (previous worker died
    // without finalizing). Reset immediately so the user isn't blocked.
    // Fresh (<3 min) running cycles reject duplicate starts.
    const cycleProgress = ((art as any).quality_details && typeof (art as any).quality_details === "object")
      ? ((art as any).quality_details.cycle_progress ?? null) : null;
    if (cycleProgress && cycleProgress.status === "running") {
      const cpUpdated = cycleProgress.updated_at ? Date.parse(cycleProgress.updated_at) : 0;
      const cpAgeMs = Date.now() - (cpUpdated || 0);
      const cpStuck = !cpUpdated || cpAgeMs > 3 * 60 * 1000;
      if (cpStuck) {
        const prevDetails = (art as any).quality_details || {};
        try {
          await admin.from("articles").update({
            quality_status: null,
            improve_stop_requested: false,
            quality_details: {
              ...prevDetails,
              cycle_progress: {
                ...cycleProgress,
                status: "error",
                final_status: "timed_out",
                error: `Цикл не отвечал ${Math.round(cpAgeMs / 1000)}с — сброшен новым запросом`,
                finished_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            },
          }).eq("id", article_id);
        } catch (_) {}
        (art as any).quality_status = null;
        logPipelineEvent({
          stage: "improve",
          user_id: user.id,
          article_id,
          verdict: "warning",
          duration_ms: 0,
          meta: { event: "cycle_stuck_reset", age_ms: cpAgeMs, pass: cycleProgress.pass ?? null },
        });
      } else if (!isRelay) {
        // Fresh running cycle + a NEW start attempt (not a relay) = user
        // double-clicked or a stale UI retried. Reject cleanly.
        return json({
          ok: false,
          already_running: true,
          cycle_active: true,
          message: "Цикл улучшения уже запущен, дождитесь завершения",
        }, 202);
      }
    }
    // Auto-reset stale status: 'improving' / 'checking' with no pipeline_events
    // in the last 10 minutes = crashed background task, unblock the article.
    if ((art as any).quality_status === "improving" || (art as any).quality_status === "checking") {
      // Filter events by stage: for 'checking' the pipeline is alive only if
      // there is a recent quality_check/ai_detect event — any earlier
      // 'improve' event would otherwise mask a dead background task forever.
      const staleStages = (art as any).quality_status === "checking"
        ? ["quality_check", "ai_detect"]
        : ["improve", "humanize"];
      const stale = await isStaleStatus(admin, article_id, 10 * 60 * 1000, staleStages);
      if (stale) {
        const prevStatus = (art as any).quality_status;
        await admin.from("articles").update({ quality_status: null }).eq("id", article_id);
        (art as any).quality_status = null;
        logPipelineEvent({
          stage: "improve",
          user_id: user.id,
          article_id,
          verdict: "warning",
          duration_ms: 0,
          meta: { event: "stale_status_reset", was: prevStatus, reason: "no_events_>10min" },
        });
      }
    }
    if ((art as any).quality_status === "improving" && !isRelay) {
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

    // Snapshot BEFORE any change so user can rollback.
    // Relay calls (cycle pass 2+) SKIP this — snapshot already taken by pass 1.
    if (!isRelay) try {
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
    // Relay calls keep the existing improve_stop_requested so a mid-cycle
    // stop request placed BETWEEN passes is honoured on the next worker.
    await admin.from("articles").update({
      last_improve_at: new Date().toISOString(),
      quality_status: "improving",
      ...(isRelay ? {} : { improve_stop_requested: false }),
    }).eq("id", article_id);

    // Kick off all LLM work in the background — LLM passes are far longer than
    // the edge-function response deadline. Cycles are split into ONE pass per
    // worker (relay pattern): each worker does one pass + judges (~1.5-2.5min)
    // and, if the goals aren't met, fire-and-forget POSTs to itself with an
    // incremented pass_index. Individual worker never approaches the ~400s
    // waitUntil limit. F5-safe: the orchestration state lives in cycle_progress.
    const passIndex = isCycle ? (Number.isFinite(passIndexRaw) && passIndexRaw >= 1 ? passIndexRaw : 1) : 0;
    const bg = isCycle
      ? runImproveCycleStep({
          admin, supabaseUrl, article_id, user, art,
          initialContent, orKey, lovableKey,
          authHeader, elapsed, source, bypassLimits,
          priority: cyclePriority,
          passIndex,
          serviceKey,
        })
      : runImprovePipeline({
          admin, supabaseUrl, article_id, user, phase, art,
          initialContent, primaryKeywordSeed: null, orKey, lovableKey,
          authHeader, elapsed, source, bypassLimits,
        });
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg); } catch { void bg; }

    return json({ ok: true, accepted: true, async: true, cycle: isCycle, pass: passIndex || undefined }, 202);
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
  /** Cycle mode: skip Opus micro-pass, skip inline quality-check dispatch,
   *  keep quality_status='improving' between passes (cycle controls status). */
  cycleMode?: boolean;
  /** Optional sub-step reporter (used by cycle for UI progress: "Гуманизация (Sonnet)" etc). */
  reportSubStep?: (label: string) => Promise<void>;
}

async function runImprovePipeline(args: PipelineArgs): Promise<void> {
  const { admin, supabaseUrl, article_id, user, phase, art, orKey, lovableKey, authHeader, elapsed, source, bypassLimits, cycleMode, reportSubStep } = args;
  const emitSubStep = async (label: string) => {
    if (reportSubStep) { try { await reportSubStep(label); } catch (_) {} }
  };
  let content = args.initialContent;
  // ── Best-candidate tracking. Every state (initial + after each successful
  // LLM step) is scored with the same blended judge stack as quality-check;
  // at the end we write the state with the HIGHEST score, not the last one.
  let bestContent = args.initialContent;
  let bestScore = Number(art.ai_score ?? 0);
  let bestLabel = "initial";
  let bestParts: { claude: number | null; gemini: number | null } = {
    claude: typeof art.ai_score_claude === "number" ? art.ai_score_claude : null,
    gemini: typeof art.ai_score_internal === "number" ? art.ai_score_internal : null,
  };
  let bestReasons: { claude: string[]; gemini: string[] } = { claude: [], gemini: [] };
  const scoreHistory: Array<{
    label: string;
    score: number | null;
    parts: { claude: number | null; gemini: number | null };
    reasons?: { claude: string[]; gemini: string[] };
  }> = [];
  function parseScoreAndReasons(rawInput: unknown): { score: number | null; reasons: string[] } {
    const raw = String(rawInput || "").trim();
    if (!raw) return { score: null, reasons: [] };
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
      const n = Number(parsed?.score);
      const reasons = Array.isArray(parsed?.reasons)
        ? parsed.reasons.map((s: unknown) => String(s)).filter(Boolean).slice(0, 6)
        : [];
      return { score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null, reasons };
    } catch (_) { /* plain-text fallback below */ }
    const m = cleaned.match(/\d{1,3}/);
    const score = m ? Math.max(0, Math.min(100, parseInt(m[0], 10))) : null;
    const reasons = cleaned
      .split(/\n+/)
      .map((s) => s.replace(/^\s*[-•\d.)]+\s*/, "").trim())
      .filter((s) => s && !/^\d{1,3}$/.test(s))
      .slice(0, 6);
    return { score, reasons };
  }
  async function scoreClaudeInline(plain: string, key: string): Promise<{ score: number | null; reasons: string[] }> {
    try {
      const raw = plain.slice(0, 2000);
      const lastEnd = Math.max(raw.lastIndexOf("."), raw.lastIndexOf("!"), raw.lastIndexOf("?"), raw.lastIndexOf("…"));
      const sample = lastEnd > 800 ? raw.slice(0, lastEnd + 1) : raw;
      const r = await chatComplete({
        apiKey: key, model: "anthropic/claude-sonnet-4",
        system: "Ты - детектор ИИ-текста. Верни JSON: {\"score\":<0-100>,\"reasons\":[\"...\"]}. 100 = живой человек, 0 = явный ИИ.",
        user: `Это фрагмент длинного текста, обрыв не учитывай.\nОцени 0-100 и дай 2-4 короткие причины. Ответь только JSON.\n\n${sample}`,
        maxTokens: 180, temperature: 0, timeoutMs: 60_000,
        appTitle: "SEO-Modul improve-article score",
      });
      return parseScoreAndReasons(r.content);
    } catch { return { score: null, reasons: [] }; }
  }
  async function scoreGeminiInline(plain: string, key: string): Promise<{ score: number | null; reasons: string[] }> {
    try {
      const sample = plain.slice(0, 5000);
      const r = await chatComplete({
        apiKey: key, model: "google/gemini-2.5-flash",
        system: 'Ты - детектор AI-текста. Верни JSON {"score":<0-100>,"reasons":["..."]}.',
        user: `Оцени: 100 = написан человеком, 0 = ИИ. Дай 2-4 короткие причины. Ответь только JSON.\n\n${sample}`,
        maxTokens: 180, temperature: 0, timeoutMs: 20_000,
        appTitle: "SEO-Modul improve-article score",
      });
      return parseScoreAndReasons(r.content);
    } catch { return { score: null, reasons: [] }; }
  }
  async function scoreCandidate(html: string, label: string): Promise<number | null> {
    const plain = stripHtml(html);
    const [c, g] = await Promise.all([
      orKey ? scoreClaudeInline(plain, orKey) : Promise.resolve({ score: null, reasons: [] }),
      lovableKey ? scoreGeminiInline(plain, lovableKey) : Promise.resolve({ score: null, reasons: [] }),
    ]);
    const parts = [c.score, g.score].filter((x): x is number => typeof x === "number");
    const blended = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
    scoreHistory.push({
      label,
      score: blended,
      parts: { claude: c.score, gemini: g.score },
      reasons: { claude: c.reasons, gemini: g.reasons },
    });
    if (typeof blended === "number" && blended > bestScore) {
      bestScore = blended;
      bestContent = html;
      bestLabel = label;
      bestParts = { claude: c.score, gemini: g.score };
      bestReasons = { claude: c.reasons, gemini: g.reasons };
    }
    return blended;
  }
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
    llm_null_reason?: string | null;
    llm_duration_ms?: number;
    prompt: { system: string; user: string; user_bytes: number } | null;
  };
  const trace: PassTrace[] = [];
  const integrityRejections: Array<{ step: string; reason: string; metrics_llm: any; metrics_before: any }> = [];

  // ── User "Stop" flag — checked BETWEEN steps (never inside an LLM call).
  // When set, the pipeline skips remaining passes and jumps to finalize with
  // the best-scoring candidate observed so far. Written by the client via
  // `articles.improve_stop_requested = true`.
  let stoppedByUser = false;
  let stoppedAtStep: string | null = null;
  async function checkStopFlag(afterStep: string): Promise<void> {
    if (stoppedByUser) return;
    try {
      const { data } = await admin
        .from("articles")
        .select("improve_stop_requested")
        .eq("id", article_id)
        .maybeSingle();
      if ((data as any)?.improve_stop_requested === true) {
        stoppedByUser = true;
        stoppedAtStep = afterStep;
        logPipelineEvent({
          stage: "improve",
          user_id: user.id,
          article_id,
          verdict: "warning",
          duration_ms: elapsed(),
          meta: { event: "stop_requested", after_step: afterStep, phase },
        });
      }
    } catch (_) { /* non-fatal */ }
  }

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

    // NaN-gate fix: null ai_score = "score unknown", NOT "text is great".
    // Previously `?? 100` skipped humanize/opus entirely on brand-new articles
    // with no prior quality-check → we lost the very first pass on many drafts.
    const aiScoreRaw = (art as any).ai_score;
    const aiScoreMissing = aiScoreRaw == null || Number.isNaN(Number(aiScoreRaw));
    const aiScore = aiScoreMissing ? 0 : Number(aiScoreRaw);
    if (aiScoreMissing) {
      logPipelineEvent({
        stage: "improve",
        user_id: user.id,
        article_id,
        verdict: "warning",
        duration_ms: 0,
        meta: { event: "ai_score_missing_treated_as_needs_improve", phase },
      });
    }
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

    // ── Judge feedback loop. quality-check saves reasons from Claude + Gemini
    // into quality_details.ai_*_reasons; feed them back so the next humanize
    // pass fixes EXACTLY what dropped the score (not just structural metrics).
    const priorClaudeReasons: string[] = Array.isArray((art as any).quality_details?.ai_claude_reasons)
      ? (art as any).quality_details.ai_claude_reasons.map((s: any) => String(s)).filter(Boolean)
      : [];
    const priorInternalReasons: string[] = Array.isArray((art as any).quality_details?.ai_internal_reasons)
      ? (art as any).quality_details.ai_internal_reasons.map((s: any) => String(s)).filter(Boolean)
      : [];
    const judgeReasonsAll = [...priorClaudeReasons, ...priorInternalReasons];
    const judgeReasonsBlock = judgeReasonsAll.length
      ? `\n\nСУДЬИ СНИЗИЛИ БАЛЛ ЗА (устрани прицельно, не воспроизводи эти же дефекты):\n${judgeReasonsAll.slice(0, 8).map((r, i) => `${i + 1}. ${r}`).join("\n")}\n`
      : "";

    // ── Постоянный лексический запрет. Эти клише срабатывают у обоих судей
    // независимо от ритма и метрик, поэтому висят всегда, а не только когда
    // валидатор их поймал в прошлом прогоне.
    const lexicalBanBlock = `
ЗАПРЕЩЁННЫЕ КЛИШЕ (полностью убрать, заменить конкретикой из ТЕКСТА статьи — цифрой, сценарием, примером, наблюдением):
- "практика показывает"
- "ключевой момент"
- "стоит отметить"
- "зависит от конкретных задач"
- "важно понимать"
Конструкция "чем больше ... тем ..." — не более 1 раза на весь текст. Второе повторение переформулируй через конкретный сценарий ("если объем перевалок > 40 м³ / день — колесный универсал окупается быстрее").`;

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

ГРАММАТИЧЕСКАЯ ПОЛНОТА КОРОТКИХ ПРЕДЛОЖЕНИЙ (жёстко):
- Короткое предложение (до 8 слов) ОБЯЗАНО быть грамматически полным: либо подлежащее + сказуемое ("Японец выигрывает."), либо законченное назывное ("Первая зима - лакмус."), либо полный вопрос ("Стоит ли переплачивать?").
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО обрывать придаточное на союзе/предлоге и ставить точку. Дефектные обрывки: "…потому что.", "…но зимой.", "…но когда.", "…если.", "…хотя.", "…так как.", "…чтобы.", "…когда.", "…пока.", "…несмотря на.", "…из-за."
- Если после союза/предлога нет продолжения — либо допиши придаточное до конца ("…потому что запчасти доступнее"), либо перестрой в самостоятельное предложение без этого союза.
- Проверяй КАЖДОЕ короткое предложение перед постановкой точки: если убрать точку и последнее слово оказывается союзом/предлогом ("но", "и", "потому что", "когда", "если", "но зимой", "из-за") — это дефект.

КЛЮЧЕВЫЕ СЛОВА В ТЕКСТЕ (обязательная грамматика):
- Все ключевые слова и запросы склоняй по падежу/числу и встраивай в естественную грамматику предложения.
- ЗАПРЕЩЕНЫ несклонённые вставки в именительном падеже посреди фразы: "купить минитрактор цена приятная", "китайский минитрактор отзывы это подтверждают", "стоимость минитрактор дешево".
- Правильно: "Цена на минитрактор из Китая приятная", "Отзывы о китайских минитракторах это подтверждают", "Стоимость минитрактора невысокая". Ключ должен читаться как обычное словосочетание в предложении.

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
    if (!stoppedByUser && (phase === "humanize" || phase === "all") && aiScore < 70 && (orKey || lovableKey)) {
      // ── Score the INITIAL content in parallel with humanize. Guarantees a
      // real ai_score even if every subsequent pass is rejected on integrity
      // (no_progress cycle). Only on pass 1 — relay hops reuse it.
      const initialScorePromise = !isRelay
        ? scoreCandidate(content, "initial").catch(() => null)
        : Promise.resolve(null);
      const sys = "Ты редактор-человек. Переписываешь HTML-контент сохраняя ВСЕ факты, цифры, бренды, ссылки, теги. Возвращаешь только итоговый HTML без markdown-обёрток.";
      const usr = `Перепиши текст так, чтобы он одновременно прошёл AI-детектор И Тургенев (Баден-Баден).
${validatorContextBlock}
${judgeReasonsBlock}
${lexicalBanBlock}
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
        judge_reasons_count: judgeReasonsAll.length,
        lexical_ban: true,
      };
      let humanizeModel = orKey ? "anthropic/claude-sonnet-4" : "google/gemini-2.5-pro";
      let humanizeLlmError: string | undefined;
      let humanizeDurationMs = 0;
      if (orKey) {
        await emitSubStep("Гуманизация (Sonnet)");
        // 75s был впритык — Sonnet стабильно уходил в timeout и мы падали
        // на gemini-2.5-pro. Поднято до 90s (worker budget всё ещё держит:
        // 90 humanize + 80 judges + overhead ≈ 180s, реле распилит проходы).
        const r = await callOpenRouterEx("anthropic/claude-sonnet-4", sys, usr, orKey, 12000, 90_000);
        rewritten = r.content;
        humanizeLlmError = r.error;
        humanizeDurationMs = r.duration_ms;
      }
      if (!rewritten && lovableKey) {
        humanizeModel = "google/gemini-2.5-pro";
        await emitSubStep("Гуманизация (Gemini fallback)");
        // Explicit 12000 max_tokens — default (2000) обрывал длинные RU
        // статьи (finish:"length", 2212 слов → 34), integrity rejected.
        rewritten = await callGateway("google/gemini-2.5-pro", sys, usr, lovableKey, 12000);
        if (!rewritten && !humanizeLlmError) humanizeLlmError = "gemini_fallback_empty";
      }
      // Drain the initial-score promise before we record/persist the pass so
      // its result lands in scoreHistory / bestScore even if humanize failed.
      try { await initialScorePromise; } catch (_) { /* non-critical */ }
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
      if (humanizeApplied) {
        await emitSubStep("Оценка кандидата (судьи)");
        await scoreCandidate(content, "humanize.sonnet");
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
      await checkStopFlag("humanize.sonnet");
      // Opus is skipped in cycle mode — telemetry shows 120s timeouts eat the
      // whole worker budget with 0 applied passes in >2 days. Manual buttons
      // (fix_type=humanize outside a cycle) still get it.
      if (!stoppedByUser && !cycleMode && aiScore < 40 && orKey) {
        const sysOpus = "Ты редактор-человек. Делаешь микро-проход по HTML: убираешь монотонность синтаксиса, одинаковые начала абзацев, лексические всплески. Сохраняешь ВСЕ HTML-теги, факты, цифры, ссылки. Возвращаешь только итоговый HTML без markdown-обёрток.";
        const usrOpus = `Микро-проход: убери оставшиеся "ИИ-подписи" — монотонность синтаксиса, одинаковые зачины абзацев, лексические всплески. Цель: AI-детектор <30%. НЕ трогай факты, цифры, ссылки, теги (<h2>,<h3>,<p>,<ul>,<table>,<a>).
${validatorContextBlock}
${judgeReasonsBlock}
${lexicalBanBlock}
${rhythmBlock}

ВАЖНО: не превращай текст в набор коротких рубленых фраз ради «живости» — соблюдай рамки ритма выше.

HTML:
${content}`;
        const opusBefore = metricsOf(content);
        // Opus regularly takes 60-100s. 90s hit timeout in both real runs today;
        // bump to 120s. If this still times out consistently, the step should
        // be removed entirely (see improve_last.score_history).
        const opusRes = await callOpenRouterEx("anthropic/claude-opus-4", sysOpus, usrOpus, orKey, 6000, 120_000);
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
        // NOTE: Sonnet fallback removed — real telemetry shows the fallback
        // was the actual 60s timeout culprit ("timeout: Timed out after
        // 60000ms" in trace) and Sonnet redoing Sonnet-work adds no value.
        // If Opus itself fails, we skip the micro-pass and log the reason;
        // the humanize.sonnet pass already ran above.
        if (opusApplied) {
          await scoreCandidate(content, "humanize.opus");
        }
        recordPass({
          step: "humanize.opus",
          model: "anthropic/claude-opus-4",
          blocks: {
            validators: validatorTasks.length > 0,
            rhythm: sentenceTooShort ? "lengthen" : "normal",
            opus_micro_pass: true,
            fallback: null,
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
    await checkStopFlag("humanize");

    // 2) Keyword density: overuse → remove every 3rd; underuse → ask LLM to insert 2-3 times
    if (!stoppedByUser && (phase === "humanize" || phase === "all") && primaryKeyword && dStatus === "overuse") {
      content = removeEveryNthKeyword(content, primaryKeyword, 3);
    } else if (!stoppedByUser && (phase === "humanize" || phase === "all") && primaryKeyword && dStatus === "underuse" && (orKey || lovableKey)) {
      const sys = "Ты редактор. Встраиваешь ключевое слово в текст с полной грамматической адаптацией. Возвращаешь только итоговый HTML.";
      const usr = `Встрой фразу "${primaryKeyword}" органично в 2-3 места текста.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ВСТРАИВАНИЯ:
- Ключ склоняется по падежу, числу и роду под грамматику предложения. Именительный падеж посреди фразы ЗАПРЕЩЁН.
- Пример дефекта: "купить минитрактор цена приятная" / "китайский минитрактор отзывы это подтверждают". Так нельзя.
- Правильно: "Цена на минитрактор из Китая приятная", "Отзывы владельцев китайских минитракторов это подтверждают", "Стоимость минитрактора невысокая".
- Если ключ не встраивается грамматически естественно в конкретное место — пропусти это место, не втыкай в сыром виде.
- Не меняй факты, цифры, бренды. Сохрани все HTML-теги. Верни только исправленный HTML.

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
    await checkStopFlag("keyword_density");

    // 3) Burstiness fix: split long sentences (JS post-processor)
    if (!stoppedByUser && (phase === "humanize" || phase === "all") && (burstStatus === "fail" || burstStatus === "warning")) {
      // Apply only to text inside <p>/<li> blocks
      content = content.replace(/(<(?:p|li)[^>]*>)([\s\S]*?)(<\/(?:p|li)>)/gi, (_m, open, inner, close) => {
        return `${open}${splitLongSentences(inner)}${close}`;
      });
    }

    // 4) Turgenev (Yandex Baden-Baden) fix when status = fail (RU only, needs OpenRouter)
    const turgStatus = String((art as any).turgenev_status || "ok");
    const isRu = String((art as any).language || "ru").toLowerCase() === "ru";
    if (!stoppedByUser && (phase === "turgenev" || phase === "all") && turgStatus === "fail" && isRu && orKey) {
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
    await checkStopFlag("turgenev");

    // 5) Sentence-structure fix: чиним «телеграфный» стиль —
    //    серии 3+ коротких подряд, низкая средняя длина, перекос коротких.
    if (!stoppedByUser && (phase === "sentence" || phase === "all") && orKey) {
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
    await checkStopFlag("sentence");
    if (!stoppedByUser && (phase === "dangling" || phase === "all") && orKey) {
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
    await checkStopFlag("dangling");
    if (!stoppedByUser && (phase === "cancellary" || phase === "all") && orKey) {
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
    await checkStopFlag("cancellary");
    if (!stoppedByUser && (phase === "keyword_freq" || phase === "all") && orKey) {
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
    // One final stop check before we potentially spend more LLM calls on
    // best-candidate scoring or the nominative-keyword micro-pass.
    await checkStopFlag("pre_finalize");
    // Score the FINAL post-pipeline state (structural steps 2-8 run after
    // humanize and may have moved the needle); pick the best-scoring version.
    if (!stoppedByUser && content !== bestContent) {
      try { await scoreCandidate(content, "final"); } catch (_) { /* non-critical */ }
    }
    // ── Nominative-keyword micro-pass ────────────────────────────────
    // Post-humanize sanity check: catch raw keyword injections like
    // "минитрактор цена приятная" / "китайский минитрактор отзывы это
    // подтверждают" that slipped through the humanize prompt. Runs one
    // focused Sonnet pass on the flagged sentences; guarded by htmlIntegrity.
    let nominativeHits: string[] = [];
    try {
      nominativeHits = (!stoppedByUser && primaryKeyword) ? detectNominativeKeywordHits(bestContent, primaryKeyword) : [];
    } catch { nominativeHits = []; }
    if (!stoppedByUser && nominativeHits.length && orKey) {
      const nomBefore = metricsOf(bestContent);
      const sysNom =
        "Ты редактор. Задача — исправить сырые вставки ключевого слова в именительном падеже. " +
        "Сохраняешь все HTML-теги, факты, цифры, ссылки. Возвращаешь только итоговый HTML без markdown-обёрток.";
      const usrNom = `В тексте ниже ключевое слово "${primaryKeyword}" вставлено в именительном падеже без согласования.
Перепиши ТОЛЬКО эти конкретные предложения так, чтобы ключ склонялся по падежу/числу и встраивался в естественную грамматику.
Пример дефекта: "детали на полке, китайский минитрактор отзывы владельцев это подтверждают".
Правильно: "детали на полке, что подтверждают отзывы владельцев китайских минитракторов".

Дефектные предложения (нужно переписать):
${nominativeHits.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Верни ВЕСЬ исходный HTML целиком с исправленными местами. Не удаляй и не добавляй теги, не меняй факты/цифры/ссылки, остальной текст оставь как есть.

HTML:
${bestContent}`;
      const nomRes = await callOpenRouterEx("anthropic/claude-sonnet-4", sysNom, usrNom, orKey, 6000, 90_000);
      const polished = nomRes.content;
      let nomApplied = false;
      let nomIntegrity: { ok: boolean; reason?: string } | null = null;
      let nomMetrics: ReturnType<typeof metricsOf> | null = null;
      if (polished && polished.length > 200) {
        const cand = polished.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
        nomMetrics = metricsOf(cand);
        const integ = htmlIntegrityOk(bestContent, cand);
        nomIntegrity = integ;
        if (integ.ok) {
          // Verify the fix actually removed injections; accept only if hits ↓.
          const remaining = detectNominativeKeywordHits(cand, primaryKeyword);
          if (remaining.length < nominativeHits.length) {
            bestContent = cand;
            nomApplied = true;
            try { await scoreCandidate(bestContent, "keyword.nominative"); } catch (_) { /* non-critical */ }
          }
        }
      }
      recordPass({
        step: "keyword.nominative",
        model: "anthropic/claude-sonnet-4",
        blocks: { hits_before: nominativeHits.length, keyword: primaryKeyword },
        metrics_before: nomBefore,
        metrics_llm: nomMetrics,
        integrity: nomIntegrity,
        applied: nomApplied,
        llm_bytes: polished ? polished.length : 0,
        llm_null: !polished,
        llm_null_reason: !polished ? (nomRes.error || "unknown") : null,
        llm_duration_ms: nomRes.duration_ms,
        prompt: { system: sysNom, user: usrNom, user_bytes: usrNom.length },
      });
    }
    // Cosmetic normalization (last step, always): H2/H3/H4 первая буква — заглавная,
    // пробел после точки перед заглавной буквой ("гараж.Резко" → "гараж. Резко").
    const contentToPersist = cosmeticNormalize(bestContent);
    // Meta description — из БД, отдельная нормализация (пробелы после точек + удаление переносов).
    const rawMeta = (art as any).meta_description as string | null | undefined;
    const normalizedMeta = rawMeta ? normalizeMetaDescription(rawMeta) : null;
    const prevDetails = (art as any).quality_details && typeof (art as any).quality_details === "object"
      ? (art as any).quality_details : {};
    const metricsFinal = metricsOf(contentToPersist);
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
      llm_null_reason: t.llm_null_reason ?? null,
      llm_duration_ms: t.llm_duration_ms ?? null,
    }));
    // hasBestScore теперь != "bestScore > 0". Раньше при no_progress-цикле
    // (все проходы отвергнуты integrity) bestScore оставался инициализирующим
    // нулём, hasBestScore=false, ai_score в БД не писался → панель показывала
    // "Нет данных". Теперь достаточно, чтобы судьи вернули хотя бы одну
    // численную оценку — даже если она == 0.
    const hasRealJudgeScore = scoreHistory.some((s) => typeof s.score === "number");
    const hasBestScore = hasRealJudgeScore && Number.isFinite(bestScore);
    const qualityDetailsNext = {
      ...prevDetails,
      ai_internal_reasons: bestReasons.gemini,
      ai_claude_reasons: bestReasons.claude,
      improve_last: {
        status: stoppedByUser ? "stopped_by_user" : "ok",
        ...(stoppedByUser ? { stopped_at_step: stoppedAtStep } : {}),
        phase,
        at: new Date().toISOString(),
        metrics_before: metricsInitial,
        metrics_after: metricsFinal,
        applied_steps: appliedSteps,
        integrity_rejections: integrityRejections,
        trace: traceSummary,
        best_pick: {
          label: bestLabel,
          score: bestScore,
          parts: bestParts,
          reasons: bestReasons,
          entry_score: Number(art.ai_score ?? 0),
        },
        score_history: scoreHistory,
      },
      improve_error: null,
    };
    await admin.from("articles").update({
      content: contentToPersist,
      // If stopped by user — release the status immediately; no re-check will run.
      // In cycle mode — keep 'improving' so the cycle orchestrator can decide.
      quality_status: stoppedByUser ? null : (cycleMode ? "improving" : "checking"),
      seo_improve_count: nextImproveCount,
      // Persist the score already produced by the improve judges. The dashboard
      // no longer depends on a separate quality-check worker to fill ai_score.
      ...(hasBestScore ? {
        ai_score: bestScore,
        ai_human_score: bestScore,
        ...(typeof bestParts.gemini === "number" ? { ai_score_internal: bestParts.gemini } : {}),
        ...(typeof bestParts.claude === "number" ? { ai_score_claude: bestParts.claude } : {}),
      } : {}),
      quality_details: qualityDetailsNext,
      // Clear the stop flag on the way out so the next cycle starts clean.
      improve_stop_requested: false,
      ...(normalizedMeta && normalizedMeta !== rawMeta ? { meta_description: normalizedMeta } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", article_id);

    // Dispatch the full quality-check as a follow-up only. The primary AI
    // score is already persisted above from the improve judges, so the UI no
    // longer depends on this re-check surviving the background worker.
    // In cycle mode this dispatch is SKIPPED — the cycle orchestrator handles
    // scoring and any Turgenev/dangling autofixes; running quality-check here
    // would trigger a zombie inline improve-article (source=auto_dangling)
    // that races the next cycle pass.
    const reCheck = (stoppedByUser || cycleMode) ? Promise.resolve() : (async () => {
      try {
        await admin.from("pipeline_events").insert({
          stage: "quality_check",
          user_id: user.id,
          article_id,
          verdict: "warning",
          duration_ms: elapsed(),
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0,
          meta: { event: "quality_check/started", source: "improve-article-inline", best_pick: { label: bestLabel, score: bestScore, parts: bestParts } },
        });
        const apiKey = Deno.env.get("OPENROUTER_API_KEY");
        if (!apiKey) {
          console.warn("[improve-article] runAutoQuality skipped: no OPENROUTER_API_KEY");
          await admin.from("articles").update({ quality_status: null }).eq("id", article_id);
          return;
        }
        const resp = await fetch(`${supabaseUrl}/functions/v1/quality-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: authHeader },
          body: JSON.stringify({ article_id, content: contentToPersist, mode: "auto", dispatched_by: "improve" }),
        });
        if (!resp.ok) throw new Error(`quality-check dispatch HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      } catch (e) {
        console.error("[improve-article] inline quality-check failed", e);
        // Unlock the "checking" flag so the client stops spinning.
        try {
          await admin.from("articles").update({ quality_status: null }).eq("id", article_id);
        } catch (_) { /* ignore */ }
        try {
          await admin.from("pipeline_events").insert({
            stage: "quality_check",
            user_id: user.id,
            article_id,
            verdict: "fail",
            duration_ms: elapsed(),
            tokens_in: 0,
            tokens_out: 0,
            cost_usd: 0,
            error_kind: "exception",
            error_message: ((e as Error)?.message || String(e)).slice(0, 500),
            meta: { event: "quality_check/fail", source: "improve-article-inline" },
          });
        } catch (_) { /* ignore */ }
      }
    })();
    // We are already inside the improve waitUntil task. Await the inline
    // re-check here; a nested waitUntil can be dropped when the parent task
    // returns, which is exactly how the previous quality pass disappeared.
    await reCheck;

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
        metrics_after: metricsOf(contentToPersist),
        applied_steps: trace.filter((t) => t.applied).map((t) => t.step),
        integrity_rejections: integrityRejections,
        best_pick: { label: bestLabel, score: bestScore, entry_score: Number(art.ai_score ?? 0) },
        score_history: scoreHistory,
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

// ──────────────────────────────────────────────────────────────────────
// Server-side improve CYCLE — RELAY architecture. Each worker executes
// exactly ONE pass (humanize OR turgenev, plus candidate judges) — this
// keeps a single worker to ~1.5-2.5min, well below the ~400s waitUntil
// ceiling. If more passes are needed, the worker fire-and-forget POSTs
// to itself with an incremented pass_index and exits. The full cycle
// state lives in articles.quality_details.cycle_progress:
//   { status, pass, of, action, sub_step, started_at, pass_started_at,
//     updated_at, finished_at, initial:{ai,turg,content},
//     best:{ai,turg,content}, priority, no_progress_streak, final_status,
//     error }
// Any worker on start reads state, checks improve_stop_requested and the
// 3-min stuck-guard, then runs its pass or finalizes.
// ──────────────────────────────────────────────────────────────────────
interface CycleArgs {
  // deno-lint-ignore no-explicit-any
  admin: any;
  supabaseUrl: string;
  article_id: string;
  user: { id: string };
  art: any;
  initialContent: string;
  orKey: string | undefined;
  lovableKey: string | undefined;
  authHeader: string;
  elapsed: () => number;
  source: string | undefined;
  bypassLimits: boolean;
  priority: "auto" | "ai" | "turgenev";
  /** 1 = first pass (or new cycle); 2+ = relay from a previous worker. */
  passIndex: number;
  /** Needed to fire the next relay POST as a service-role internal call. */
  serviceKey: string;
}

const CYCLE_AI_TARGET = 70;
const CYCLE_TURG_TARGET = 5;
const CYCLE_MAX_PASSES = 2;
const cycleAiOk = (v: number | null) => v != null && v >= CYCLE_AI_TARGET;
const cycleTurgOk = (v: number | null) => v != null && v <= CYCLE_TURG_TARGET;

// deno-lint-ignore no-explicit-any
async function refreshCycleArt(admin: any, article_id: string): Promise<any> {
  const { data } = await admin.from("articles")
    .select("id,user_id,content,title,meta_description,keyword_id,keywords,ai_score,ai_score_internal,ai_score_claude,burstiness_status,keyword_density_status,keyword_density,last_improve_at,turgenev_status,turgenev_score,language,seo_improve_count,author_profile_id,quality_details,quality_status,improve_stop_requested")
    .eq("id", article_id).maybeSingle();
  return data as any;
}

async function writeCycleProgress(
  // deno-lint-ignore no-explicit-any
  admin: any,
  article_id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const cur = await refreshCycleArt(admin, article_id);
    const prevDetails = (cur?.quality_details && typeof cur.quality_details === "object") ? cur.quality_details : {};
    const prevProgress = (prevDetails.cycle_progress && typeof prevDetails.cycle_progress === "object") ? prevDetails.cycle_progress : {};
    await admin.from("articles").update({
      quality_details: {
        ...prevDetails,
        cycle_progress: { ...prevProgress, ...patch, updated_at: new Date().toISOString() },
      },
    }).eq("id", article_id);
  } catch (e) {
    console.warn("[improve-cycle] progress write failed", e);
  }
}

function decideCycleFix(
  scores: { ai: number | null; turg: number | null },
  priority: "auto" | "ai" | "turgenev",
): "humanize" | "turgenev" | null {
  const aiBad = !cycleAiOk(scores.ai);
  const turgBad = !cycleTurgOk(scores.turg);
  if (!aiBad && !turgBad) return null;
  if (priority === "ai") return aiBad ? "humanize" : null;
  if (priority === "turgenev") return turgBad ? "turgenev" : null;
  if (aiBad && !turgBad) return "humanize";
  if (turgBad && !aiBad) return "turgenev";
  return "humanize";
}

/** Fire-and-forget POST to self for the next relay pass. Never awaited. */
function relayNextPass(
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
): void {
  try {
    void fetch(`${supabaseUrl}/functions/v1/improve-article`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    }).catch((e) => console.warn("[improve-cycle] relay POST failed", (e as Error)?.message));
  } catch (e) {
    console.warn("[improve-cycle] relay throw", (e as Error)?.message);
  }
}

async function finalizeCycle(
  // deno-lint-ignore no-explicit-any
  admin: any,
  article_id: string,
  user: { id: string },
  priority: "auto" | "ai" | "turgenev",
  elapsed: () => number,
  finalStatus: "targets_met" | "stopped" | "balanced" | "no_progress" | "max_passes" | "error" | "timed_out",
  bestSnapshot: { content: string; ai: number | null; turg: number | null },
  initialSnap: { ai: number | null; turg: number | null; content: string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  // Restore best content if a later pass regressed.
  const finalArt = await refreshCycleArt(admin, article_id);
  if (finalArt && bestSnapshot.content && finalArt.content !== bestSnapshot.content) {
    try {
      await admin.from("articles")
        .update({ content: bestSnapshot.content, updated_at: new Date().toISOString() })
        .eq("id", article_id);
    } catch (_) {}
  }
  await writeCycleProgress(admin, article_id, {
    status: finalStatus === "stopped" ? "stopped" : (finalStatus === "error" || finalStatus === "timed_out" ? "error" : "done"),
    final_status: finalStatus,
    best: bestSnapshot,
    initial: initialSnap,
    sub_step: null,
    finished_at: new Date().toISOString(),
    ...extra,
  });
  try {
    await admin.from("articles")
      .update({ quality_status: null, improve_stop_requested: false })
      .eq("id", article_id);
  } catch (_) {}
  logPipelineEvent({
    stage: "improve",
    user_id: user.id,
    article_id,
    verdict: finalStatus === "error" || finalStatus === "timed_out" ? "fail" : "pass",
    duration_ms: elapsed(),
    meta: {
      event: "cycle_summary",
      final_status: finalStatus,
      initial: { ai: initialSnap.ai, turg: initialSnap.turg },
      best: { ai: bestSnapshot.ai, turg: bestSnapshot.turg },
      priority,
    },
  });
}

async function runImproveCycleStep(args: CycleArgs): Promise<void> {
  const { admin, supabaseUrl, article_id, user, orKey, lovableKey, authHeader, elapsed, source, bypassLimits, priority, passIndex, serviceKey } = args;

  // ── Load / initialize cycle state ─────────────────────────────────
  let art = await refreshCycleArt(admin, article_id);
  if (!art) return;
  const prevDetails = (art.quality_details && typeof art.quality_details === "object") ? art.quality_details : {};
  const prevProgress = (prevDetails.cycle_progress && typeof prevDetails.cycle_progress === "object") ? prevDetails.cycle_progress : {};

  const isFirstPass = passIndex <= 1;

  // Initial snapshot: for pass 1 we take it from the current article; for
  // pass 2+ we read it back from cycle_progress so we don't lose the true
  // starting point across workers.
  const initialSnap: { ai: number | null; turg: number | null; content: string } = isFirstPass
    ? {
        ai: (art.ai_score as number | null) ?? null,
        turg: (art.turgenev_score as number | null) ?? null,
        content: (art.content as string) || args.initialContent,
      }
    : {
        ai: (prevProgress.initial?.ai ?? null) as number | null,
        turg: (prevProgress.initial?.turg ?? null) as number | null,
        content: (prevProgress.initial?.content ?? (art.content as string) ?? args.initialContent) as string,
      };

  let bestSnapshot: { content: string; ai: number | null; turg: number | null } = isFirstPass
    ? {
        content: (art.content as string) || args.initialContent,
        ai: (art.ai_score as number | null) ?? null,
        turg: (art.turgenev_score as number | null) ?? null,
      }
    : {
        content: (prevProgress.best?.content ?? (art.content as string) ?? args.initialContent) as string,
        ai: (prevProgress.best?.ai ?? null) as number | null,
        turg: (prevProgress.best?.turg ?? null) as number | null,
      };

  let noProgressStreak = Number(prevProgress.no_progress_streak ?? 0);

  // Write "we're alive, starting pass N" progress up front.
  await writeCycleProgress(admin, article_id, {
    status: "running",
    pass: passIndex,
    of: CYCLE_MAX_PASSES,
    action: null,
    sub_step: "Оценка состояния",
    ...(isFirstPass ? { started_at: new Date().toISOString(), initial: initialSnap, priority, best: bestSnapshot, no_progress_streak: 0 } : {}),
    pass_started_at: new Date().toISOString(),
  });

  try {
    // ── Stop flag between workers ────────────────────────────────────
    if (art.improve_stop_requested) {
      return finalizeCycle(admin, article_id, user, priority, elapsed, "stopped", bestSnapshot, initialSnap);
    }

    // ── Decide what to fix this pass ─────────────────────────────────
    const curScores = { ai: art.ai_score as number | null, turg: art.turgenev_score as number | null };
    const fix = decideCycleFix(curScores, priority);
    if (!fix) {
      return finalizeCycle(admin, article_id, user, priority, elapsed, "targets_met", bestSnapshot, initialSnap);
    }

    const preContent = (art.content as string) || "";
    const preScores = { ...curScores };

    await writeCycleProgress(admin, article_id, {
      status: "running",
      pass: passIndex,
      of: CYCLE_MAX_PASSES,
      action: fix,
      sub_step: fix === "humanize" ? "Гуманизация (Sonnet)" : "Тургенев-фикс",
    });

    // ── ONE pass ─────────────────────────────────────────────────────
    try {
      await runImprovePipeline({
        admin, supabaseUrl, article_id, user,
        phase: fix,
        art,
        initialContent: preContent,
        primaryKeywordSeed: null,
        orKey, lovableKey,
        authHeader,
        elapsed,
        source: `cycle:${source ?? "ui"}`,
        bypassLimits,
        cycleMode: true,
        reportSubStep: async (label) => {
          await writeCycleProgress(admin, article_id, { sub_step: label });
        },
      });
    } catch (e) {
      console.error("[improve-cycle] pass exception", passIndex, e);
      // fall through — the pipeline logs its own failure; we still try to
      // read post-scores and either continue or finalize with best.
    }

    art = await refreshCycleArt(admin, article_id);
    if (!art) return finalizeCycle(admin, article_id, user, priority, elapsed, "error", bestSnapshot, initialSnap);

    const postScores = { ai: art.ai_score as number | null, turg: art.turgenev_score as number | null };

    // Rollback rule (mirrors the previous heuristic).
    const turgWorseBig = fix === "humanize" && postScores.turg != null && preScores.turg != null && postScores.turg > preScores.turg + 2;
    const aiWorseBig = fix === "turgenev" && postScores.ai != null && preScores.ai != null && postScores.ai < preScores.ai - 3;
    if (turgWorseBig || aiWorseBig) {
      try {
        await admin.from("articles")
          .update({ content: preContent, updated_at: new Date().toISOString() })
          .eq("id", article_id);
      } catch (_) {}
      await writeCycleProgress(admin, article_id, {
        pass: passIndex, action: fix, rolled_back: true,
        rollback_reason: turgWorseBig ? "turgenev_rose" : "ai_dropped",
      });
      return finalizeCycle(admin, article_id, user, priority, elapsed, "balanced", bestSnapshot, initialSnap);
    }

    // Update best snapshot.
    const currentIsBetter =
      (postScores.ai ?? 0) > (bestSnapshot.ai ?? 0) ||
      ((postScores.ai ?? 0) === (bestSnapshot.ai ?? 0) && (postScores.turg ?? 999) < (bestSnapshot.turg ?? 999));
    if (currentIsBetter) {
      bestSnapshot = { content: (art.content as string) || preContent, ai: postScores.ai, turg: postScores.turg };
    }

    // Persist bestSnapshot BEFORE any relay so the next worker can read it.
    await writeCycleProgress(admin, article_id, {
      best: bestSnapshot,
      initial: initialSnap,
    });

    // Targets met?
    if (cycleAiOk(postScores.ai) && cycleTurgOk(postScores.turg)) {
      return finalizeCycle(admin, article_id, user, priority, elapsed, "targets_met", bestSnapshot, initialSnap);
    }

    // Progress tracking.
    const targetImproved = fix === "humanize"
      ? (postScores.ai != null && preScores.ai != null && postScores.ai > preScores.ai)
      : (postScores.turg != null && preScores.turg != null && postScores.turg < preScores.turg);
    if (!targetImproved) {
      noProgressStreak++;
      if (noProgressStreak >= 2) {
        return finalizeCycle(admin, article_id, user, priority, elapsed, "no_progress", bestSnapshot, initialSnap);
      }
    } else {
      noProgressStreak = 0;
    }
    await writeCycleProgress(admin, article_id, { no_progress_streak: noProgressStreak });

    // Max passes reached?
    if (passIndex >= CYCLE_MAX_PASSES) {
      return finalizeCycle(admin, article_id, user, priority, elapsed, "max_passes", bestSnapshot, initialSnap);
    }

    // ── Hand off to the next relay worker ────────────────────────────
    // Keep quality_status='improving' so the UI stays in "running" mode
    // through the tiny gap between workers.
    try { await admin.from("articles").update({ quality_status: "improving" }).eq("id", article_id); } catch (_) {}
    await writeCycleProgress(admin, article_id, {
      status: "running",
      pass: passIndex,
      sub_step: "Передача следующему воркеру",
    });
    relayNextPass(supabaseUrl, serviceKey, {
      article_id,
      cycle: true,
      pass_index: passIndex + 1,
      user_id: user.id,
      source: "cycle_relay",
      priority,
    });
    logPipelineEvent({
      stage: "improve", user_id: user.id, article_id, verdict: "pass",
      duration_ms: elapsed(),
      meta: { event: "cycle_relay_dispatched", from_pass: passIndex, to_pass: passIndex + 1, best: { ai: bestSnapshot.ai, turg: bestSnapshot.turg } },
    });
  } catch (e: any) {
    console.error("[improve-cycle] fatal", e);
    const msg = (e?.message || String(e)).slice(0, 400);
    return finalizeCycle(admin, article_id, user, priority, elapsed, "error", bestSnapshot, initialSnap, { error: msg });
  }
}