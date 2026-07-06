import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FlaskConical, Zap, Trophy, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const CANDIDATE_MODELS = [
  { key: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (текущая)" },
  { key: "anthropic/claude-opus-4", label: "Claude Opus 4" },
  { key: "openai/gpt-5", label: "GPT-5" },
  { key: "openai/gpt-5-mini", label: "GPT-5 mini" },
  { key: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { key: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { key: "mistralai/mistral-large-2411", label: "Mistral Large 2411" },
  { key: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { key: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
  { key: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B" },
];

const DEFAULT_PROMPT = `Напиши SEO-статью на 400-500 слов на тему "Как выбрать беспроводные наушники для бега в 2026 году". Чистый HTML с <h2>, <p>, <ul>. Живой человеческий стиль, чередуй короткие и длинные предложения, без канцелярита.`;

const CONCURRENCY = 5;

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
}

interface ModelAggregate {
  model: string;
  runs: RunResult[];
  counted: number;
  total: number;
  apiErrors: number;
  unscored: number;
  avgScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  avgMs: number;
  avgWords: number;
}

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function aggregate(model: string, runs: RunResult[], total: number): ModelAggregate {
  const scored = runs.filter((r) => r.ok && typeof r.ai_score === "number") as (RunResult & { ai_score: number })[];
  const scores = scored.map((r) => r.ai_score);
  const avgScore = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
  const minScore = scores.length ? Math.min(...scores) : null;
  const maxScore = scores.length ? Math.max(...scores) : null;
  const okRuns = runs.filter((r) => r.ok);
  const avgMs = okRuns.length ? Math.round(okRuns.reduce((s, r) => s + r.elapsedMs, 0) / okRuns.length) : 0;
  const avgWords = okRuns.length ? Math.round(okRuns.reduce((s, r) => s + (r.word_count || 0), 0) / okRuns.length) : 0;
  const apiErrors = runs.filter((r) => !r.ok).length;
  const unscored = runs.filter((r) => r.ok && (r.ai_score == null)).length;
  return { model, runs: runs.sort((a, b) => a.runIdx - b.runIdx), counted: scored.length, total, apiErrors, unscored, avgScore, minScore, maxScore, avgMs, avgWords };
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

export function ModelAbTestTab() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selected, setSelected] = useState<string[]>([
    "anthropic/claude-sonnet-4",
    "openai/gpt-5",
    "mistralai/mistral-large-2411",
    "meta-llama/llama-3.3-70b-instruct",
  ]);
  const [runsPerModel, setRunsPerModel] = useState<number>(3);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [aggregates, setAggregates] = useState<ModelAggregate[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (key: string) =>
    setSelected((s) => s.includes(key) ? s.filter((k) => k !== key) : [...s, key]);

  const run = async () => {
    if (selected.length === 0) { toast.error("Выбери хотя бы 1 модель"); return; }
    if (prompt.trim().length < 20) { toast.error("Промпт слишком короткий"); return; }
    setRunning(true);
    setAggregates([]);
    setExpanded({});
    const total = selected.length * runsPerModel;
    setProgress({ done: 0, total });

    const perModelRuns: Record<string, RunResult[]> = Object.fromEntries(selected.map((m) => [m, []]));

    const tasks: (() => Promise<void>)[] = [];
    for (const model of selected) {
      for (let i = 0; i < runsPerModel; i++) {
        const idx = i;
        tasks.push(async () => {
          const t0 = Date.now();
          try {
            const { data, error } = await supabase.functions.invoke("model-ab-test", {
              body: { prompt, models: [model] },
            });
            if (error) throw error;
            if ((data as any)?.error) throw new Error((data as any).error);
            const r = ((data as any).results || [])[0];
            if (!r) throw new Error("empty result");
            perModelRuns[model].push({ ...r, runIdx: idx });
          } catch (e: any) {
            perModelRuns[model].push({
              model, runIdx: idx, ok: false,
              error: String(e?.message || e),
              elapsedMs: Date.now() - t0,
            });
          }
        });
      }
    }

    let done = 0;
    await runPool(tasks, CONCURRENCY, () => {
      done++;
      setProgress({ done, total });
      const aggs = selected.map((m) => aggregate(m, [...perModelRuns[m]], runsPerModel));
      aggs.sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
      setAggregates(aggs);
    });

    setRunning(false);
    toast.success(`Готово: ${done} генераций`);
  };

  const winnerModel = aggregates.find((a) => a.avgScore != null)?.model;

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          A/B тест моделей по AI Score
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Каждая модель генерирует N текстов, каждый оценивается детектором (gemini-2.5-flash-lite, temperature 0).
          Рейтинг — по среднему AI Score среди засчитанных прогонов. Выше = человечнее.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Промпт</label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
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
            <Select value={String(runsPerModel)} onValueChange={(v) => setRunsPerModel(Number(v))} disabled={running}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="5">5</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={running} className="flex-1">
            {running
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Выполняется...</>
              : <><Zap className="h-4 w-4 mr-2" /> Запустить тест ({selected.length} × {runsPerModel} = {selected.length * runsPerModel})</>}
          </Button>
        </div>

        {(running || progress.total > 0) && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Выполнено {progress.done} из {progress.total} генераций</span>
              <span>параллельно ≤ {CONCURRENCY}</span>
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </div>
        )}

        {aggregates.length > 0 && (
          <div className="space-y-2 mt-4">
            <div className="text-xs text-muted-foreground">Отсортировано по среднему AI Score среди засчитанных прогонов</div>
            {aggregates.map((a) => {
              const isOpen = !!expanded[a.model];
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
                    </div>
                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-muted-foreground">{a.counted}/{a.total} засч.</span>
                      {a.apiErrors > 0 && (
                        <span className="text-red-400" title="Ошибки API">API ×{a.apiErrors}</span>
                      )}
                      {a.unscored > 0 && (
                        <span className="text-amber-400" title="Ответ детектора пустой/невалидный">без оценки ×{a.unscored}</span>
                      )}
                      <span className="text-muted-foreground">{(a.avgMs / 1000).toFixed(1)}s</span>
                      <span className="text-muted-foreground">{a.avgWords} слов</span>
                      <span className="text-muted-foreground">
                        {a.minScore != null && a.maxScore != null ? `${a.minScore}–${a.maxScore}` : "—"}
                      </span>
                      <span className={`font-semibold text-base ${scoreColor(a.avgScore)}`}>
                        {a.avgScore != null ? `${a.avgScore}/100` : "—"}
                      </span>
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
                              <span className={`font-semibold ${scoreColor(r.ai_score)}`}>
                                {r.ai_score != null ? `${r.ai_score}/100` : "—"}
                              </span>
                            </div>
                          </div>
                          {r.ok ? (
                            <>
                              {r.verdict && <div className="text-[11px] text-muted-foreground mb-1">Вердикт: {r.verdict}</div>}
                              {r.reasons && r.reasons.length > 0 && (
                                <div className="text-[11px] text-muted-foreground mb-1">Причины: {r.reasons.join("; ")}</div>
                              )}
                              {r.ai_score == null && (
                                <div className="text-[11px] text-amber-400 mb-1">Не засчитан: неполный ответ детектора</div>
                              )}
                              <details className="text-[11px]">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Превью текста</summary>
                                <div className="mt-1 p-2 bg-background/50 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">{r.preview}</div>
                              </details>
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
      </CardContent>
    </Card>
  );
}