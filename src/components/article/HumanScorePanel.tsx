import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, Circle, Shield, Activity, Zap, Brain, AlertTriangle,
  Plus, Search, ChevronDown, ChevronUp, Eye,
} from "lucide-react";
import {
  computeBurstiness, computeAiProbability, computePerplexity,
  computeSymmetry, findAiStopWords, getKeywordDensity,
} from "./humanScore/analysis";

interface HumanScorePanelProps {
  content: string;
  lsiKeywords: string[];
  onHighlightStopWords?: (words: string[]) => void;
}

function getTrafficColor(score: number, thresholds: [number, number] = [45, 70]) {
  if (score >= thresholds[1]) return { text: "text-green-500", bg: "bg-green-500", label: "Отлично" };
  if (score >= thresholds[0]) return { text: "text-yellow-500", bg: "bg-yellow-500", label: "Средне" };
  return { text: "text-red-500", bg: "bg-red-500", label: "Низкая" };
}

function getAiSafetyColor(score: number) {
  if (score >= 75) return { text: "text-green-500", bg: "bg-green-500", label: "Безопасно" };
  if (score >= 50) return { text: "text-yellow-500", bg: "bg-yellow-500", label: "Средний риск" };
  return { text: "text-red-500", bg: "bg-red-500", label: "Высокий риск" };
}

export function HumanScorePanel({ content, lsiKeywords, onHighlightStopWords }: HumanScorePanelProps) {
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [showStopWords, setShowStopWords] = useState(false);
  const [stopWordsHighlighted, setStopWordsHighlighted] = useState(false);

  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);
  const burstiness = useMemo(() => computeBurstiness(content), [content]);
  const aiProb = useMemo(() => computeAiProbability(content), [content]);
  const perplexity = useMemo(() => computePerplexity(content), [content]);
  const symmetry = useMemo(() => computeSymmetry(content), [content]);
  const stopWords = useMemo(() => findAiStopWords(content), [content]);

  const allLsiKeywords = useMemo(
    () => [...lsiKeywords, ...customKeywords],
    [lsiKeywords, customKeywords]
  );

  const lsiStatus = useMemo(() => {
    const lower = content.toLowerCase();
    return allLsiKeywords.map(kw => {
      const found = lower.includes(kw.toLowerCase());
      const density = found ? getKeywordDensity(content, kw) : 0;
      const isSpam = density > 3;
      return { keyword: kw, found, density, isSpam };
    });
  }, [content, allLsiKeywords]);

  // Sort: unused first, then used
  const sortedLsi = useMemo(() =>
    [...lsiStatus].sort((a, b) => {
      if (a.found === b.found) return 0;
      return a.found ? 1 : -1;
    }),
    [lsiStatus]
  );

  const lsiFoundCount = lsiStatus.filter(s => s.found).length;
  const burstColor = getTrafficColor(burstiness.score);
  const aiColor = getAiSafetyColor(aiProb.score);
  const perplexityColor = getTrafficColor(perplexity.score);

  const handleAddCustomKeywords = useCallback(() => {
    if (!customInput.trim()) return;
    const newKws = customInput
      .split(/[,\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !allLsiKeywords.includes(s));
    setCustomKeywords(prev => [...prev, ...newKws]);
    setCustomInput("");
  }, [customInput, allLsiKeywords]);

  const handleToggleHighlight = useCallback(() => {
    const words = stopWords.map(sw => sw.word);
    if (stopWordsHighlighted) {
      onHighlightStopWords?.([]);
    } else {
      onHighlightStopWords?.(words);
    }
    setStopWordsHighlighted(!stopWordsHighlighted);
  }, [stopWords, stopWordsHighlighted, onHighlightStopWords]);

  if (wordCount < 30) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8 text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Сгенерируйте или вставьте текст для анализа на человечность
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── 1. AI Probability ─────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            AI Probability
            <Badge variant="outline" className={`ml-auto text-[10px] ${aiColor.text}`}>
              {aiColor.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Безопасность от детекторов</span>
              <span className={`font-bold ${aiColor.text}`}>{aiProb.score}%</span>
            </div>
            <Progress value={aiProb.score} className="h-2.5" indicatorClassName={aiColor.bg} />
          </div>
          <div className="space-y-1">
            {aiProb.flags.map((flag, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                {flag.passed ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                ) : (
                  <Circle className="h-3 w-3 text-red-500 shrink-0" />
                )}
                <span className={flag.passed ? "text-muted-foreground" : "text-red-400"}>
                  {flag.label}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── 2. Perplexity Score ───────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Perplexity Score
            <Badge variant="outline" className={`ml-auto text-[10px] ${perplexityColor.text}`}>
              {perplexity.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Сложность лексики</span>
              <span className={`font-bold ${perplexityColor.text}`}>{perplexity.score}%</span>
            </div>
            <Progress value={perplexity.score} className="h-2.5" indicatorClassName={perplexityColor.bg} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Ваш текст использует <span className={`font-semibold ${perplexityColor.text}`}>{perplexity.label.toLowerCase()}</span> словарный запас
          </p>
        </CardContent>
      </Card>

      {/* ─── 3. AI Stop-Words Detector ─────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            AI Stop-Words
            <Badge
              variant="outline"
              className={`ml-auto text-[10px] cursor-pointer ${
                stopWords.length === 0 ? "text-green-500" : stopWords.length <= 3 ? "text-yellow-500" : "text-red-500"
              }`}
              onClick={() => setShowStopWords(!showStopWords)}
            >
              {stopWords.length === 0 ? "Чисто ✓" : `${stopWords.reduce((s, w) => s + w.count, 0)} найдено`}
              {stopWords.length > 0 && (showStopWords ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stopWords.length === 0 ? (
            <p className="text-xs text-green-500 text-center py-2">
              <CheckCircle2 className="h-4 w-4 inline mr-1" />
              ИИ-клише не обнаружены
            </p>
          ) : (
            <>
              <Button
                size="sm"
                variant={stopWordsHighlighted ? "default" : "outline"}
                className="w-full text-xs h-7"
                onClick={handleToggleHighlight}
              >
                <Eye className="h-3 w-3 mr-1" />
                {stopWordsHighlighted ? "Скрыть подсветку" : "Подсветить в тексте"}
              </Button>
              {showStopWords && (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {stopWords.map((sw, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] bg-yellow-500/10 rounded px-2 py-1">
                      <span className="text-yellow-600 dark:text-yellow-400 font-mono">«{sw.word}»</span>
                      <Badge variant="outline" className="text-[9px] text-yellow-500">×{sw.count}</Badge>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                💡 Замените эти слова на более живые синонимы, чтобы снизить риск детекции
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── 4. Burstiness Index ───────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Burstiness Index
            <Badge variant="outline" className={`ml-auto text-[10px] ${burstColor.text}`}>
              {burstColor.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Разнообразие длины предложений</span>
              <span className="font-mono font-bold">{burstiness.score}%</span>
            </div>
            <Progress value={burstiness.score} className="h-2.5" indicatorClassName={burstColor.bg} />
            <p className="text-[10px] text-muted-foreground mt-1">
              Чем выше — тем больше вариация (как у человека)
            </p>
          </div>

          {/* Symmetry badge */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Структура:</span>
            <Badge
              variant="outline"
              className={`text-[10px] ${symmetry.isRobotic ? "text-red-500 border-red-500/30" : "text-green-500 border-green-500/30"}`}
            >
              {symmetry.isRobotic && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
              {symmetry.message}
            </Badge>
          </div>
          {symmetry.isRobotic && (
            <p className="text-[10px] text-yellow-500">
              ⚠ Слишком симметричный список — это признак ИИ. Измените длину пунктов.
            </p>
          )}

          {/* Mini bar chart */}
          {burstiness.lengths.length > 0 && (
            <div className="flex items-end gap-px h-10 mt-2">
              {burstiness.lengths.slice(0, 40).map((len, i) => {
                const maxL = Math.max(...burstiness.lengths.slice(0, 40));
                const h = maxL > 0 ? (len / maxL) * 100 : 0;
                const color = len <= 5 ? "bg-red-400" : len <= 15 ? "bg-yellow-400" : "bg-green-400";
                return (
                  <div
                    key={i}
                    className={`${color} rounded-t-sm opacity-70`}
                    style={{ height: `${h}%`, width: `${100 / Math.min(40, burstiness.lengths.length)}%`, minWidth: "2px" }}
                    title={`${len} слов`}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── 5. LSI Tracker ────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            LSI Tracker
            <Badge variant="outline" className="ml-auto text-[10px]">
              {lsiFoundCount}/{allLsiKeywords.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add custom keywords */}
          <div className="flex gap-1">
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Свои ключи через запятую..."
              className="h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleAddCustomKeywords()}
            />
            <Button size="sm" variant="outline" className="h-7 px-2 shrink-0" onClick={handleAddCustomKeywords}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {sortedLsi.length > 0 ? (
            <div className="space-y-1 max-h-[250px] overflow-y-auto">
              {sortedLsi.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 transition-colors ${
                    item.isSpam
                      ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                      : item.found
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {item.isSpam ? (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-500" />
                  ) : item.found ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 shrink-0" />
                  )}
                  <span className="font-mono text-[11px] flex-1">{item.keyword}</span>
                  {item.isSpam && (
                    <Badge variant="outline" className="text-[9px] text-yellow-500 border-yellow-500/30">
                      {item.density.toFixed(1)}% спам
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              Выберите ключевое слово для LSI
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
