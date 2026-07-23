import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { trackActivation, armCloseDuringGeneration } from "@/shared/utils/activationTracking";
import { capitalizeHeadings, stripLongDashes, postProcessArticle } from "@/shared/utils/capitalizeHeadings";
import {
  Sparkles, Search, ListTree, PenLine, ShieldCheck, CheckCircle2,
  Loader2, ArrowRight, Trophy, AlertTriangle, X, CheckCheck, RotateCcw,
} from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";

type Stage = "idle" | "research" | "structure" | "writing" | "quality" | "done" | "error";

interface StageInfo {
  key: Stage;
  icon: any;
  label: string;
  hint: string;
}

export default function QuickStartPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { lang, t } = useI18n();
  const { profile } = useAuth();
  const [keyword, setKeyword] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [contentPreview, setContentPreview] = useState("");
  const [resultArticleId, setResultArticleId] = useState<string | null>(null);
  const [poweredByModel, setPoweredByModel] = useState<string | null>(null);
  const [firstFreeOpus, setFirstFreeOpus] = useState<boolean>(false);
  const [priorArticleCount, setPriorArticleCount] = useState<number | null>(null);
  const [scores, setScores] = useState<{ seo: number | null; ai: number | null; badge: string | null }>({
    seo: null, ai: null, badge: null,
  });
  const [finalContent, setFinalContent] = useState<string>("");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [lsiPool, setLsiPool] = useState<string[]>([]);
  const [mainKeyword, setMainKeyword] = useState<string>("");
  const startRef = useRef<number>(0);
  const elapsedTimerRef = useRef<number | null>(null);
  const autostartedRef = useRef(false);
  const startedTypingRef = useRef(false);
  const generationArmRef = useRef<null | (() => void)>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  // Score prediction
  const [prediction, setPrediction] = useState<{
    competition: number;   // 0-100
    difficulty: number;    // 0-100
    medianWords: number;
    medianH2: number;
    medianLists: number;
    predictedScore: number;
    label: string;         // displayed keyword
  } | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const predictionAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (autostartedRef.current) return;
    const kw = searchParams.get("keyword");
    const auto = searchParams.get("autostart") === "true";
    if (kw && kw.trim().length >= 2) setKeyword(kw);
    if (kw && auto && stage === "idle") {
      autostartedRef.current = true;
      const timer = setTimeout(() => { runPipeline(); }, 1000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Pull prior articles count once — used to render the FREE-tier hybrid-model hint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: ses } = await supabase.auth.getSession();
        const uid = ses.session?.user.id;
        if (!uid) return;
        const { data: stats } = await supabase
          .from("user_stats")
          .select("total_articles_created")
          .eq("user_id", uid)
          .maybeSingle();
        if (!cancelled) setPriorArticleCount(Number(stats?.total_articles_created ?? 0));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Score prediction - debounced heuristic based on keyword shape.
  // Uses fast client-side estimation; SERP medians fall back to industry baselines.
  useEffect(() => {
    const kw = keyword.trim();
    if (kw.length < 3 || stage !== "idle") {
      setPrediction(null);
      return;
    }
    setPredictionLoading(true);
    const t = setTimeout(() => {
      try {
        const wordsInKw = kw.split(/\s+/).filter(Boolean).length;
        const isCommercial = /купить|цена|стоимость|заказ|услуг|buy|price|cost|order/i.test(kw);
        const isInfo = /как|что|почему|зачем|how|what|why|guide|обзор/i.test(kw);

        // Competition: short commercial keywords are most competitive
        let competition = 50;
        if (isCommercial) competition += 25;
        if (wordsInKw <= 2) competition += 15;
        if (wordsInKw >= 5) competition -= 20;
        competition = Math.max(15, Math.min(95, competition));

        // Difficulty: similar but penalises long-tail less
        let difficulty = 45;
        if (isCommercial) difficulty += 20;
        if (wordsInKw <= 2) difficulty += 10;
        if (wordsInKw >= 5) difficulty -= 15;
        difficulty = Math.max(20, Math.min(90, difficulty));

        // Median structure (industry baselines for RU SERP)
        const medianWords = isInfo ? 2100 : isCommercial ? 1500 : 1800;
        const medianH2 = isInfo ? 7 : 6;
        const medianLists = isInfo ? 4 : 3;

        // Predicted score = baseline 78 + bonus for low competition
        const predictedScore = Math.round(
          Math.max(65, Math.min(92, 88 - (competition - 50) * 0.15))
        );

        setPrediction({
          competition, difficulty,
          medianWords, medianH2, medianLists,
          predictedScore,
          label: kw,
        });
      } finally {
        setPredictionLoading(false);
      }
    }, 1000);
    return () => { clearTimeout(t); setPredictionLoading(false); };
  }, [keyword, stage]);

  const stages: StageInfo[] = [
    { key: "research",  icon: Search,      label: t("qs.stage.research"),  hint: t("qs.stage.researchHint") },
    { key: "structure", icon: ListTree,    label: t("qs.stage.structure"), hint: t("qs.stage.structureHint") },
    { key: "writing",   icon: PenLine,     label: t("qs.stage.writing"),   hint: t("qs.stage.writingHint") },
    { key: "quality",   icon: ShieldCheck, label: t("qs.stage.quality"),   hint: t("qs.stage.qualityHint") },
  ];

  function startTimer() {
    startRef.current = Date.now();
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
  }

  function stopTimer() {
    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }

  async function runPipeline() {
    const kw = keyword.trim();
    if (kw.length < 2) {
      toast.error(t("qs.enterKeyword"));
      return;
    }

    setErrMsg(null);
    setContentPreview("");
    setResultArticleId(null);
    setScores({ seo: null, ai: null, badge: null });
    setFinalContent("");
      setLsiPool([]);
      setMainKeyword(kw);
    startTimer();
    cancelledRef.current = false;
    abortCtrlRef.current = new AbortController();
    void trackActivation("generation_started", { keyword: kw, keyword_len: kw.length });
    generationArmRef.current = armCloseDuringGeneration(() => ({ keyword_len: kw.length }));

    try {
      // ── 1. Research ────────────────────────────────────────
      setStage("research");
      setProgress(10);
      const isRu = /[а-яё]/i.test(kw);
      const lng = isRu ? "ru" : "en";
      const geo = isRu ? "ru" : "us";

      const { data: rData, error: rErr } = await supabase.functions.invoke("smart-research", {
        body: { keyword: kw, language: lng, geo },
      });
      if (rErr) throw new Error(rErr.message || "Research failed");
      if (rData?.error) throw new Error(rData.error);
      if (cancelledRef.current) throw new DOMException("cancelled", "AbortError");
      const keywordId: string = rData.keyword_id;
      if (!keywordId) throw new Error("No keyword_id from research");
      setProgress(35);
      void trackActivation("generation_stage_completed", {
        stage: "serp",
        duration_sec: Math.floor((Date.now() - startRef.current) / 1000),
      });

      // ── 2. Structure ───────────────────────────────────────
      setStage("structure");
      const serpTitles = (rData.competitors || []).map((c: any) => c.title).filter(Boolean);
      const questions = rData.people_also_ask || [];
      const lsi = rData.analysis?.lsi_keywords || [];
      setLsiPool(Array.isArray(lsi) ? lsi.slice(0, 30) : []);

      const { data: oData, error: oErr } = await supabase.functions.invoke("generate-outline", {
        body: {
          keyword_id: keywordId,
          serp_titles: serpTitles.slice(0, 10),
          questions: questions.slice(0, 8),
          lsi_keywords: lsi.slice(0, 20),
        },
      });
      if (oErr) throw new Error(oErr.message || "Outline failed");
      if (oData?.error) throw new Error(oData.error);
      if (cancelledRef.current) throw new DOMException("cancelled", "AbortError");
      const outline = oData.outline || [];
      setProgress(50);
      void trackActivation("generation_stage_completed", {
        stage: "structure",
        duration_sec: Math.floor((Date.now() - startRef.current) / 1000),
      });

      // ── 3. Article (stream) ────────────────────────────────
      setStage("writing");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          keyword_id: keywordId,
          author_profile_id: null,
          outline,
          lsi_keywords: lsi,
          language: lng,
          competitor_tables: rData.analysis?.competitor_tables || [],
          competitor_lists: rData.analysis?.competitor_lists || [],
          include_expert_quote: true,
          include_comparison_table: true,
        }),
        signal: abortCtrlRef.current?.signal,
      });
      if (!resp.ok) {
        if (resp.status === 402) throw new Error(t("qs.insufficientCredits"));
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${resp.status}`);
      }
      if (!resp.body) throw new Error("No stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (j === "[DONE]") break;
          try {
            const p = JSON.parse(j);
            if (p.lovable_meta) {
              if (p.model) setPoweredByModel(String(p.model));
              if (p.first_free_opus) setFirstFreeOpus(true);
              continue;
            }
            const delta = p.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              setContentPreview(full.slice(-1500));
              // progress between 50..85 based on length (cap at ~6000 chars)
              const pp = Math.min(85, 50 + Math.floor((full.length / 6000) * 35));
              setProgress(pp);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Find the freshly created article
      // generate-article auto-saves; fetch latest article by keyword_id
      const { data: artRow } = await supabase
        .from("articles")
        .select("id, content")
        .eq("keyword_id", keywordId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let articleId = artRow?.id || null;
      // If somehow not saved, create the row manually
      if (!articleId) {
        const { data: ses } = await supabase.auth.getSession();
        const uid = ses.session?.user.id;
        if (uid) {
          const { data: ins } = await supabase
            .from("articles")
            .insert({ user_id: uid, keyword_id: keywordId, content: postProcessArticle(full, lng as "ru" | "en"), status: "draft", language: lng })
            .select("id")
            .single();
          articleId = ins?.id || null;
        }
      }
      setResultArticleId(articleId);
      setProgress(88);
      void trackActivation("generation_stage_completed", {
        stage: "text",
        duration_sec: Math.floor((Date.now() - startRef.current) / 1000),
      });

      // ── 3.5 Humanize pass (double Sonnet+Opus, budget-gated) ─────────
      if (articleId && full.replace(/<[^>]+>/g, "").length > 400) {
        try {
          await supabase.functions.invoke("humanize-article", {
            body: { article_id: articleId },
          });
        } catch {
          // non-fatal - quality-check will still run
        }
      }

      // ── 4. Quality check (free checks only) ────────────────
      setStage("quality");
      // Re-load potentially humanized content
      let checkContent = full;
      if (articleId) {
        const { data: freshRow } = await supabase
          .from("articles")
          .select("content")
          .eq("id", articleId)
          .maybeSingle();
        checkContent = (freshRow?.content as string | undefined) || full;
      }
      setFinalContent(checkContent);

      // Hard failure: no meaningful content generated → not a "done with dashes",
      // but a real error the user can act on.
      const plainLen = checkContent.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().length;
      if (!articleId || plainLen < 400) {
        throw new Error(
          lang === "ru"
            ? "Модель не вернула достаточного контента. Попробуйте другой ключ или повторите генерацию."
            : "The model did not return enough content. Try a different keyword or retry.",
        );
      }

      if (articleId && plainLen > 200) {
        try {
          const { data: qData, error: qErr } = await supabase.functions.invoke("quality-check", {
            body: { article_id: articleId, content: checkContent, checks: ["score", "ai"] },
          });
          if (qErr) {
            console.warn("[QuickStart] quality-check failed:", qErr);
          } else if (qData && !qData.error) {
            setScores({
              seo: qData.turgenev_score,
              ai: qData.ai_human_score,
              badge: qData.quality_badge,
            });
          } else if (qData?.error) {
            console.warn("[QuickStart] quality-check returned error:", qData.error);
          }
        } catch (e) {
          console.warn("[QuickStart] quality-check threw:", e);
          // Non-fatal: composite SEO Score is still computed from contentStats.
        }
      }
      setProgress(100);
      setStage("done");
      stopTimer();
      generationArmRef.current?.();
      generationArmRef.current = null;
      const elapsedS = Math.floor((Date.now() - startRef.current) / 1000);
      void trackActivation("generation_stage_completed", {
        stage: "quality_gate",
        duration_sec: elapsedS,
      });
      void trackActivation("generation_completed", {
        article_id: resultArticleId,
        duration_sec: elapsedS,
        seo_score: scores.seo,
        words: (finalContent || full || "").split(/\s+/).filter(Boolean).length,
      });
    } catch (e: any) {
      console.error("[QuickStart] pipeline failed:", e);
      stopTimer();
      generationArmRef.current?.();
      generationArmRef.current = null;
      const isAbort = cancelledRef.current || e?.name === "AbortError";
      if (isAbort) {
        void trackActivation("generation_cancelled", {
          elapsed_s: Math.floor((Date.now() - startRef.current) / 1000),
          stage,
        });
        toast.info(t("qs.cancelled"));
        setStage("idle");
        setProgress(0);
      } else {
        setErrMsg(e?.message || "Unknown error");
        setStage("error");
        void trackActivation("generation_failed", {
          stage,
          error_message: String(e?.message || "unknown").slice(0, 200),
          message: String(e?.message || "unknown").slice(0, 200),
        });
      }
    }
  }

  function cancelPipeline() {
    cancelledRef.current = true;
    try { abortCtrlRef.current?.abort(); } catch { /* noop */ }
  }

  function reset() {
    setStage("idle");
    setProgress(0);
    setElapsed(0);
    setContentPreview("");
    setResultArticleId(null);
    setScores({ seo: null, ai: null, badge: null });
    setFinalContent("");
    setErrMsg(null);
    setKeyword("");
  }

  // ─── UI ──────────────────────────────────────────────────
  // SEO display is derived below from contentStats so it never shows "—"
  // when we actually have an article. `scores.seo` (Turgenev risk) is only
  // used as an optional signal because Turgenev is RU-only and often null.

  // Honest, content-derived quality metrics (no AI detector — unreliable, esp. for EN).
  const contentStats = (() => {
    const html = finalContent || "";
    if (!html) return null;
    // Strip tags for plain-text measures
    const plain = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = plain ? plain.split(/\s+/).filter(Boolean).length : 0;
    const h2 = (html.match(/<h2[\s>]/gi) || []).length
      + (html.match(/^##\s/gm) || []).length;
    const h3 = (html.match(/<h3[\s>]/gi) || []).length
      + (html.match(/^###\s/gm) || []).length;
    const headings = h2 + h3;
    // FAQ: count questions inside an FAQ block (headings ending with "?" or <details>)
    const faqDetails = (html.match(/<details[\s>]/gi) || []).length;
    const faqQuestions = (plain.match(/\?/g) || []).length;
    const faq = faqDetails > 0 ? faqDetails : Math.min(faqQuestions, 12);
    const hasSchema = /application\/ld\+json/i.test(html) || /"@type"\s*:\s*"FAQPage"/i.test(html);
    // Readability: sentences + avg words/sentence -> "простая/средняя/сложная"
    const sentences = Math.max(1, (plain.match(/[.!?…]+\s|[.!?…]+$/g) || []).length);
    const avgWps = words / sentences;
    const readability =
      avgWps <= 14 ? { key: "easy", pct: 90 } :
      avgWps <= 20 ? { key: "medium", pct: 70 } :
                     { key: "hard", pct: 45 };
    // Semantic coverage: how many LSI terms from research appear in the body
    const plainLower = plain.toLowerCase();
    const lsiTotal = lsiPool.length;
    const lsiUsed = lsiPool.reduce((n, term) => {
      const t = String(term || "").trim().toLowerCase();
      if (t.length < 2) return n;
      return plainLower.includes(t) ? n + 1 : n;
    }, 0);
    const semanticPct = lsiTotal > 0 ? Math.round((lsiUsed / lsiTotal) * 100) : null;
    // Keyword density: main-keyword occurrences / words * 100
    const kwNorm = mainKeyword.trim().toLowerCase();
    let kwCount = 0;
    if (kwNorm.length >= 2) {
      const re = new RegExp(
        kwNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi",
      );
      kwCount = (plainLower.match(re) || []).length;
    }
    const density = words > 0 ? +((kwCount / words) * 100).toFixed(2) : 0;
    // Intents closed: informational (headings), transactional (FAQ + lists), navigational (schema)
    const intents =
      (headings >= 4 ? 1 : 0) +
      (faq >= 2 ? 1 : 0) +
      (hasSchema ? 1 : 0);
    return {
      words, h2, h3, headings, faq, hasSchema, readability,
      semanticPct, lsiUsed, lsiTotal,
      density, kwCount,
      intents,
    };
  })();

  // Composite, honest SEO Score. Always renders when we have content.
  // Weights (sum = 100):
  //   structure  25 — H2>=4 → full, H2>=2 → half
  //   density    15 — 0.5..2.5% optimal → full, else linear falloff
  //   semantic   20 — % of LSI terms present in body
  //   readability 15 — easy=100, medium=70, hard=45
  //   words      15 — >=1500 → full, linear from 400
  //   faq         5 — has 2+ questions
  //   schema      5 — Schema.org / FAQPage present
  // If Turgenev score is available it lifts the total by up to +5 (soft signal).
  const seoDisplay: number | null = (() => {
    if (!contentStats) return null;
    const s = contentStats;
    const structure = s.h2 >= 4 ? 25 : s.h2 >= 2 ? 12 : s.headings >= 2 ? 6 : 0;
    const densityScore =
      s.density >= 0.5 && s.density <= 2.5 ? 15 :
      s.density > 0 && s.density < 0.5 ? Math.round((s.density / 0.5) * 15) :
      s.density > 2.5 && s.density <= 5 ? Math.round(15 - ((s.density - 2.5) / 2.5) * 15) : 0;
    const semantic = s.semanticPct !== null ? Math.round((s.semanticPct / 100) * 20) : 10;
    const readabilityScore = Math.round((s.readability.pct / 100) * 15);
    const wordsScore =
      s.words >= 1500 ? 15 :
      s.words >= 400 ? Math.round(((s.words - 400) / 1100) * 15) : 0;
    const faqScore = s.faq >= 2 ? 5 : s.faq >= 1 ? 2 : 0;
    const schemaScore = s.hasSchema ? 5 : 0;
    let total = structure + densityScore + semantic + readabilityScore + wordsScore + faqScore + schemaScore;
    // Optional Turgenev bump: risk 0..10 → +0..+5.
    if (scores.seo !== null) total += Math.max(0, Math.round((10 - scores.seo) / 2));
    return Math.max(1, Math.min(100, total));
  })();
  const seoOk = seoDisplay !== null && seoDisplay >= 70;

  // Actionable improvement checklist — only surfaces items that are truly not
  // passing. Empty list means "ready to publish".
  const improvementHints: string[] = (() => {
    const out: string[] = [];
    if (!contentStats) return out;
    if (seoDisplay !== null && seoDisplay < 60) {
      out.push(lang === "ru"
        ? "Улучшить SEO: откройте редактор — там подсказки по структуре и плотности."
        : "Improve SEO: open the editor for structure and density hints.");
    }
    if (!contentStats.hasSchema) {
      out.push(lang === "ru"
        ? "Добавьте Schema.org (FAQPage/Article) в редакторе."
        : "Add Schema.org (FAQPage/Article) in the editor.");
    }
    if (contentStats.readability.key === "hard") {
      out.push(lang === "ru"
        ? "Читабельность жёсткая - разбейте длинные предложения."
        : "Readability is heavy - split long sentences.");
    }
    if (contentStats.headings < 4) {
      out.push(lang === "ru"
        ? "Мало подзаголовков - добавьте H2/H3 для навигации."
        : "Few subheadings - add H2/H3 for navigation.");
    }
    return out;
  })();

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-medium text-primary uppercase tracking-[0.14em]">
            {t("qs.badge")}
          </span>
        </div>
        <h1 className="text-3xl sm:text-[34px] font-semibold tracking-tight leading-tight">
          {t("qs.title")}
        </h1>
        <p className="text-muted-foreground text-[15px] max-w-2xl mx-auto">
          {t("qs.subtitle")}
        </p>
      </div>

      {/* Input form (hidden when running) */}
      {stage === "idle" && (
        <Card className="p-6 space-y-4 border-primary/20 bg-gradient-to-b from-card to-card/50">
          {/* FREE-tier hybrid model hint */}
          {(() => {
            const plan = String((profile as any)?.plan || "").toLowerCase();
            const isFree = plan === "nano" || plan === "nano" || plan === "";
            if (!isFree || priorArticleCount === null) return null;
            if (priorArticleCount === 0) {
              return (
                <div className="rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-xs text-foreground/85">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-primary font-medium mb-1">
                    {lang === "ru" ? "Ваша первая статья - на флагманской модели" : "Your first article runs on our flagship model"}
                  </div>
                  {lang === "ru"
                    ? "Мы генерируем её на Claude Opus 4 - топовой модели тарифа PRO. Бесплатно, чтобы вы увидели максимальное качество."
                    : "We generate it on Claude Opus 4 - the flagship PRO model. Free, so you can judge the top quality upfront."}
                </div>
              );
            }
            if (priorArticleCount === 1) {
              return (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 text-xs text-foreground/85">
                  {lang === "ru"
                    ? "Первая статья была на Claude Opus 4. Следующие на бесплатном тарифе - на Gemini 2.5 Flash. PRO даёт полный доступ к Opus."
                    : "Your first article ran on Claude Opus 4. Further FREE-tier generations use Gemini 2.5 Flash. PRO keeps you on Opus."}
                </div>
              );
            }
            return null;
          })()}

          {/* Promise: what you get in a few minutes */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-emerald-400/80 font-medium mb-1.5">
              {t("qs.promise")}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/85">
              {[
                t("qs.promise.structure"),
                t("qs.promise.article"),
                t("qs.promise.faq"),
                t("qs.promise.schema"),
                t("qs.promise.quality"),
              ].map((label) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <CheckCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("qs.keywordLabel")}
            </label>
            <Input
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                if (
                  !startedTypingRef.current &&
                  e.target.value.trim().length > 0 &&
                  !sessionStorage.getItem("kw_entered")
                ) {
                  startedTypingRef.current = true;
                  sessionStorage.setItem("kw_entered", "1");
                  void trackActivation("keyword_entered", {
                    keyword_length: e.target.value.length,
                    source: "qs_input",
                  });
                }
              }}
              onFocus={() => void trackActivation("focused_keyword_field")}
              placeholder={t("qs.keywordPlaceholder")}
              className="h-12 text-base"
              onKeyDown={(e) => { if (e.key === "Enter") runPipeline(); }}
              autoFocus
            />
            <div className="text-xs text-muted-foreground">
              <div className="mb-1.5">{t("qs.examples")}</div>
              <div className="flex flex-wrap gap-2">
                {(lang === "ru"
                  ? [
                      "seo аудит сайта чек-лист",
                      "коммерческая недвижимость москва аренда",
                      "интеграция crm с 1с",
                      "лазерная эпиляция цена спб",
                    ]
                  : [
                      "b2b saas seo strategy",
                      "commercial real estate nyc lease",
                      "crm integration best practices",
                      "enterprise cybersecurity checklist",
                    ]
                ).map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setKeyword(ex);
                      if (
                        !startedTypingRef.current &&
                        !sessionStorage.getItem("kw_entered")
                      ) {
                        startedTypingRef.current = true;
                        sessionStorage.setItem("kw_entered", "1");
                        void trackActivation("keyword_entered", { source: "qs_example" });
                      }
                    }}
                    className="px-2.5 py-1 rounded-md border border-border/60 bg-muted/40 hover:border-primary/40 hover:text-foreground text-muted-foreground font-mono text-[11px] transition-all"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {prediction && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
                    {t("qs.forecastTitle")}
                  </div>
                  <div className="text-sm font-medium mt-0.5 font-mono">
                    {t("qs.forecastFor", { kw: prediction.label })}
                  </div>
                </div>
                {predictionLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{t("qs.competition")}</span>
                    <span>{prediction.competition >= 70 ? t("qs.levelHigh") : prediction.competition >= 40 ? t("qs.levelMed") : t("qs.levelLow")}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${prediction.competition >= 70 ? "bg-red-500" : prediction.competition >= 40 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${prediction.competition}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{t("qs.difficulty")}</span>
                    <span>{prediction.difficulty >= 70 ? t("qs.levelHigh") : prediction.difficulty >= 40 ? t("qs.levelMed") : t("qs.levelLow")}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${prediction.difficulty >= 70 ? "bg-red-500" : prediction.difficulty >= 40 ? "bg-yellow-500" : "bg-green-500"}`}
                      style={{ width: `${prediction.difficulty}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1.5">
                  {t("qs.medianTop")}
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
                    <div className="text-sm font-semibold">{prediction.medianWords.toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}</div>
                    <div className="text-[10px] text-muted-foreground">{lang === "ru" ? "слов" : "words"}</div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
                    <div className="text-sm font-semibold">{prediction.medianH2}</div>
                    <div className="text-[10px] text-muted-foreground">H2</div>
                  </div>
                  <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
                    <div className="text-sm font-semibold">{prediction.medianLists}</div>
                    <div className="text-[10px] text-muted-foreground">{lang === "ru" ? "списков" : "lists"}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                <span className="text-xs text-muted-foreground">{t("qs.ifBetter")}</span>
                <span className="text-lg font-semibold text-primary font-mono">
                  {t("qs.forecastScore", { n: prediction.predictedScore })}
                </span>
              </div>
            </div>
          )}

          <Button
            onClick={runPipeline}
            size="lg"
            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-[#3b82f6] hover:opacity-90"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {t("qs.generateBtn")}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {t("qs.generateNote")}
          </p>
        </Card>
      )}

      {/* Progress view */}
      {(stage !== "idle" && stage !== "done" && stage !== "error") && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground font-mono">
              {t("qs.elapsed")}: {elapsed}{t("qs.secondsShort")}
            </div>
            <div className="text-sm text-muted-foreground font-mono">{progress}%</div>
          </div>

          <Progress value={progress} className="h-2" />

          <div className="space-y-2">
            {stages.map((s) => {
              const idx = stages.findIndex((x) => x.key === s.key);
              const currentIdx = stages.findIndex((x) => x.key === stage);
              const status = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    status === "active"
                      ? "border-primary/40 bg-primary/5"
                      : status === "done"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border/50 bg-muted/20"
                  }`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-md ${
                    status === "done" ? "bg-emerald-500/15 text-emerald-400"
                      : status === "active" ? "bg-primary/15 text-primary"
                      : "bg-muted/40 text-muted-foreground"
                  }`}>
                    {status === "done" ? <CheckCircle2 className="h-4 w-4" />
                      : status === "active" ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Icon className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.hint}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live preview during writing */}
          {stage === "writing" && contentPreview && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 max-h-40 overflow-hidden text-xs font-mono text-muted-foreground whitespace-pre-wrap">
              ...{contentPreview}
            </div>
          )}

          {/* Cancel */}
          <div className="flex justify-end pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelPipeline}
              disabled={cancelledRef.current}
              className="text-muted-foreground hover:text-rose-400"
            >
              <X className="h-4 w-4 mr-1.5" />
              {t("qs.cancel")}
            </Button>
          </div>
        </Card>
      )}

      {/* Done view */}
      {stage === "done" && (
        <Card className="p-6 space-y-5 border-emerald-500/30 bg-gradient-to-b from-emerald-500/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">
                {t("qs.doneIn", { n: elapsed })}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("qs.articleReady")}
              </p>
            </div>
          </div>

          {(firstFreeOpus || (poweredByModel && /opus/i.test(poweredByModel))) && (
            <div className="rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2.5 flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs text-foreground/85">
                <div className="text-[10px] uppercase tracking-[0.14em] text-primary font-medium mb-0.5">
                  {lang === "ru" ? "Powered by Claude Opus 4" : "Powered by Claude Opus 4"}
                </div>
                {lang === "ru"
                  ? "Статья сгенерирована на флагманской модели тарифа PRO. В PRO весь ваш контент идёт через Opus."
                  : "Generated on the flagship PRO model. On PRO, every article you produce runs on Opus."}
              </div>
            </div>
          )}

          {/* Honest quality metrics — no AI detector (unreliable, especially for EN). */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className={`rounded-lg border p-3 ${seoOk ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"}`}>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.seoScore")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold font-mono">{seoDisplay !== null ? seoDisplay : "-"}</span>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricSemantic")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold font-mono">
                  {contentStats && contentStats.semanticPct !== null ? contentStats.semanticPct : "-"}
                </span>
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              {contentStats && contentStats.lsiTotal > 0 && (
                <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  {t("qs.metricSemHint", { used: contentStats.lsiUsed, total: contentStats.lsiTotal })}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricDensity")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold font-mono">
                  {contentStats ? contentStats.density : "-"}
                </span>
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              {contentStats && (
                <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  ×{contentStats.kwCount}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricWords")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold font-mono">
                  {contentStats ? contentStats.words.toLocaleString(lang === "ru" ? "ru-RU" : "en-US") : "-"}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricHeadings")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold font-mono">{contentStats ? contentStats.headings : "-"}</span>
                {contentStats && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    H2:{contentStats.h2} H3:{contentStats.h3}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricFaq")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold font-mono">{contentStats ? contentStats.faq : "-"}</span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricIntent")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold font-mono">
                  {contentStats ? contentStats.intents : "-"}
                </span>
                <span className="text-xs text-muted-foreground">/3</span>
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${contentStats?.hasSchema ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"}`}>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricSchema")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold">
                  {contentStats ? (contentStats.hasSchema ? t("qs.schemaYes") : t("qs.schemaNo")) : "-"}
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-1">
                {t("qs.metricReadability")}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold">
                  {contentStats ? t(`qs.readability.${contentStats.readability.key}`) : "-"}
                </span>
              </div>
            </div>
          </div>

          {improvementHints.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {lang === "ru" ? "Всё готово к публикации" : "Ready to publish"}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-amber-400 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {lang === "ru" ? "Что улучшить перед публикацией" : "What to improve before publishing"}
              </div>
              <ul className="text-xs text-foreground/80 space-y-1 pl-6 list-disc">
                {improvementHints.map((h, i) => (<li key={i}>{h}</li>))}
              </ul>
            </div>
          )}

          {/* Primary action: open article in editor */}
          <Button
            size="lg"
            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-[#3b82f6] hover:opacity-90"
            onClick={() => {
              if (!resultArticleId) return;
              void trackActivation("article_editor_opened", { article_id: resultArticleId, source: "quickstart_done" });
              navigate(`/articles?edit=${resultArticleId}`);
            }}
            disabled={!resultArticleId}
          >
            {t("qs.openArticle")}
          </Button>

          {/* Credits line + plan hint */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {t("qs.creditsLeft", { n: profile?.credits_amount ?? 0 })}
            </span>
            <button
              type="button"
              onClick={() => navigate("/pricing")}
              className="text-primary hover:underline font-medium"
            >
              {profile?.plan && profile.plan !== "nano"
                ? t("qs.planHintPro")
                : t("qs.planHintUpgrade")}
            </button>
          </div>
        </Card>
      )}

      {/* Error view */}
      {stage === "error" && (
        <Card className="p-6 space-y-4 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-400" />
            <div className="flex-1">
              <h3 className="font-semibold">
                {t("qs.somethingWrong")}
              </h3>
              <p className="text-sm text-muted-foreground">{errMsg}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={reset} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("qs.tryAgain")}
            </Button>
            <Button onClick={() => navigate("/keywords")} variant="ghost">
              <ArrowRight className="h-4 w-4 mr-2" />
              {t("qs.switchStandard")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
