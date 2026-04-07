import { useState, useMemo, useCallback } from "react";
import { sanitizeKeyword } from "@/shared/utils/sanitizeKeyword";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
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
  onOptimize?: (payload: { instructions: string; benchmarkContext: string }) => void;
}

interface BenchmarkMetric {
  label: string;
  icon: React.ReactNode;
  median: string;
  yours: string;
  status: "done" | "warning" | "error";
  statusLabel: string;
  weight: number;
  score: number;
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
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<string>("");
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<DeepParseResult | null>(null);
  const [seedKeyword, setSeedKeyword] = useState("");
  const [showEntities, setShowEntities] = useState(true);
  const [showStructure, setShowStructure] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  const loadBenchmark = useCallback(async () => {
    if (!session?.access_token) {
      toast.error(t("bench.sessionExpired"));
      return;
    }
    setLoading(true);
    setLoadingPhase("Загрузка данных...");
    try {
      const { data: kw } = await supabase
        .from("keywords")
        .select("seed_keyword")
        .eq("id", keywordId)
        .single();
      if (kw) setSeedKeyword(sanitizeKeyword(kw.seed_keyword));

      setLoadingPhase("Анализ конкурентов из ТОП-10...");
      const timer = setTimeout(() => setLoadingPhase("AI извлекает сущности..."), 8000);
      const data = await fetchAndAnalyze(keywordId, session.access_token, false);
      clearTimeout(timer);
      setResult(data);
      toast.success(`${t("bench.loaded")} (${data.benchmark.total_parsed} ${t("bench.competitors")})`);
    } catch (e: any) {
      toast.error(e.message || t("bench.loadError"));
    } finally {
      setLoading(false);
      setLoadingPhase("");
    }
  }, [keywordId, session, t]);

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

    const lsiTotal = [...result.must_use_phrases.map((p) => p.phrase), ...result.lsi_success_phrases];
    const lsiFound = lsiTotal.filter((p) => content.toLowerCase().includes(p.toLowerCase()));
    const lsiPercent = lsiTotal.length > 0 ? Math.round((lsiFound.length / lsiTotal.length) * 100) : 100;

    const entitiesTotal = result.entities.filter((e) => e.importance >= 5);
    const entitiesFound = entitiesTotal.filter((e) => content.toLowerCase().includes(e.name.toLowerCase()));
    const entityPercent = entitiesTotal.length > 0 ? Math.round((entitiesFound.length / entitiesTotal.length) * 100) : 100;

    const imgCount = (content.match(/!\[/g) || []).length;
    const hasVideo = /youtube|vimeo|rutube|видео|video/i.test(content);

    const m: BenchmarkMetric[] = [
      {
        label: t("bench.wordCount"),
        icon: <Type className="h-3.5 w-3.5" />,
        median: `${bm.median_word_count.toLocaleString()} ${t("bench.words")}`,
        yours: `${wordCount.toLocaleString()} ${t("bench.words")}`,
        status: wordCount >= bm.target_word_count ? "done" : wordCount >= bm.median_word_count * 0.7 ? "warning" : "error",
        statusLabel: wordCount >= bm.target_word_count ? `✅ ${t("bench.statusExcellent")}` : wordCount >= bm.median_word_count * 0.7 ? `⚠️ ${t("bench.statusNeedMore")} ${bm.target_word_count - wordCount}` : `❌ ${t("bench.statusLow")} (${t("bench.target")}: ${bm.target_word_count})`,
        weight: 20,
        score: Math.min(100, (wordCount / bm.target_word_count) * 100),
      },
      {
        label: t("bench.headings"),
        icon: <ListTree className="h-3.5 w-3.5" />,
        median: `${targetHeadings} ${t("bench.pcs")}`,
        yours: `${totalHeadings} ${t("bench.pcs")}`,
        status: totalHeadings >= targetHeadings ? "done" : totalHeadings >= targetHeadings * 0.6 ? "warning" : "error",
        statusLabel: totalHeadings >= targetHeadings ? `✅ ${t("bench.statusDone")}` : `⚠️ ${t("bench.statusNeedMore")} (+${targetHeadings - totalHeadings})`,
        weight: 10,
        score: Math.min(100, (totalHeadings / Math.max(targetHeadings, 1)) * 100),
      },
      {
        label: t("bench.kwDensity"),
        icon: <Hash className="h-3.5 w-3.5" />,
        median: `${bm.median_keyword_density}%`,
        yours: `${kwDensity}%`,
        status: kwDensity >= bm.median_keyword_density * 0.8 && kwDensity <= bm.median_keyword_density * 1.5 ? "done" : kwDensity > 0 ? "warning" : "error",
        statusLabel: kwDensity >= bm.median_keyword_density * 0.8 ? `✅ ${t("bench.statusInRange")}` : kwDensity > 0 ? `⚠️ ${t("bench.statusLowDensity")}` : `❌ ${t("bench.statusAbsent")}`,
        weight: 10,
        score: Math.min(100, (kwDensity / Math.max(bm.median_keyword_density, 0.1)) * 100),
      },
      {
        label: t("bench.lsiPhrases"),
        icon: <Zap className="h-3.5 w-3.5" />,
        median: `${lsiTotal.length} ${t("bench.phrases")}`,
        yours: `${lsiFound.length} ${t("bench.ofTotal")} ${lsiTotal.length}`,
        status: lsiPercent >= 70 ? "done" : lsiPercent >= 40 ? "warning" : "error",
        statusLabel: lsiPercent >= 70 ? `✅ ${t("bench.statusGood")}` : `⚠️ ${t("bench.statusAddMore")} ${lsiTotal.length - lsiFound.length}`,
        weight: 20,
        score: lsiPercent,
      },
      {
        label: t("bench.entities"),
        icon: <Globe className="h-3.5 w-3.5" />,
        median: `${entitiesTotal.length} ${t("bench.ofEntities")}`,
        yours: `${entityPercent}% ${t("bench.coverage")}`,
        status: entityPercent >= 80 ? "done" : entityPercent >= 50 ? "warning" : "error",
        statusLabel: entityPercent >= 80 ? `✅ ${t("bench.statusFullCoverage")}` : `❌ ${t("bench.statusMissed")} ${entitiesTotal.length - entitiesFound.length}`,
        weight: 30,
        score: entityPercent,
      },
      {
        label: t("bench.images"),
        icon: <Image className="h-3.5 w-3.5" />,
        median: `${bm.median_img_count} ${t("bench.pcs")}`,
        yours: `${imgCount} ${t("bench.pcs")}`,
        status: imgCount >= bm.target_img_count ? "done" : imgCount > 0 ? "warning" : "error",
        statusLabel: imgCount >= bm.target_img_count ? `✅ ${t("bench.statusDone")}` : `⚠️ ${t("bench.statusAddMedia")} (+${bm.target_img_count - imgCount})`,
        weight: 5,
        score: Math.min(100, (imgCount / Math.max(bm.target_img_count, 1)) * 100),
      },
      {
        label: t("bench.video"),
        icon: <Video className="h-3.5 w-3.5" />,
        median: bm.video_percentage > 50 ? t("bench.yes") : t("bench.optional"),
        yours: hasVideo ? t("bench.yes") : t("bench.no"),
        status: hasVideo || bm.video_percentage <= 50 ? "done" : "error",
        statusLabel: hasVideo ? `✅ ${t("bench.statusHasVideo")}` : bm.video_percentage > 50 ? `❌ ${t("bench.statusRecommended")}` : "—",
        weight: 5,
        score: hasVideo ? 100 : bm.video_percentage > 50 ? 0 : 100,
      },
    ];
    return m;
  }, [content, result, seedKeyword, t]);

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
      covered: myTexts.some((txt) => {
        const compLower = h.text.toLowerCase();
        const compWords = compLower.split(/\s+/).filter((w) => w.length > 3);
        return compWords.some((w) => txt.includes(w));
      }),
    }));
  }, [content, result]);

  // ── Metadata health ──
  const metaHealth = useMemo(() => {
    const checks = [];
    const titleLen = title.length;
    checks.push({
      label: t("bench.titleLength"),
      value: `${titleLen}/60`,
      ok: titleLen >= 30 && titleLen <= 60,
      hint: titleLen < 30 ? t("bench.tooShort") : titleLen > 60 ? t("bench.tooLong") : "OK",
    });
    const descLen = metaDescription.length;
    checks.push({
      label: t("bench.descLength"),
      value: `${descLen}/160`,
      ok: descLen >= 70 && descLen <= 160,
      hint: descLen < 70 ? t("bench.tooShort") : descLen > 160 ? t("bench.tooLong") : "OK",
    });
    if (seedKeyword) {
      const kwInTitle = title.toLowerCase().includes(seedKeyword.toLowerCase());
      checks.push({
        label: t("bench.kwInTitle"),
        value: kwInTitle ? "✅" : "❌",
        ok: kwInTitle,
        hint: kwInTitle ? t("bench.kwFound") : t("bench.addKwToTitle"),
      });
      const firstParagraph = content.split("\n\n")[0] || "";
      const kwInFirst = firstParagraph.toLowerCase().includes(seedKeyword.toLowerCase());
      checks.push({
        label: t("bench.kwInFirstP"),
        value: kwInFirst ? "✅" : "❌",
        ok: kwInFirst,
        hint: kwInFirst ? t("bench.kwFound") : t("bench.mentionKwFirstP"),
      });
      const h1Match = content.match(/^#\s+(.+)$/m);
      const kwInH1 = h1Match ? h1Match[1].toLowerCase().includes(seedKeyword.toLowerCase()) : false;
      checks.push({
        label: t("bench.kwInH1"),
        value: kwInH1 ? "✅" : "❌",
        ok: kwInH1,
        hint: kwInH1 ? t("bench.kwFound") : t("bench.addKwToH1"),
      });
    }
    return checks;
  }, [title, metaDescription, content, seedKeyword, t]);

  // ── Optimize handler ──
  const handleOptimize = useCallback(async () => {
    if (!result || !onOptimize) return;
    setOptimizing(true);
    try {
      const issues: string[] = [];
      for (const m of metrics) {
        if (m.status !== "done") {
          issues.push(`${m.label}: ${m.yours}, ${t("bench.target")} ${m.median}. ${m.statusLabel}`);
        }
      }
      if (entityCoverage.missing.length > 0) {
        issues.push(`${t("bench.statusMissed")}: ${entityCoverage.missing.map((e) => e.name).join(", ")}`);
      }

      const missingStructure = (structureComparison || [])
        .filter((h) => !h.covered && h.level <= 3)
        .slice(0, 10)
        .map((h) => `${"#".repeat(h.level)} ${h.text}`);

      const topEntities = result.entities
        .filter((e) => e.importance >= 5)
        .slice(0, 15)
        .map((e) => `${e.name} (${e.type}, ${e.importance}/10)`);

      const mustUsePhrases = result.must_use_phrases
        .slice(0, 12)
        .map((p) => `${p.phrase} — ${p.reason}`);

      const tfidfRecommendations = result.tfidf_phrases
        .slice(0, 10)
        .map((p) => `${p.phrase} (TF-IDF ${p.tfidf.toFixed(2)})`);

      const top10Recommendations = [
        `Целевой объём статьи: ${result.benchmark.target_word_count} слов (медиана TOP-10: ${result.benchmark.median_word_count})`,
        `Целевое число H2: ${result.benchmark.target_h2_count}, медиана H3: ${result.benchmark.median_h3_count}`,
        `Целевое число изображений: ${result.benchmark.target_img_count}`,
        `Целевая плотность ключа: около ${result.benchmark.median_keyword_density}%`,
        result.benchmark.video_percentage > 50 ? `У ${result.benchmark.video_percentage}% страниц из TOP-10 есть видео — добавь видеоблок или упоминание видеоформата.` : null,
        missingStructure.length > 0 ? `Добавь недостающие блоки структуры из лидеров TOP-10:\n${missingStructure.map((item) => `- ${item}`).join("\n")}` : null,
        entityCoverage.missing.length > 0 ? `Обязательно раскрой отсутствующие сущности:\n- ${entityCoverage.missing.map((e) => e.name).join("\n- ")}` : null,
        mustUsePhrases.length > 0 ? `Добавь фразы, которые часто встречаются у TOP-10:\n${mustUsePhrases.map((item) => `- ${item}`).join("\n")}` : null,
        tfidfRecommendations.length > 0 ? `Усиль тематическую релевантность через термины TOP-10:\n${tfidfRecommendations.map((item) => `- ${item}`).join("\n")}` : null,
        topEntities.length > 0 ? `Ориентир по сущностям из TOP-10:\n${topEntities.map((item) => `- ${item}`).join("\n")}` : null,
      ].filter(Boolean).join("\n\n");

      const instructions = `${t("bench.scorePoints")}: ${overallScore}/100.\n\n${t("bench.problemZones")}:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nРЕКОМЕНДАЦИИ НА ОСНОВЕ СРАВНЕНИЯ С TOP-10:\n${top10Recommendations}\n\nДополни статью экспертными блоками, раскрывающими пропущенные сущности. Добавь LSI-фразы, термины и структурные блоки, которые реально встречаются у лидеров выдачи. Доведи объём до целевого. Сохрани стиль и тональность.`;

      const benchmarkContext = buildAnalysisContext(result);

      onOptimize({ instructions, benchmarkContext });
      toast.success(t("bench.optimizeSent"));
    } finally {
      setOptimizing(false);
    }
  }, [result, metrics, entityCoverage, overallScore, onOptimize, structureComparison, t]);

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
            {t("bench.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {t("bench.loadDesc")}
          </p>
          <Button
            onClick={loadBenchmark}
            disabled={loading || !keywordId}
            className="gap-2 w-full"
            variant="outline"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />{loadingPhase || t("bench.loading")}</>
            ) : (
              <><Target className="h-4 w-4" />{t("bench.loadBtn")}</>
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
            {t("bench.healthScore")}
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
                {overallScore >= 80 ? t("bench.excellent") : overallScore >= 50 ? t("bench.needsWork") : t("bench.critical")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t("bench.weightedScore")} {metrics.length} {t("bench.params")}
              </p>
              {onOptimize && overallScore < 90 && (
                <Button
                  size="sm"
                  onClick={handleOptimize}
                  disabled={optimizing}
                  className="gap-1.5 mt-1 h-7 text-xs"
                >
                  {optimizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {t("bench.optimizeBtn")}
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
            {t("bench.compareTop")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-hidden">
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] pl-4">{t("bench.colParam")}</TableHead>
                <TableHead className="text-[10px] text-right">{t("bench.colMedian")}</TableHead>
                <TableHead className="text-[10px] text-right">{t("bench.colYours")}</TableHead>
                <TableHead className="text-[10px] text-right pr-4">{t("bench.colStatus")}</TableHead>
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
                {t("bench.entityCoverage")}
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
                  <p className="text-[10px] font-medium text-destructive uppercase tracking-wider">{t("bench.missed")}</p>
                  <div className="flex flex-wrap gap-1">
                    {entityCoverage.missing.map((e, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="text-[10px] cursor-pointer bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20 transition-colors"
                        title={`${e.type} | ${e.importance}/10`}
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
                  <p className="text-[10px] font-medium text-success uppercase tracking-wider">{t("bench.found")}</p>
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
                  {t("bench.structureMap")}
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
                {t("bench.metaHealth")}
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
