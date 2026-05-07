import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, FlaskConical, Zap, Trophy } from "lucide-react";
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

interface AbResult {
  model: string;
  ok: boolean;
  error?: string;
  elapsedMs: number;
  word_count?: number;
  ai_score?: number | null;
  verdict?: string | null;
  reasons?: string[];
  preview?: string;
}

function scoreColor(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

export function ModelAbTestTab() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selected, setSelected] = useState<string[]>([
    "anthropic/claude-sonnet-4",
    "openai/gpt-5",
    "mistralai/mistral-large-2411",
    "meta-llama/llama-3.3-70b-instruct",
  ]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<AbResult[]>([]);

  const toggle = (key: string) =>
    setSelected((s) => s.includes(key) ? s.filter((k) => k !== key) : [...s, key]);

  const run = async () => {
    if (selected.length === 0) { toast.error("Выбери хотя бы 1 модель"); return; }
    if (prompt.trim().length < 20) { toast.error("Промпт слишком короткий"); return; }
    setRunning(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("model-ab-test", {
        body: { prompt, models: selected },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const rows: AbResult[] = (data as any).results || [];
      // sort by ai_score desc (higher = more human)
      rows.sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1));
      setResults(rows);
      toast.success(`Готово: ${rows.length} моделей`);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка теста");
    } finally {
      setRunning(false);
    }
  };

  const winner = results.find((r) => r.ok && typeof r.ai_score === "number");

  return (
    <Card className="bg-card/50 border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          A/B тест моделей по AI Score
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Прогоняет один и тот же промпт через выбранные модели параллельно и сравнивает AI Score
          (тот же детектор, что и в quality-check, gemini-2.5-flash-lite). Чем выше score - тем более человеческий текст.
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

        <Button onClick={run} disabled={running} className="w-full">
          {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Запущено... (до 90 сек)</> : <><Zap className="h-4 w-4 mr-2" /> Запустить тест ({selected.length})</>}
        </Button>

        {results.length > 0 && (
          <div className="space-y-2 mt-4">
            <div className="text-xs text-muted-foreground">Отсортировано по AI Score (выше = человечнее)</div>
            {results.map((r, i) => (
              <div key={r.model} className="border border-border/40 rounded-lg p-3 bg-muted/20">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {i === 0 && winner?.model === r.model && <Trophy className="h-4 w-4 text-amber-400" />}
                    <span className="font-mono text-xs">{r.model}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">{(r.elapsedMs / 1000).toFixed(1)}s</span>
                    {r.word_count != null && <span className="text-muted-foreground">{r.word_count} слов</span>}
                    <span className={`font-semibold text-base ${scoreColor(r.ai_score)}`}>
                      {r.ai_score != null ? `${r.ai_score}/100` : "—"}
                    </span>
                  </div>
                </div>
                {r.ok ? (
                  <>
                    {r.verdict && <div className="text-[11px] text-muted-foreground mb-1">Вердикт: {r.verdict}</div>}
                    {r.reasons && r.reasons.length > 0 && (
                      <div className="text-[11px] text-muted-foreground mb-1">
                        Причины: {r.reasons.join("; ")}
                      </div>
                    )}
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Превью текста</summary>
                      <div className="mt-1 p-2 bg-background/50 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">{r.preview}</div>
                    </details>
                  </>
                ) : (
                  <div className="text-xs text-red-400">Ошибка: {r.error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}