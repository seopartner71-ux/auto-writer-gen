import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, Copy, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface Benchmark {
  medianWordCount?: number | null;
  medianH2?: number | null;
  medianLists?: number | null;
  medianKeywordDensity?: number | null;
}

interface Props {
  content: string;
  keyword?: string | null;
  terms?: string[];
  benchmark?: Benchmark | null;
  hasKeyword?: boolean;
  onPickKeyword?: () => void;
  articleId?: string | null;
  onContentImproved?: (newContent: string) => void;
  isStreaming?: boolean;
  quickMode?: boolean;
}

const STORAGE_KEY = "seo_side_panel_collapsed";

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, " ");
}

function useDebouncedWithStatus<T>(value: T, delay = 800, paused = false): { value: T; pending: boolean } {
  const [v, setV] = useState(value);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (paused) { setPending(false); return; }
    setPending(true);
    const id = setTimeout(() => { setV(value); setPending(false); }, delay);
    return () => clearTimeout(id);
  }, [value, delay, paused]);
  return { value: v, pending };
}

function LiveDot({ pending }: { pending: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        pending ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
      )} />
      Live
    </span>
  );
}

function scoreColor(s: number) {
  if (s >= 80) return "text-emerald-400";
  if (s >= 60) return "text-amber-400";
  if (s >= 40) return "text-orange-400";
  return "text-rose-400";
}
function scoreLabel(s: number) {
  if (s >= 80) return "Отлично";
  if (s >= 60) return "Хорошо";
  if (s >= 40) return "Слабо";
  return "Плохо";
}

function scoreStrokeColor(s: number) {
  if (s >= 80) return "#22c55e";
  if (s >= 60) return "#eab308";
  if (s >= 40) return "#f97316";
  return "#ef4444";
}
function scoreStatus(s: number) {
  if (s >= 80) return { dot: "bg-emerald-400", text: "Отлично - готово к публикации", color: "text-emerald-400" };
  if (s >= 60) return { dot: "bg-amber-400", text: "Хорошо - можно улучшить", color: "text-amber-400" };
  if (s >= 40) return { dot: "bg-orange-400", text: "Слабо - нужно улучшение", color: "text-orange-400" };
  return { dot: "bg-rose-400", text: "Плохо - требует доработки", color: "text-rose-400" };
}

function ScoreDonut({ score, size = 140, stroke = 12 }: { score: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;
  const color = scoreStrokeColor(clamped);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1e293b"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="font-bold font-mono leading-none transition-colors"
          style={{ fontSize: Math.round(size * 0.42), color }}
        >
          {clamped}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">из 100</div>
      </div>
    </div>
  );
}

export function SeoSidePanel({ content, keyword, terms = [], benchmark, hasKeyword = true, onPickKeyword, articleId, onContentImproved, isStreaming = false, quickMode = false }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });
  const [showAllTerms, setShowAllTerms] = useState(false);
  const [improving, setImproving] = useState(false);
  const [improveStage, setImproveStage] = useState<string>("");
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  const { value: debounced, pending } = useDebouncedWithStatus(content, 800, isStreaming);

  const metrics = useMemo(() => {
    const text = stripHtml(debounced || "").trim();
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const kw = (keyword || "").trim();
    let keywordCount = 0;
    if (kw && wordCount > 0) {
      try {
        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        keywordCount = (debounced.match(re) || []).length;
      } catch {}
    }
    const density = wordCount > 0 ? (keywordCount / wordCount) * 100 : 0;

    const lower = (debounced || "").toLowerCase();
    const uniqueTerms = Array.from(new Set((terms || []).map(t => t.trim()).filter(Boolean)));
    const covered = new Set<string>();
    for (const t of uniqueTerms) {
      if (t && lower.includes(t.toLowerCase())) covered.add(t);
    }

    const h2Count = (debounced.match(/<h2|^##\s|\n##\s/gi) || []).length;
    const listCount = (debounced.match(/<ul|<ol|^\s*[-*]\s|\n\s*[-*]\s|^\s*\d+\.\s|\n\s*\d+\.\s/gi) || []).length;
    const questionCount = (debounced.match(/\?/g) || []).length;

    return { wordCount, density, keywordCount, covered, uniqueTerms, h2Count, listCount, questionCount };
  }, [debounced, keyword, terms]);

  const medianDensity = benchmark?.medianKeywordDensity ?? 1.5;
  const medianWords = benchmark?.medianWordCount ?? 1500;
  const medianH2 = benchmark?.medianH2 ?? 5;
  const medianLists = benchmark?.medianLists ?? 3;

  const densityDiff = Math.abs(metrics.density - medianDensity);
  const densityScore = densityDiff <= 0.5 ? 100 : densityDiff <= 1.0 ? 70 : densityDiff <= 1.5 ? 40 : 10;
  const coverageScore = metrics.uniqueTerms.length > 0
    ? (metrics.covered.size / metrics.uniqueTerms.length) * 100
    : 100;
  const wScore = medianWords > 0 ? Math.min(100, (metrics.wordCount / medianWords) * 100) : 100;
  const hScore = medianH2 > 0 ? Math.min(100, (metrics.h2Count / medianH2) * 100) : 100;
  const lScore = medianLists > 0 ? Math.min(100, (metrics.listCount / medianLists) * 100) : 100;
  const structureScore = wScore * 0.4 + hScore * 0.3 + lScore * 0.3;
  const totalScore = Math.round(densityScore * 0.3 + coverageScore * 0.4 + structureScore * 0.3);

  // Streaming placeholder
  if (isStreaming) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="pt-3 pb-3 text-center text-xs text-muted-foreground space-y-2">
          <div className="text-2xl">⏳</div>
          <div className="font-semibold text-sm text-foreground">Генерация...</div>
          <div>SEO Score обновится после завершения</div>
        </CardContent>
      </Card>
    );
  }

  // Quick mode — compact score-only view
  if (quickMode) {
    if (!hasKeyword) return null;
    return (
      <Card className="bg-card border-border">
        <CardContent className="pt-3 pb-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">SEO Score</span>
            <LiveDot pending={pending} />
          </div>
          <div className="flex items-end justify-between">
            <div className={cn("text-4xl font-bold font-mono transition-all duration-300", scoreColor(totalScore))}>{totalScore}</div>
            <div className={cn("text-sm font-semibold", scoreColor(totalScore))}>{scoreLabel(totalScore)}</div>
          </div>
          <Progress value={totalScore} className="h-2" />
        </CardContent>
      </Card>
    );
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-card text-[10px] text-muted-foreground hover:bg-muted/40"
        title="Развернуть SEO Score"
      >
        <ChevronLeft className="h-3 w-3" />
        <span className={cn("font-mono font-semibold", scoreColor(totalScore))}>{totalScore}</span>
        <span>SEO</span>
      </button>
    );
  }

  if (!hasKeyword) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="pt-3 pb-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold">SEO Score</span>
            <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground">
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="text-muted-foreground text-[11px] leading-snug">
            Привяжите ключевое слово для SEO-анализа.
          </div>
          {onPickKeyword && (
            <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" onClick={onPickKeyword}>
              Выбрать ключ
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const sortedTerms = [...metrics.uniqueTerms].sort((a, b) => {
    const ca = metrics.covered.has(a) ? 1 : 0;
    const cb = metrics.covered.has(b) ? 1 : 0;
    return ca - cb;
  });
  const visibleTerms = showAllTerms ? sortedTerms : sortedTerms.slice(0, 15);

  const missingTerms = metrics.uniqueTerms.filter(t => !metrics.covered.has(t));

  const handleImprove = async () => {
    if (!articleId) { toast.error("Сначала сохраните статью"); return; }
    if (!onContentImproved) return;
    if (improving) return;
    setImproving(true);
    setImproveStage("Анализирую текст...");
    const scoreBefore = totalScore;
    try {
      // Verify article exists in DB (avoid stale currentArticleId -> 404)
      const { data: exists } = await supabase
        .from("articles")
        .select("id")
        .eq("id", articleId)
        .maybeSingle();
      if (!exists) {
        toast.error("Статья еще не сохранена. Подождите пару секунд и повторите.");
        return;
      }
      setImproveStage("Вставляю термины...");
      const { data, error } = await supabase.functions.invoke("improve-seo", {
        body: {
          article_id: articleId,
          content,
          keyword: keyword || "",
          missing_terms: missingTerms.slice(0, 8),
          current_density: metrics.density,
          target_density: medianDensity,
          word_count: metrics.wordCount,
        },
      });
      if (error) throw error;
      const payload: any = data;
      if (payload?.limit_reached) {
        setLimitReached(true);
        toast.error(payload?.error || "Лимит улучшений достигнут");
        return;
      }
      if (!payload?.ok || !payload?.content) {
        throw new Error(payload?.error || "Не удалось улучшить без потери форматирования. Попробуйте снова или отредактируйте вручную.");
      }
      setImproveStage("Проверяю результат...");
      onContentImproved(payload.content);
      // estimate new score quickly: re-run on next render via debounced effect; show before/after
      toast.success(`SEO улучшен: score был ${scoreBefore}`);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка улучшения");
    } finally {
      setImproving(false);
      setImproveStage("");
    }
  };

  const canImprove = totalScore < 80 && !limitReached && (missingTerms.length > 0 || metrics.density < medianDensity);

  const cellColor = (val: number, median: number) => {
    if (median <= 0) return "text-foreground";
    const ratio = val / median;
    if (ratio >= 1) return "text-emerald-400";
    if (ratio >= 0.7) return "text-amber-400";
    return "text-rose-400";
  };

  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-3 pb-3 space-y-3 text-xs">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">SEO Score</span>
            <LiveDot pending={pending} />
          </div>
          <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground" title="Свернуть">
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        {/* Section 1 — Total */}
        <div className="flex items-end justify-between border-b border-border pb-2">
          <div className={cn("text-3xl font-bold font-mono transition-all duration-300", scoreColor(totalScore))}>{totalScore}</div>
          <div className="text-right">
            <div className={cn("text-xs font-semibold", scoreColor(totalScore))}>{scoreLabel(totalScore)}</div>
            <div className="text-[10px] text-muted-foreground">из 100</div>
          </div>
        </div>
        <Progress value={totalScore} className="h-1.5" />

        {/* Section 2 — Density */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Плотность ключа</span>
            <span className="font-mono">
              <span className={cn(densityScore >= 70 ? "text-emerald-400" : densityScore >= 40 ? "text-amber-400" : "text-rose-400")}>
                {metrics.density.toFixed(1)}%
              </span>
              <span className="text-muted-foreground text-[10px] ml-1">медиана {medianDensity.toFixed(1)}%</span>
            </span>
          </div>
          <Progress value={Math.min(100, (metrics.density / Math.max(medianDensity * 2, 1)) * 100)} className="h-1.5" />
          <div className="text-[10px] text-muted-foreground">
            Найдено вхождений: {metrics.keywordCount} / {metrics.wordCount} слов
          </div>
        </div>

        {/* Section 3 — Terms */}
        {metrics.uniqueTerms.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">NLP термины</span>
              <span className="font-mono">
                {metrics.covered.size}/{metrics.uniqueTerms.length}
              </span>
            </div>
            <Progress value={(metrics.covered.size / metrics.uniqueTerms.length) * 100} className="h-1.5" />
            <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1 scrollbar-hide">
              {visibleTerms.map((term) => {
                const isCovered = metrics.covered.has(term);
                return (
                  <button
                    key={term}
                    onClick={async () => {
                      if (isCovered) return;
                      try {
                        await navigator.clipboard.writeText(term);
                        toast.success(`Скопировано: ${term}`);
                      } catch {
                        toast.error("Не удалось скопировать");
                      }
                    }}
                    className={cn(
                      "w-full text-left flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] transition-colors",
                      isCovered ? "text-emerald-400" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    )}
                    title={isCovered ? "Покрыто" : "Кликните чтобы скопировать"}
                  >
                    <span className="shrink-0">{isCovered ? "✅" : "⬜"}</span>
                    <span className="truncate">{term}</span>
                    {!isCovered && <Copy className="h-2.5 w-2.5 ml-auto shrink-0 opacity-0 group-hover:opacity-100" />}
                  </button>
                );
              })}
            </div>
            {sortedTerms.length > 15 && (
              <button
                onClick={() => setShowAllTerms(v => !v)}
                className="text-[10px] text-primary hover:underline"
              >
                {showAllTerms ? "Свернуть" : `Показать ещё ${sortedTerms.length - 15}`}
              </button>
            )}
          </div>
        )}

        {/* Section 4 — Structure vs top */}
        <div className="space-y-1">
          <div className="text-muted-foreground">Структура vs топ</div>
          <div className="grid grid-cols-3 gap-1 text-[11px]">
            <div className="text-muted-foreground">Параметр</div>
            <div className="text-right text-muted-foreground">Ваша</div>
            <div className="text-right text-muted-foreground">Топ</div>

            <div>Слов</div>
            <div className={cn("text-right font-mono", cellColor(metrics.wordCount, medianWords))}>{metrics.wordCount}</div>
            <div className="text-right font-mono text-muted-foreground">{medianWords}</div>

            <div>H2</div>
            <div className={cn("text-right font-mono", cellColor(metrics.h2Count, medianH2))}>{metrics.h2Count}</div>
            <div className="text-right font-mono text-muted-foreground">{medianH2}</div>

            <div>Списков</div>
            <div className={cn("text-right font-mono", cellColor(metrics.listCount, medianLists))}>{metrics.listCount}</div>
            <div className="text-right font-mono text-muted-foreground">{medianLists}</div>

            <div>Вопросов</div>
            <div className="text-right font-mono">{metrics.questionCount}</div>
            <div className="text-right font-mono text-muted-foreground">—</div>
          </div>
        </div>

        {/* Section 5 — Improve action */}
        {totalScore >= 80 ? (
          <div className="flex items-center justify-center gap-1.5 py-2 text-emerald-400 text-[12px] font-medium border-t border-border">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Готово к публикации
          </div>
        ) : limitReached ? (
          <div className="text-[10px] text-muted-foreground text-center pt-2 border-t border-border leading-snug">
            Достигнут лимит улучшений (3). Отредактируйте текст вручную.
          </div>
        ) : (
          <div className="space-y-1 pt-2 border-t border-border">
            <Button
              size="sm"
              className="w-full h-8 text-[11px] gap-1.5"
              onClick={handleImprove}
              disabled={improving || !canImprove || !articleId}
            >
              {improving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {improveStage || "Улучшаем..."}
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  {totalScore < 40 ? "Серьезно улучшить 🔧"
                    : totalScore < 60 ? "Улучшить до 80+ ⚡"
                    : "Улучшить до 80+ 🚀"}
                </>
              )}
            </Button>
            <div className="text-[10px] text-muted-foreground text-center leading-snug">
              Добавит термины и скорректирует плотность ключа
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}