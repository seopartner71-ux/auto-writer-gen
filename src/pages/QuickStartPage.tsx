import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import {
  Sparkles, Search, ListTree, PenLine, ShieldCheck, CheckCircle2,
  Loader2, ArrowRight, Pencil, Send, RotateCcw, Trophy, AlertTriangle, ThumbsUp,
} from "lucide-react";

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
  const [keyword, setKeyword] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [contentPreview, setContentPreview] = useState("");
  const [resultArticleId, setResultArticleId] = useState<string | null>(null);
  const [scores, setScores] = useState<{ seo: number | null; ai: number | null; badge: string | null }>({
    seo: null, ai: null, badge: null,
  });
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const startRef = useRef<number>(0);
  const elapsedTimerRef = useRef<number | null>(null);

  const stages: StageInfo[] = lang === "ru" ? [
    { key: "research",  icon: Search,      label: "Анализируем конкурентов", hint: "Сбор данных из ТОП-10 Google" },
    { key: "structure", icon: ListTree,    label: "Создаём структуру",       hint: "Подбор H1/H2/H3 на основе SERP" },
    { key: "writing",   icon: PenLine,     label: "Пишем статью",            hint: "Генерация в реальном времени" },
    { key: "quality",   icon: ShieldCheck, label: "Проверяем качество",      hint: "SEO Score и AI-детектор" },
  ] : [
    { key: "research",  icon: Search,      label: "Analyzing competitors", hint: "Collecting Top-10 Google data" },
    { key: "structure", icon: ListTree,    label: "Building structure",    hint: "Picking H1/H2/H3 from SERP" },
    { key: "writing",   icon: PenLine,     label: "Writing the article",   hint: "Live AI generation" },
    { key: "quality",   icon: ShieldCheck, label: "Quality check",         hint: "SEO Score and AI detector" },
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
      toast.error(lang === "ru" ? "Введите ключевое слово" : "Enter a keyword");
      return;
    }

    setErrMsg(null);
    setContentPreview("");
    setResultArticleId(null);
    setScores({ seo: null, ai: null, badge: null });
    startTimer();

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
      const keywordId: string = rData.keyword_id;
      if (!keywordId) throw new Error("No keyword_id from research");
      setProgress(35);

      // ── 2. Structure ───────────────────────────────────────
      setStage("structure");
      const serpTitles = (rData.competitors || []).map((c: any) => c.title).filter(Boolean);
      const questions = rData.people_also_ask || [];
      const lsi = rData.analysis?.lsi_keywords || [];

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
      const outline = oData.outline || [];
      setProgress(50);

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
      });
      if (!resp.ok) {
        if (resp.status === 402) throw new Error(lang === "ru" ? "Недостаточно кредитов" : "Insufficient credits");
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
            .insert({ user_id: uid, keyword_id: keywordId, content: full, status: "draft" })
            .select("id")
            .single();
          articleId = ins?.id || null;
        }
      }
      setResultArticleId(articleId);
      setProgress(88);

      // ── 4. Quality check (free checks only) ────────────────
      setStage("quality");
      if (articleId && full.replace(/<[^>]+>/g, "").length > 200) {
        try {
          const { data: qData } = await supabase.functions.invoke("quality-check", {
            body: { article_id: articleId, content: full, checks: ["score", "ai"] },
          });
          if (qData && !qData.error) {
            setScores({
              seo: qData.turgenev_score,
              ai: qData.ai_human_score,
              badge: qData.quality_badge,
            });
          }
        } catch {
          // non-fatal
        }
      }
      setProgress(100);
      setStage("done");
      stopTimer();
    } catch (e: any) {
      console.error("[QuickStart] pipeline failed:", e);
      stopTimer();
      setErrMsg(e?.message || "Unknown error");
      setStage("error");
    }
  }

  function reset() {
    setStage("idle");
    setProgress(0);
    setElapsed(0);
    setContentPreview("");
    setResultArticleId(null);
    setScores({ seo: null, ai: null, badge: null });
    setErrMsg(null);
    setKeyword("");
  }

  // ─── UI ──────────────────────────────────────────────────
  const seoOk = scores.seo !== null && scores.seo <= 4;
  const aiOk = scores.ai !== null && scores.ai >= 80;

  // Compute SEO display: convert risk (0-10) to "score 0-100"
  const seoDisplay = scores.seo !== null ? Math.max(0, 100 - scores.seo * 10) : null;

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary uppercase tracking-wider">
            {lang === "ru" ? "Быстрый старт" : "Quick Start"}
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {lang === "ru" ? "Статья за 60 секунд" : "Article in 60 seconds"}
        </h1>
        <p className="text-muted-foreground">
          {lang === "ru"
            ? "Введите ключевое слово - мы сами сделаем Research, структуру и текст"
            : "Enter a keyword - we'll handle research, structure, and content"}
        </p>
      </div>

      {/* Input form (hidden when running) */}
      {stage === "idle" && (
        <Card className="p-6 space-y-4 border-primary/20 bg-gradient-to-b from-card to-card/50">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {lang === "ru" ? "Ключевое слово" : "Keyword"}
            </label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={lang === "ru" ? "Например: как выбрать ноутбук" : "e.g. how to choose a laptop"}
              className="h-12 text-base"
              onKeyDown={(e) => { if (e.key === "Enter") runPipeline(); }}
              autoFocus
            />
          </div>
          <Button
            onClick={runPipeline}
            size="lg"
            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-[#3b82f6] hover:opacity-90"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {lang === "ru" ? "Создать статью автоматически" : "Generate article automatically"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {lang === "ru"
              ? "Спишется 1 кредит за статью. Структура и проверка качества бесплатно."
              : "1 credit per article. Structure and quality check are free."}
          </p>
        </Card>
      )}

      {/* Progress view */}
      {(stage !== "idle" && stage !== "done" && stage !== "error") && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground font-mono">
              {lang === "ru" ? "Прошло" : "Elapsed"}: {elapsed}{lang === "ru" ? "с" : "s"}
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
                {lang === "ru" ? `Готово за ${elapsed} секунд!` : `Done in ${elapsed} seconds!`}
              </h2>
              <p className="text-sm text-muted-foreground">
                {lang === "ru" ? "Ваша первая статья готова" : "Your first article is ready"}
              </p>
            </div>
          </div>

          {/* Score badges */}
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-lg border p-3 ${seoOk ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"}`}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                {lang === "ru" ? "SEO Score" : "SEO Score"}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{seoDisplay !== null ? seoDisplay : "-"}</span>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${aiOk ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card"}`}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                {lang === "ru" ? "AI-детектор" : "AI Detector"}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{scores.ai !== null ? scores.ai : "-"}</span>
                <span className="text-xs text-muted-foreground">% {lang === "ru" ? "человек" : "human"}</span>
              </div>
            </div>
          </div>

          {scores.badge === "excellent" && (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <Trophy className="h-4 w-4" />
              {lang === "ru" ? "Отлично - готово к публикации" : "Excellent - ready to publish"}
            </div>
          )}
          {scores.badge === "good" && (
            <div className="flex items-center gap-2 text-sm text-amber-400">
              <ThumbsUp className="h-4 w-4" />
              {lang === "ru" ? "Хорошо - можно публиковать" : "Good - can be published"}
            </div>
          )}
          {scores.badge === "needs_work" && (
            <div className="flex items-center gap-2 text-sm text-rose-400">
              <AlertTriangle className="h-4 w-4" />
              {lang === "ru" ? "Требует доработки" : "Needs work"}
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              onClick={() => resultArticleId && navigate(`/articles?edit=${resultArticleId}`)}
              disabled={!resultArticleId}
              className="bg-primary"
            >
              <Pencil className="h-4 w-4 mr-2" />
              {lang === "ru" ? "Редактировать" : "Edit"}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/wordpress")}
              disabled={!resultArticleId}
            >
              <Send className="h-4 w-4 mr-2" />
              {lang === "ru" ? "Опубликовать" : "Publish"}
            </Button>
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {lang === "ru" ? "Создать ещё" : "Create another"}
            </Button>
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
                {lang === "ru" ? "Что-то пошло не так" : "Something went wrong"}
              </h3>
              <p className="text-sm text-muted-foreground">{errMsg}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={reset} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />
              {lang === "ru" ? "Попробовать снова" : "Try again"}
            </Button>
            <Button onClick={() => navigate("/keywords")} variant="ghost">
              <ArrowRight className="h-4 w-4 mr-2" />
              {lang === "ru" ? "Перейти в обычный режим" : "Switch to standard mode"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
