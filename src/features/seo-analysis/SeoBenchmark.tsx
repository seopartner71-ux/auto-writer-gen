import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { fetchAndAnalyze, buildAnalysisContext, type DeepParseResult, type Entity } from "@/entities/competitor/analysisService";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, Zap, CheckCircle2, AlertTriangle, XCircle,
  Type, Image, Video, FileText, Hash, Globe, ListTree,
  ChevronDown, ChevronRight, Wand2, Target,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────

interface SeoBenchmarkProps {
  keywordId: string;
  content: string;
  title: string;
  metaDescription: string;
  onOptimize?: (instructions: string) => void;
}

interface BenchmarkMetric {
  label: string;
  icon: React.ReactNode;
  median: string;
  yours: string;
  status: "done" | "warning" | "error";
  statusLabel: string;
  weight: number;
  score: number; // 0-100
}

// ── Helpers ────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.replace(/[#*_`>\-|]/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function extractHeadings(md: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  const lines = md.split("\n");
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) headings.push({ level: match[1].length, text: match[2].trim() });
  }
  return headings;
}

function calcKeywordDensity(text: string, keyword: string): number {
  if (!keyword || !text) return 0;
  const words = countWords(text);
  if (words === 0) return 0;
  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches = text.match(re) || [];
  return parseFloat(((matches.length / words) * 100).toFixed(2));
}

const statusIcon = (s: "done" | "warning" | "error") => {
  if (s === "done") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (s === "warning") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
};

const scoreColor = (score: number) => {
  if (score >= 80) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-destructive";
};

const scoreGradient = (score: number) => {
  if (score >= 80) return "hsl(var(--success))";
  if (score >= 50) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
};

// ── Component ──────────────────────────────────────────────────────────

export function SeoBenchmark({ keywordId, content, title, metaDescription, onOptimize }: SeoBenchmarkProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<DeepParseResult | null>(null);
  const [seedKeyword, setSeedKeyword] = useState("");
  const [showEntities, setShowEntities] = useState(true);
  const [showStructure, setShowStructure] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  // Load benchmark data
  const loadBenchmark = useCallback(async () => {
    if (!session?.access_token) {
      toast.error("Сессия истекла");
      return;
    }
    setLoading(true);
    try {
      // Get keyword for seed_keyword
      const { data: kw } = await supabase
        .from("keywords")
        .select("seed_keyword")
        .eq("id", keywordId)
        .single();
      if (kw) setSeedKeyword(kw.seed_keyword);

      const data = await fetchAndAnalyze(keywordId, session.access_token, false);
      setResult(data);
      toast.success(`Benchmark загружен (${data.benchmark.total_parsed} конкурентов)`);
    } catch (e: any) {
      toast.error(e.message || "Ошибка загрузки бенчмарка");
    } finally {
      setLoading(false);
    }
  }, [keywordId, session]);

  // ── Real-time metrics ──
  const metrics = useMemo((): BenchmarkMetric[] => {
    if (!result) return [];
    const bm = result.benchmark;

    const wordCount = countWords(content);
    const headings = extractHeadings(content);
    const h2Count = headings.filter((h) => h.level === 2).length;
    const h3Count = headings.filter((h) => h.level === 3).length;
    const totalHeadings = h2Count + h3Count;
    const targetHeadings = bm.median_h2_count + bm.median_h3_count;
    const kwDensity = calcKeywordDensity(content, seedKeyword);

    // LSI coverage
    const lsiTotal = [...result.must_use_phrases.map((p) => p.phrase), ...result.lsi_success_phrases];
    const lsiFound = lsiTotal.filter((p) => content.toLowerCase().includes(p.toLowerCase()));
    const lsiPercent = lsiTotal.length > 0 ? Math.round((lsiFound.length / lsiTotal.length) * 100) : 100;

    // Entity coverage
    const entitiesTotal = result.entities.filter((e) => e.importance >= 5);
    const entitiesFound = entitiesTotal.filter((e) => content.toLowerCase().includes(e.name.toLowerCase()));
    const entityPercent = entitiesTotal.length > 0 ? Math.round((entitiesFound.length / entitiesTotal.length) * 100) : 100;

    // Image count (estimate from markdown ![])
    const imgCount = (content.match(/!\[/g) || []).length;
    const hasVideo = /youtube|vimeo|rutube|видео|video/i.test(content);

    const m: BenchmarkMetric[] = [
      {
        label: "Объем текста",
        icon: <Type className="h-3.5 w-3.5" />,
        median: `${bm.median_word_count.toLocaleString()} слов`,
        yours: `${wordCount.toLocaleString()} слов`,
        status: wordCount >= bm.target_word_count ? "done" : wordCount >= bm.median_word_count * 0.7 ? "warning" : "error",
        statusLabel: wordCount >= bm.target_word_count ? "✅ Отлично" : wordCount >= bm.median_word_count * 0.7 ? `⚠️ Нужно ещё ${bm.target_word_count - wordCount}` : `❌ Мало (цель: ${bm.target_word_count})`,
        weight: 20,
        score: Math.min(100, (wordCount / bm.target_word_count) * 100),
      },
      {
        label: "Заголовки (H2+H3)",
        icon: <ListTree className="h-3.5 w-3.5" />,
        median: `${targetHeadings} шт.`,
        yours: `${totalHeadings} шт.`,
        status: totalHeadings >= targetHeadings ? "done" : totalHeadings >= targetHeadings * 0.6 ? "warning" : "error",
        statusLabel: totalHeadings >= targetHeadings ? "✅ Done" : `⚠️ Нужно больше (+${targetHeadings - totalHeadings})`,
        weight: 10,
        score: Math.min(100, (totalHeadings / Math.max(targetHeadings, 1)) * 100),
      },
      {
        label: "Плотность ключа",
        icon: <Hash className="h-3.5 w-3.5" />,
        median: `${bm.median_keyword_density}%`,
        yours: `${kwDensity}%`,
        status: kwDensity >= bm.median_keyword_density * 0.8 && kwDensity <= bm.median_keyword_density * 1.5 ? "done" : kwDensity > 0 ? "warning" : "error",
        statusLabel: kwDensity >= bm.median_keyword_density * 0.8 ? "✅ В норме" : kwDensity > 0 ? "⚠️ Низкая" : "❌ Отсутствует",
        weight: 10,
        score: Math.min(100, (kwDensity / Math.max(bm.median_keyword_density, 0.1)) * 100),
      },
      {
        label: "LSI-фразы",
        icon: <Zap className="h-3.5 w-3.5" />,
        median: `${lsiTotal.length} фраз`,
        yours: `${lsiFound.length} из ${lsiTotal.length}`,
        status: lsiPercent >= 70 ? "done" : lsiPercent >= 40 ? "warning" : "error",
        statusLabel: lsiPercent >= 70 ? "✅ Хорошо" : `⚠️ Добавьте ещё ${lsiTotal.length - lsiFound.length}`,
        weight: 20,
        score: lsiPercent,
      },
      {
        label: "Entities (Сущности)",
        icon: <Globe className="h-3.5 w-3.5" />,
        median: `${entitiesTotal.length} сущностей`,
        yours: `${entityPercent}% охвата`,
        status: entityPercent >= 80 ? "done" : entityPercent >= 50 ? "warning" : "error",
        statusLabel: entityPercent >= 80 ? "✅ Полный охват" : `❌ Пропущено ${entitiesTotal.length - entitiesFound.length}`,
        weight: 30,
        score: entityPercent,
      },
      {
        label: "Изображения",
        icon: <Image className="h-3.5 w-3.5" />,
        median: `${bm.median_img_count} шт.`,
        yours: `${imgCount} шт.`,
        status: imgCount >= bm.target_img_count ? "done" : imgCount > 0 ? "warning" : "error",
        statusLabel: imgCount >= bm.target_img_count ? "✅ Done" : `⚠️ Добавьте медиа (+${bm.target_img_count - imgCount})`,
        weight: 5,
        score: Math.min(100, (imgCount / Math.max(bm.target_img_count, 1)) * 100),
      },
      {
        label: "Наличие Video",
        icon: <Video className="h-3.5 w-3.5" />,
        median: bm.video_percentage > 50 ? "Да" : "Опционально",
        yours: hasVideo ? "Да" : "Нет",
        status: hasVideo || bm.video_percentage <= 50 ? "done" : "error",
        statusLabel: hasVideo ? "✅ Есть" : bm.video_percentage > 50 ? "❌ Рекомендуется" : "—",
        weight: 5,
        score: hasVideo ? 100 : bm.video_percentage > 50 ? 0 : 100,
      },
    ];
    return m;
  }, [content, result, seedKeyword]);

  // ── Overall Score ──
  const overallScore = useMemo(() => {
    if (metrics.length === 0) return 0;
    const totalWeight = metrics.reduce((s, m) => s + m.weight, 0);
    const weighted = metrics.reduce((s, m) => s + m.score * m.weight, 0);
    return Math.round(weighted / totalWeight);
  }, [metrics]);

  // ── Entity coverage detail ──
  const entityCoverage = useMemo(() => {
    if (!result) return { found: [], missing: [] };
    const important = result.entities.filter((e) => e.importance >= 5);
    const lower = content.toLowerCase();
    return {
      found: important.filter((e) => lower.includes(e.name.toLowerCase())),
      missing: important.filter((e) => !lower.includes(e.name.toLowerCase())),
    };
  }, [content, result]);

  // ── Structure comparison ──
  const structureComparison = useMemo(() => {
    if (!result?.best_competitor_headings) return null;
    const myHeadings = extractHeadings(content);
    const compHeadings = result.best_competitor_headings.headings.filter((h) => h.level <= 3);
    const myTexts = myHeadings.map((h) => h.text.toLowerCase());
    return compHeadings.map((h) => ({
      ...h,
      covered: myTexts.some((t) => {
        const compLower = h.text.toLowerCase();
        // Fuzzy match: check if any significant words overlap
        const compWords = compLower.split(/\s+/).filter((w) => w.length > 3);
        return compWords.some((w) => t.includes(w));
      }),
    }));
  }, [content, result]);

  // ── Metadata health ──
  const metaHealth = useMemo(() => {
    const checks = [];
    const titleLen = title.length;
    checks.push({
      label: "Title длина",
      value: `${titleLen}/60`,
      ok: titleLen >= 30 && titleLen <= 60,
      hint: titleLen < 30 ? "Слишком коротко" : titleLen > 60 ? "Слишком длинно" : "OK",
    });
    const descLen = metaDescription.length;
    checks.push({
      label: "Description длина",
      value: `${descLen}/160`,
      ok: descLen >= 70 && descLen <= 160,
      hint: descLen < 70 ? "Слишком коротко" : descLen > 160 ? "Слишком длинно" : "OK",
    });
    if (seedKeyword) {
      const kwInTitle = title.toLowerCase().includes(seedKeyword.toLowerCase());
      checks.push({
        label: "Ключ в Title",
        value: kwInTitle ? "✅" : "❌",
        ok: kwInTitle,
        hint: kwInTitle ? "Найден" : "Добавьте ключевое слово в заголовок",
      });
      const firstParagraph = content.split("\n\n")[0] || "";
      const kwInFirst = firstParagraph.toLowerCase().includes(seedKeyword.toLowerCase());
      checks.push({
        label: "Ключ в 1-м абзаце",
        value: kwInFirst ? "✅" : "❌",
        ok: kwInFirst,
        hint: kwInFirst ? "Найден" : "Упомяните ключевое слово в первом абзаце",
      });
      const h1Match = content.match(/^#\s+(.+)$/m);
      const kwInH1 = h1Match ? h1Match[1].toLowerCase().includes(seedKeyword.toLowerCase()) : false;
      checks.push({
        label: "Ключ в H1",
        value: kwInH1 ? "✅" : "❌",
        ok: kwInH1,
        hint: kwInH1 ? "Найден" : "Добавьте ключевое слово в H1",
      });
    }
    return checks;
  }, [title, metaDescription, content, seedKeyword]);

  // ── Optimize handler ──
  const handleOptimize = useCallback(async () => {
    if (!result || !onOptimize) return;
    setOptimizing(true);
    try {
      const issues: string[] = [];
      for (const m of metrics) {
        if (m.status !== "done") {
          issues.push(`${m.label}: текущее значение ${m.yours}, цель ${m.median}. ${m.statusLabel}`);
        }
      }
      if (entityCoverage.missing.length > 0) {
        issues.push(`Пропущенные сущности: ${entityCoverage.missing.map((e) => e.name).join(", ")}`);
      }

      const instructions = `Статья набрала ${overallScore} баллов из 100.\n\nПроблемные зоны:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nДополни статью экспертными блоками, раскрывающими пропущенные сущности. Добавь LSI-фразы. Доведи объём до целевого. Сохрани стиль и тональность.`;

      onOptimize(instructions);
      toast.success("Инструкции для оптимизации переданы");
    } finally {
      setOptimizing(false);
    }
  }, [result, metrics, entityCoverage, overallScore, onOptimize]);

  // ── Chart data ──
  const chartData = [
    { name: "Score", value: overallScore },
    { name: "Remaining", value: 100 - overallScore },
  ];

  // ── No data state ──
  if (!result) {
    return (
      <Card className="bg-card border-border sticky top-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            SEO Benchmark
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Загрузите данные конкурентов для сравнения в реальном времени
          </p>
          <Button
            onClick={loadBenchmark}
            disabled={loading || !keywordId}
            className="gap-2 w-full"
            variant="outline"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Загрузка...</>
            ) : (
              <><Target className="h-4 w-4" />Загрузить Benchmark</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 sticky top-4">
      {/* ── Content Health Score (Donut) ── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Content Health Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={42}
                    startAngle={90}
                    endAngle={-270}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    <Cell fill={scoreGradient(overallScore)} />
                    <Cell fill="hsl(var(--muted))" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-xl font-bold ${scoreColor(overallScore)}`}>
                  {overallScore}
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <p className={`text-sm font-semibold ${scoreColor(overallScore)}`}>
                {overallScore >= 80 ? "Отлично!" : overallScore >= 50 ? "Нужна доработка" : "Критически мало"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Средневзвешенный балл по {metrics.length} параметрам
              </p>
              {onOptimize && overallScore < 90 && (
                <Button
                  size="sm"
                  onClick={handleOptimize}
                  disabled={optimizing}
                  className="gap-1.5 mt-1 h-7 text-xs"
                >
                  {optimizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  Подтянуть до ТОПа
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Comparison Table ── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Сравнение с ТОП-10
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] pl-4">Параметр</TableHead>
                <TableHead className="text-[10px] text-right">Медиана</TableHead>
                <TableHead className="text-[10px] text-right">Ваша</TableHead>
                <TableHead className="text-[10px] text-right pr-4">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs pl-4 flex items-center gap-1.5">
                    <span className="text-muted-foreground">{m.icon}</span>
                    {m.label}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{m.median}</TableCell>
                  <TableCell className="text-xs text-right font-mono font-semibold">{m.yours}</TableCell>
                  <TableCell className="text-right pr-4">
                    {statusIcon(m.status)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Entity Coverage ── */}
      <Card className="bg-card border-border">
        <Collapsible open={showEntities} onOpenChange={setShowEntities}>
          <CardHeader className="pb-2">
            <CollapsibleTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                <Globe className="h-4 w-4 text-primary" />
                Entity Coverage
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {entityCoverage.found.length}/{entityCoverage.found.length + entityCoverage.missing.length}
                </Badge>
                {showEntities ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </CardTitle>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-2">
              {entityCoverage.missing.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-destructive uppercase tracking-wider">Пропущены</p>
                  <div className="flex flex-wrap gap-1">
                    {entityCoverage.missing.map((e, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="text-[10px] cursor-pointer bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20 transition-colors"
                        title={`${e.type} | Важность: ${e.importance}/10. Нажмите для рекомендации`}
                      >
                        <XCircle className="h-2.5 w-2.5 mr-1" />
                        {e.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {entityCoverage.found.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-success uppercase tracking-wider">Найдены</p>
                  <div className="flex flex-wrap gap-1">
                    {entityCoverage.found.map((e, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="text-[10px] bg-success/10 text-success border-success/30"
                      >
                        <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                        {e.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ── Structure Comparison ── */}
      {structureComparison && structureComparison.length > 0 && (
        <Card className="bg-card border-border">
          <Collapsible open={showStructure} onOpenChange={setShowStructure}>
            <CardHeader className="pb-2">
              <CollapsibleTrigger asChild>
                <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                  <ListTree className="h-4 w-4 text-primary" />
                  Карта структуры
                  {showStructure ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
                </CardTitle>
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-0.5 max-h-[300px] overflow-y-auto">
                {structureComparison.map((h, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 py-1 text-xs ${h.level === 3 ? "pl-4" : ""}`}
                  >
                    {h.covered ? (
                      <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 text-destructive shrink-0" />
                    )}
                    <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono shrink-0">
                      H{h.level}
                    </Badge>
                    <span className={h.covered ? "text-muted-foreground" : "font-medium"}>{h.text}</span>
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* ── Metadata Health ── */}
      <Card className="bg-card border-border">
        <Collapsible open={showMeta} onOpenChange={setShowMeta}>
          <CardHeader className="pb-2">
            <CollapsibleTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                <FileText className="h-4 w-4 text-primary" />
                Metadata Health
                {showMeta ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
              </CardTitle>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-1.5">
              {metaHealth.map((check, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{check.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono">{check.value}</span>
                    {check.ok ? (
                      <CheckCircle2 className="h-3 w-3 text-success" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-warning" />
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}
