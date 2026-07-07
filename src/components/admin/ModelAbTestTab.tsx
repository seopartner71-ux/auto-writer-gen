import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, FlaskConical, Zap, Trophy, ChevronDown, ChevronRight, Trash2, Download, Copy, History } from "lucide-react";
import { toast } from "sonner";
import { runAutoStealthPass } from "@/features/article-editor/autoStealthPass";

const CANDIDATE_MODELS = [
  { key: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (текущая)" },
  { key: "anthropic/claude-opus-4", label: "Claude Opus 4" },
  { key: "openai/gpt-5", label: "GPT-5" },
  { key: "openai/gpt-5-mini", label: "GPT-5 mini" },
  { key: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { key: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { key: "mistralai/mistral-large-2512", label: "Mistral Large 3" },
  { key: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { key: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
  { key: "qwen/qwen3.7-max", label: "Qwen3.7 Max" },
];

const DEFAULT_PROMPT = `Напиши SEO-статью на 400-500 слов на тему "Как выбрать беспроводные наушники для бега в 2026 году". Чистый HTML с <h2>, <p>, <ul>. Живой человеческий стиль, чередуй короткие и длинные предложения, без канцелярита.`;

const RAW_CONCURRENCY = 5;
const PIPELINE_CONCURRENCY = 2;

type Mode = "raw" | "pipeline";
type Stage = "idle" | "generating" | "inserting" | "stealth" | "reading" | "done" | "error";

interface RunResult {
  model: string;
  runIdx: number;
  ok: boolean;
  error?: string;
  elapsedMs: number;
  word_count?: number;
  ai_score?: number | null;
  verdict?: string | null;
  reasons?: string[];
  preview?: string;
  volumeFail?: boolean;
  html?: string;
  // pipeline additions
  articleId?: string;
  postAiScore?: number | null;
  postWordCount?: number;
  postPreview?: string;
  postHtml?: string;
  stage?: Stage;
  stageError?: string;
}

interface ModelAggregate {
  model: string;
  runs: RunResult[];
  counted: number;
  total: number;
  apiErrors: number;
  unscored: number;
  volumeFails: number;
  avgScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  avgMs: number;
  avgWords: number;
  avgPostScore: number | null;
  delta: number | null;
  stage?: Stage;
}

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

// Parses "400-500 слов" / "от 400 до 500 слов" from prompt. Returns { min, max } or null.
function parseWordRange(prompt: string): { min: number; max: number } | null {
  const m = prompt.match(/(\d{2,5})\s*[---]\s*(\d{2,5})\s*слов/i)
    || prompt.match(/от\s+(\d{2,5})\s+до\s+(\d{2,5})\s+слов/i);
  if (!m) return null;
  const min = parseInt(m[1], 10);
  const max = parseInt(m[2], 10);
  if (!isFinite(min) || !isFinite(max) || min <= 0 || max < min) return null;
  return { min, max };
}

function aggregate(model: string, runs: RunResult[], total: number, stage?: Stage): ModelAggregate {
  const scored = runs.filter((r) => r.ok && !r.volumeFail && typeof r.ai_score === "number") as (RunResult & { ai_score: number })[];
  const scores = scored.map((r) => r.ai_score);
  const avgScore = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
  const minScore = scores.length ? Math.min(...scores) : null;
  const maxScore = scores.length ? Math.max(...scores) : null;
  const okRuns = runs.filter((r) => r.ok);
  const avgMs = okRuns.length ? Math.round(okRuns.reduce((s, r) => s + r.elapsedMs, 0) / okRuns.length) : 0;
  const avgWords = okRuns.length ? Math.round(okRuns.reduce((s, r) => s + (r.word_count || 0), 0) / okRuns.length) : 0;
  const apiErrors = runs.filter((r) => !r.ok).length;
  const unscored = runs.filter((r) => r.ok && !r.volumeFail && (r.ai_score == null)).length;
  const volumeFails = runs.filter((r) => r.ok && r.volumeFail).length;
  const postScored = runs.filter((r) => r.ok && !r.volumeFail && typeof r.postAiScore === "number") as (RunResult & { postAiScore: number })[];
  const postScores = postScored.map((r) => r.postAiScore);
  const avgPostScore = postScores.length ? Math.round(postScores.reduce((s, v) => s + v, 0) / postScores.length) : null;
  const delta = avgScore != null && avgPostScore != null ? avgPostScore - avgScore : null;
  return { model, runs: runs.sort((a, b) => a.runIdx - b.runIdx), counted: scored.length, total, apiErrors, unscored, volumeFails, avgScore, minScore, maxScore, avgMs, avgWords, avgPostScore, delta, stage };
}

async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number, onDone: () => void): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= tasks.length) return;
      try { results[idx] = await tasks[idx](); } catch (e: any) { results[idx] = { error: String(e?.message || e) } as any; }
      onDone();
    }
  });
  await Promise.all(workers);
  return results;
}

const STAGE_LABEL: Record<Stage, string> = {
  idle: "Ожидание",
  generating: "Генерация",
  inserting: "Сохранение статьи",
  stealth: "Stealth-конвейер",
  reading: "Чтение результата",
  done: "Готово",
  error: "Ошибка",
};

interface HistoryRow {
  id: string;
  created_at: string;
  prompt: string;
  mode: string;
  runs_per_model: number;
  results: any;
}

export function ModelAbTestTab() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [mode, setMode] = useState<Mode>("raw");
  const [selected, setSelected] = useState<string[]>([
    "anthropic/claude-sonnet-4",
    "openai/gpt-5",
    "mistralai/mistral-large-2512",
    "meta-llama/llama-3.3-70b-instruct",
  ]);
  const [runsPerModel, setRunsPerModel] = useState<number>(3);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [aggregates, setAggregates] = useState<ModelAggregate[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modelStages, setModelStages] = useState<Record<string, Stage>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [cleaning, setCleaning] = useState(false);

  const wordRange = parseWordRange(prompt);
  const minThreshold = wordRange ? Math.floor(wordRange.min * 0.6) : null;
  const effectiveRuns = mode === "pipeline" ? 1 : runsPerModel;
  const concurrency = mode === "pipeline" ? PIPELINE_CONCURRENCY : RAW_CONCURRENCY;

  const loadHistory = async () => {
    const { data } = await supabase
      .from("ab_test_runs")
      .select("id, created_at, prompt, mode, runs_per_model, results")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory((data as HistoryRow[]) || []);
  };

  useEffect(() => { loadHistory(); }, []);

  const toggle = (key: string) =>
    setSelected((s) => s.includes(key) ? s.filter((k) => k !== key) : [...s, key]);

  const run = async () => {
    if (selected.length === 0) { toast.error("Выбери хотя бы 1 модель"); return; }
    if (prompt.trim().length < 20) { toast.error("Промпт слишком короткий"); return; }
    setRunning(true);
    setAggregates([]);
    setExpanded({});
    setModelStages(Object.fromEntries(selected.map((m) => [m, "idle" as Stage])));
    const total = selected.length * effectiveRuns;
    setProgress({ done: 0, total });

    const perModelRuns: Record<string, RunResult[]> = Object.fromEntries(selected.map((m) => [m, []]));
    const localMinThreshold = minThreshold;
    const localMode = mode;
    const stagesRef: Record<string, Stage> = Object.fromEntries(selected.map((m) => [m, "idle" as Stage]));
    const updateStage = (model: string, s: Stage) => {
      stagesRef[model] = s;
      setModelStages({ ...stagesRef });
    };
    const refreshAggs = () => {
      const aggs = selected.map((m) => aggregate(m, [...perModelRuns[m]], effectiveRuns, stagesRef[m]));
      aggs.sort((a, b) => {
        const av = localMode === "pipeline" ? (a.avgPostScore ?? a.avgScore ?? -1) : (a.avgScore ?? -1);
        const bv = localMode === "pipeline" ? (b.avgPostScore ?? b.avgScore ?? -1) : (b.avgScore ?? -1);
        return bv - av;
      });
      setAggregates(aggs);
    };

    const tasks: (() => Promise<void>)[] = [];
    for (const model of selected) {
      for (let i = 0; i < effectiveRuns; i++) {
        const idx = i;
        tasks.push(async () => {
          const t0 = Date.now();
          updateStage(model, "generating");
          try {
            const { data, error } = await supabase.functions.invoke("model-ab-test", {
              body: { prompt, models: [model], include_full: localMode === "pipeline" },
            });
            if (error) throw error;
            if ((data as any)?.error) throw new Error((data as any).error);
            const r = ((data as any).results || [])[0];
            if (!r) throw new Error("empty result");
            const volumeFail =
              r.ok && localMinThreshold != null && typeof r.word_count === "number" && r.word_count < localMinThreshold;
            const base: RunResult = { ...r, runIdx: idx, volumeFail, stage: "done" };
            perModelRuns[model].push(base);
            refreshAggs();

            if (localMode === "pipeline" && r.ok && !volumeFail && r.html) {
              await runPipelineForRun(model, base, r.html);
            }
          } catch (e: any) {
            perModelRuns[model].push({
              model, runIdx: idx, ok: false,
              error: String(e?.message || e),
              elapsedMs: Date.now() - t0,
              stage: "error",
            });
            refreshAggs();
          }
        });

        // pipeline sub-task for a single run: insert article + stealth pass + read result
        async function runPipelineForRun(model: string, run: RunResult, html: string) {
          try {
            updateStage(model, "inserting");
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("no user");
            const { data: art, error: insErr } = await supabase
              .from("articles")
              .insert({
                user_id: user.id,
                title: `[AB] ${model} #${idx + 1}`,
                content: html,
                status: "draft",
                language: "ru",
                is_ab_test: true,
                source: "ab_test" as any,
              } as any)
              .select("id")
              .single();
            if (insErr || !art) throw new Error(insErr?.message || "insert failed");
            run.articleId = (art as any).id;
            run.stage = "stealth";
            updateStage(model, "stealth");
            refreshAggs();

            try {
              await runAutoStealthPass(run.articleId!, "ru");
            } catch (e: any) {
              console.warn("[ab-test] stealth threw:", e);
            }

            updateStage(model, "reading");
            run.stage = "reading";
            const { data: final } = await supabase
              .from("articles")
              .select("content, ai_score")
              .eq("id", run.articleId!)
              .maybeSingle();
            const finalContent = (final as any)?.content || "";
            const plain = finalContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            run.postHtml = finalContent;
            run.postPreview = plain.slice(0, 400);
            run.postWordCount = plain.split(/\s+/).filter(Boolean).length;
            run.postAiScore = (final as any)?.ai_score ?? null;
            run.stage = "done";
            updateStage(model, "done");
            refreshAggs();
          } catch (e: any) {
            run.stage = "error";
            run.stageError = String(e?.message || e);
            updateStage(model, "error");
            refreshAggs();
          }
        }
      }
    }

    let done = 0;
    await runPool(tasks, concurrency, () => {
      done++;
      setProgress({ done, total });
      refreshAggs();
    });

    // save history
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const resultsPayload = selected.map((m) => aggregate(m, [...perModelRuns[m]], effectiveRuns));
        await supabase.from("ab_test_runs").insert({
          user_id: user.id,
          prompt,
          mode: localMode,
          runs_per_model: effectiveRuns,
          results: resultsPayload as any,
        });
        loadHistory();
      }
    } catch (e) {
      console.warn("[ab-test] history save failed", e);
    }

    setRunning(false);
    toast.success(`Готово: ${done} генераций`);
  };

  const winnerModel = aggregates.find((a) =>
    mode === "pipeline" ? a.avgPostScore != null : a.avgScore != null
  )?.model;

  const cleanupTestArticles = async () => {
    if (!confirm("Удалить все тестовые статьи (is_ab_test=true) текущего пользователя?")) return;
    setCleaning(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      const { error, count } = await supabase
        .from("articles")
        .delete({ count: "exact" })
        .eq("user_id", user.id)
        .eq("is_ab_test", true);
      if (error) throw error;
      toast.success(`Удалено тестовых статей: ${count ?? 0}`);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка удаления");
    } finally {
      setCleaning(false);
    }
  };

  const buildExportRows = () => {
    return aggregates.map((a) => ({
      model: a.model,
      raw: a.avgScore ?? "",
      post: a.avgPostScore ?? "",
      delta: a.delta ?? "",
      time_sec: (a.avgMs / 1000).toFixed(1),
      words: a.avgWords,
    }));
  };

  const exportCsv = () => {
    const rows = buildExportRows();
    const header = "model,raw_score,post_score,delta,time_sec,words";
    const body = rows.map((r) => `${r.model},${r.raw},${r.post},${r.delta},${r.time_sec},${r.words}`).join("\n");
    const csv = header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ab-test-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = async () => {
    const rows = buildExportRows();
    const lines = [
      "| Модель | Сырой | После | Дельта | Время, с | Слов |",
      "|---|---:|---:|---:|---:|---:|",
      ...rows.map((r) => `| ${r.model} | ${r.raw} | ${r.post} | ${r.delta} | ${r.time_sec} | ${r.words} |`),
    ];
    const md = lines.join("\n");
    try {
      await navigator.clipboard.writeText(md);
      toast.success("Markdown-таблица скопирована");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          A/B тест моделей по AI Score
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Каждая модель генерирует N текстов, каждый оценивается детектором (gemini-2.5-flash-lite, temperature 0).
          Рейтинг - по среднему AI Score среди засчитанных прогонов. Выше = человечнее.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Промпт</label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Режим теста</label>
          <div className="flex gap-2">
            <label className={`flex-1 flex items-start gap-2 text-xs cursor-pointer p-3 rounded border ${mode === "raw" ? "border-primary bg-primary/5" : "border-border/50 hover:bg-muted/30"}`}>
              <input type="radio" name="ab-mode" checked={mode === "raw"} onChange={() => setMode("raw")} disabled={running} className="mt-0.5" />
              <div>
                <div className="font-medium">Сырая генерация</div>
                <div className="text-muted-foreground mt-0.5">Оцениваем только исходный ответ модели детектором. Быстро.</div>
              </div>
            </label>
            <label className={`flex-1 flex items-start gap-2 text-xs cursor-pointer p-3 rounded border ${mode === "pipeline" ? "border-primary bg-primary/5" : "border-border/50 hover:bg-muted/30"}`}>
              <input type="radio" name="ab-mode" checked={mode === "pipeline"} onChange={() => setMode("pipeline")} disabled={running} className="mt-0.5" />
              <div>
                <div className="font-medium">Сравнение с конвейером</div>
                <div className="text-muted-foreground mt-0.5">Прогоняем ответ через runAutoStealthPass (humanize + quality + turgenev). 1 прогон/модель.</div>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Модели для сравнения</label>
          <div className="grid grid-cols-2 gap-2">
            {CANDIDATE_MODELS.map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-xs cursor-pointer p-2 rounded border border-border/50 hover:bg-muted/30">
                <Checkbox checked={selected.includes(m.key)} onCheckedChange={() => toggle(m.key)} />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="w-40">
            <label className="text-sm font-medium mb-1 block">Прогонов на модель</label>
            <Select value={String(runsPerModel)} onValueChange={(v) => setRunsPerModel(Number(v))} disabled={running || mode === "pipeline"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
              </SelectContent>
            </Select>
            {mode === "pipeline" && (
              <div className="text-[10px] text-muted-foreground mt-1">В режиме конвейера - 1 прогон</div>
            )}
          </div>
          <Button onClick={run} disabled={running} className="flex-1">
            {running
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Выполняется...</>
              : <><Zap className="h-4 w-4 mr-2" /> Запустить тест ({selected.length} × {effectiveRuns} = {selected.length * effectiveRuns})</>}
          </Button>
          <Button variant="outline" onClick={cleanupTestArticles} disabled={running || cleaning} title="Удалить все статьи с is_ab_test=true">
            {cleaning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">Очистить тестовые</span>
          </Button>
        </div>

        {(running || progress.total > 0) && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Выполнено {progress.done} из {progress.total} генераций</span>
              <span>параллельно ≤ {concurrency}</span>
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </div>
        )}

        {aggregates.length > 0 && (
          <div className="space-y-2 mt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {mode === "pipeline"
                  ? "Сортировка по среднему баллу после конвейера"
                  : "Отсортировано по среднему AI Score среди засчитанных прогонов"}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1" /> CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={exportMarkdown}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Markdown
                </Button>
              </div>
            </div>
            {aggregates.map((a) => {
              const isOpen = !!expanded[a.model];
              const stage = modelStages[a.model] || a.stage;
              return (
                <div key={a.model} className="border border-border/40 rounded-lg bg-muted/20">
                  <button
                    type="button"
                    onClick={() => setExpanded((s) => ({ ...s, [a.model]: !s[a.model] }))}
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      {winnerModel === a.model && a.avgScore != null && <Trophy className="h-4 w-4 text-amber-400 shrink-0" />}
                      <span className="font-mono text-xs truncate">{a.model}</span>
                      {mode === "pipeline" && stage && stage !== "done" && stage !== "idle" && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                          {stage === "error" ? "ошибка" : STAGE_LABEL[stage]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-muted-foreground">{a.counted}/{a.total} засч.</span>
                      {a.apiErrors > 0 && (
                        <span className="text-red-400" title="Ошибки API">API ×{a.apiErrors}</span>
                      )}
                      {a.unscored > 0 && (
                        <span className="text-amber-400" title="Ответ детектора пустой/невалидный">без оценки ×{a.unscored}</span>
                      )}
                      {a.volumeFails > 0 && (
                        <span className="text-amber-400" title="Объём меньше 60% нижней границы">объём ×{a.volumeFails}</span>
                      )}
                      <span className="text-muted-foreground">{(a.avgMs / 1000).toFixed(1)}s</span>
                      <span className="text-muted-foreground">{a.avgWords} слов</span>
                      {mode === "pipeline" ? (
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold ${scoreColor(a.avgScore)}`}>
                            {a.avgScore != null ? `${a.avgScore}` : "-"}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className={`font-semibold text-base ${scoreColor(a.avgPostScore)}`}>
                            {a.avgPostScore != null ? `${a.avgPostScore}/100` : "-"}
                          </span>
                          {a.delta != null && (
                            <span className={`text-xs font-mono ${a.delta > 0 ? "text-emerald-400" : a.delta < 0 ? "text-red-400" : "text-muted-foreground"}`}>
                              {a.delta > 0 ? `+${a.delta}` : `${a.delta}`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          <span className="text-muted-foreground">
                            {a.minScore != null && a.maxScore != null ? `${a.minScore}-${a.maxScore}` : "-"}
                          </span>
                          <span className={`font-semibold text-base ${scoreColor(a.avgScore)}`}>
                            {a.avgScore != null ? `${a.avgScore}/100` : "-"}
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border/40 p-3 space-y-2">
                      {a.runs.length === 0 && <div className="text-xs text-muted-foreground">Ожидание...</div>}
                      {a.runs.map((r) => (
                        <div key={r.runIdx} className="border border-border/30 rounded p-2 bg-background/30">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-muted-foreground">Прогон #{r.runIdx + 1}</span>
                            <div className="flex items-center gap-3 text-[11px]">
                              <span className="text-muted-foreground">{(r.elapsedMs / 1000).toFixed(1)}s</span>
                              {r.word_count != null && <span className="text-muted-foreground">{r.word_count} слов</span>}
                              {mode === "pipeline" ? (
                                <>
                                  <span className={`font-semibold ${scoreColor(r.ai_score)}`}>
                                    {r.ai_score != null ? `${r.ai_score}` : "-"}
                                  </span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className={`font-semibold ${scoreColor(r.postAiScore)}`}>
                                    {r.postAiScore != null ? `${r.postAiScore}/100` : "-"}
                                  </span>
                                </>
                              ) : (
                                <span className={`font-semibold ${scoreColor(r.ai_score)}`}>
                                  {r.ai_score != null ? `${r.ai_score}/100` : "-"}
                                </span>
                              )}
                            </div>
                          </div>
                          {r.ok ? (
                            <>
                              {r.verdict && <div className="text-[11px] text-muted-foreground mb-1">Вердикт: {r.verdict}</div>}
                              {r.reasons && r.reasons.length > 0 && (
                                <div className="text-[11px] text-muted-foreground mb-1">Причины: {r.reasons.join("; ")}</div>
                              )}
                              {r.volumeFail && (
                                <div className="text-[11px] text-amber-400 mb-1">
                                  Не засчитан: неполный ответ ({r.word_count} слов, минимум {minThreshold ?? "-"})
                                </div>
                              )}
                              {!r.volumeFail && r.ai_score == null && (
                                <div className="text-[11px] text-amber-400 mb-1">Не засчитан: неполный ответ детектора</div>
                              )}
                              {mode === "pipeline" && r.postPreview ? (
                                <Tabs defaultValue="before" className="mt-1">
                                  <TabsList className="h-7">
                                    <TabsTrigger value="before" className="text-[11px] h-6">До</TabsTrigger>
                                    <TabsTrigger value="after" className="text-[11px] h-6">После ({r.postWordCount} слов)</TabsTrigger>
                                  </TabsList>
                                  <TabsContent value="before">
                                    <div className="p-2 bg-background/50 rounded max-h-52 overflow-y-auto whitespace-pre-wrap text-[11px]">{r.preview}</div>
                                  </TabsContent>
                                  <TabsContent value="after">
                                    <div className="p-2 bg-background/50 rounded max-h-52 overflow-y-auto whitespace-pre-wrap text-[11px]">{r.postPreview}</div>
                                  </TabsContent>
                                </Tabs>
                              ) : (
                                <details className="text-[11px]">
                                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Превью текста</summary>
                                  <div className="mt-1 p-2 bg-background/50 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">{r.preview}</div>
                                </details>
                              )}
                              {r.stageError && (
                                <div className="text-[11px] text-red-400 mt-1">Конвейер: {r.stageError}</div>
                              )}
                            </>
                          ) : (
                            <div className="text-xs text-red-400 break-words">
                              Ошибка API: {r.error || "неизвестная ошибка запроса"}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* History block */}
        <div className="mt-6 pt-4 border-t border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">История тестов</span>
            <span className="text-xs text-muted-foreground">({history.length})</span>
          </div>
          {history.length === 0 ? (
            <div className="text-xs text-muted-foreground">Пока пусто</div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {history.map((h) => {
                const rs = Array.isArray(h.results) ? h.results : [];
                const top = [...rs].sort((a: any, b: any) => {
                  const av = h.mode === "pipeline" ? (a.avgPostScore ?? -1) : (a.avgScore ?? -1);
                  const bv = h.mode === "pipeline" ? (b.avgPostScore ?? -1) : (b.avgScore ?? -1);
                  return bv - av;
                })[0];
                const topScore = h.mode === "pipeline" ? top?.avgPostScore : top?.avgScore;
                return (
                  <div key={h.id} className="text-xs p-2 rounded border border-border/30 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{new Date(h.created_at).toLocaleString("ru-RU")}</span>
                        <span className="px-1.5 py-0.5 rounded bg-muted/50 text-[10px] uppercase">{h.mode}</span>
                        <span className="text-muted-foreground">×{h.runs_per_model}</span>
                        <span className="text-muted-foreground">{rs.length} моделей</span>
                      </div>
                      <div className="truncate text-muted-foreground mt-0.5">{h.prompt.slice(0, 120)}</div>
                    </div>
                    {top && (
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">{top.model}</div>
                        <div className={`font-semibold ${scoreColor(topScore)}`}>{topScore != null ? `${topScore}/100` : "-"}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}