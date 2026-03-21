import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  BarChart3, FileText, Hash, BookOpen, Target, CheckCircle2,
  Circle, AlertTriangle, TrendingUp, Search, Award, ShieldCheck, Loader2, Bot
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";

// ── helpers ──────────────────────────────────────────────
function countWords(t: string) { return t.trim().split(/\s+/).filter(Boolean).length; }
function countSentences(t: string) { return (t.match(/[.!?]+/g) || []).length || 1; }
function countSyllables(w: string) {
  w = w.toLowerCase().replace(/[^a-zа-яё]/g, "");
  if (w.length <= 3) return 1;
  return (w.match(/[aeiouyаеёиоуыэюя]+/gi) || []).length || 1;
}
function fleschScore(t: string) {
  const words = countWords(t);
  if (words < 10) return 0;
  const sentences = countSentences(t);
  const syllables = t.split(/\s+/).reduce((s, w) => s + countSyllables(w), 0);
  return Math.max(0, Math.min(100, Math.round(206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words))));
}
function readabilityLabel(s: number) {
  if (s >= 70) return { label: "Легко читается", color: "text-success" };
  if (s >= 50) return { label: "Средняя сложность", color: "text-warning" };
  return { label: "Сложный текст", color: "text-destructive" };
}

function keywordDensity(text: string, keyword: string) {
  if (!keyword || !text) return 0;
  const words = countWords(text);
  if (words === 0) return 0;
  const kw = keyword.toLowerCase();
  const matches = text.toLowerCase().split(kw).length - 1;
  return Math.round((matches / words) * 100 * 100) / 100;
}

function headingStructure(text: string) {
  const h1 = (text.match(/^# [^\n]+/gm) || []).length;
  const h2 = (text.match(/^## [^\n]+/gm) || []).length;
  const h3 = (text.match(/^### [^\n]+/gm) || []).length;
  return { h1, h2, h3 };
}

function uniqueSentences(text: string): number {
  const sentences = text.split(/[.!?]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 20);
  if (sentences.length === 0) return 100;
  const unique = new Set(sentences);
  return Math.round((unique.size / sentences.length) * 100);
}

function waterLevel(text: string): number {
  // "водность" — stopwords ratio
  const stopwords = new Set([
    "и", "в", "на", "с", "по", "для", "из", "к", "от", "за", "до", "о", "об", "при",
    "не", "но", "а", "что", "как", "это", "так", "же", "уже", "ещё", "еще", "бы",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has",
    "had", "do", "does", "did", "will", "would", "could", "should", "may", "might",
    "shall", "can", "need", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below", "between",
    "out", "off", "over", "under", "again", "further", "then", "once", "it", "its",
    "this", "that", "these", "those", "he", "she", "they", "we", "you", "i", "me",
    "him", "her", "us", "them", "my", "your", "his", "their", "our", "which", "who",
    "whom", "whose", "where", "when", "why", "how", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "because", "if", "or", "and", "but",
  ]);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const sw = words.filter(w => stopwords.has(w.replace(/[^a-zа-яё]/g, ""))).length;
  return Math.round((sw / words.length) * 100);
}

// ── component ────────────────────────────────────────────
export default function AnalyticsPage() {
  const { t } = useI18n();
  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [uniquenessResult, setUniquenessResult] = useState<any>(null);

  const checkUniqueness = useMutation({
    mutationFn: async (text: string) => {
      const { data, error } = await supabase.functions.invoke("check-uniqueness", {
        body: { content: text },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data.analysis;
    },
    onSuccess: (data) => {
      setUniquenessResult(data);
      toast.success(t("analytics.uniquenessCheck") + ": " + data.overall_score + "%");
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: articles = [] } = useQuery({
    queryKey: ["analytics-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, content, meta_description, keyword_id, seo_score, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: keywords = [] } = useQuery({
    queryKey: ["analytics-keywords"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keywords")
        .select("id, seed_keyword, lsi_keywords, intent, difficulty")
        .not("intent", "is", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: usageLogs = [] } = useQuery({
    queryKey: ["analytics-usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_logs")
        .select("action, tokens_used, model_used, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const article = articles.find((a: any) => a.id === selectedArticleId);
  const kw = article ? keywords.find((k: any) => k.id === article.keyword_id) : null;
  const content = article?.content || "";
  const seedKeyword = kw?.seed_keyword || "";
  const lsiKeywords: string[] = (kw?.lsi_keywords as string[]) || [];

  // Metrics
  const words = useMemo(() => countWords(content), [content]);
  const readability = useMemo(() => fleschScore(content), [content]);
  const readInfo = readabilityLabel(readability);
  const density = useMemo(() => keywordDensity(content, seedKeyword), [content, seedKeyword]);
  const headings = useMemo(() => headingStructure(content), [content]);
  const uniqueness = useMemo(() => uniqueSentences(content), [content]);
  const water = useMemo(() => waterLevel(content), [content]);

  const lsiStatus = useMemo(() => {
    const lower = content.toLowerCase();
    return lsiKeywords.map(k => ({ keyword: k, found: lower.includes(k.toLowerCase()) }));
  }, [content, lsiKeywords]);
  const lsiCoverage = lsiKeywords.length > 0
    ? Math.round((lsiStatus.filter(s => s.found).length / lsiKeywords.length) * 100)
    : 0;

  // Meta analysis
  const metaLen = article?.meta_description?.length || 0;
  const titleLen = article?.title?.length || 0;

  // SEO score aggregate
  const seoScore = useMemo(() => {
    if (!content) return 0;
    let score = 0;
    // Word count (max 20)
    if (words >= 1500) score += 20;
    else if (words >= 800) score += 10;
    else if (words >= 300) score += 5;
    // Readability (max 15)
    if (readability >= 60) score += 15;
    else if (readability >= 40) score += 10;
    else score += 5;
    // Keyword density (max 15) — ideal 1-3%
    if (density >= 0.5 && density <= 3) score += 15;
    else if (density > 0 && density < 5) score += 8;
    // Headings (max 15)
    if (headings.h1 === 1) score += 5;
    if (headings.h2 >= 3) score += 5;
    if (headings.h3 >= 2) score += 5;
    // LSI (max 15)
    if (lsiCoverage >= 70) score += 15;
    else if (lsiCoverage >= 40) score += 10;
    else if (lsiCoverage > 0) score += 5;
    // Meta (max 10)
    if (titleLen >= 30 && titleLen <= 60) score += 5;
    if (metaLen >= 120 && metaLen <= 160) score += 5;
    // Uniqueness (max 10)
    if (uniqueness >= 90) score += 10;
    else if (uniqueness >= 70) score += 5;
    return Math.min(100, score);
  }, [words, readability, density, headings, lsiCoverage, titleLen, metaLen, uniqueness, content]);

  const seoColor = seoScore >= 80 ? "text-success" : seoScore >= 50 ? "text-warning" : "text-destructive";
  const seoLabel = seoScore >= 80 ? "Отлично" : seoScore >= 50 ? "Нормально" : "Слабо";

  // Global stats
  const totalArticles = articles.length;
  const totalWords = articles.reduce((s: number, a: any) => s + countWords(a.content || ""), 0);
  const totalTokens = usageLogs.reduce((s: number, l: any) => s + (l.tokens_used || 0), 0);
  const avgSeo = totalArticles > 0
    ? Math.round(articles.reduce((s: number, a: any) => {
        const sc = a.seo_score as any;
        return s + (sc?.readability || 0);
      }, 0) / totalArticles)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Аналитика</h1>
          <p className="text-sm text-muted-foreground">SEO-аудит статей и общая статистика</p>
        </div>
      </div>

      {/* Global Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Всего статей</div>
            <span className="text-2xl font-bold">{totalArticles}</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Общий объём</div>
            <span className="text-2xl font-bold">{totalWords.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground ml-1">слов</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">AI токены</div>
            <span className="text-2xl font-bold">{totalTokens.toLocaleString()}</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Запросы</div>
            <span className="text-2xl font-bold">{usageLogs.length}</span>
          </CardContent>
        </Card>
      </div>

      {/* Article Selector */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Выберите статью для анализа</label>
            <Select value={selectedArticleId} onValueChange={setSelectedArticleId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите статью..." />
              </SelectTrigger>
              <SelectContent>
                {articles.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title || "Без названия"} ({a.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {article ? (
        <div className="space-y-6">
          {/* SEO Score Hero */}
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center gap-6">
                <div className="relative flex items-center justify-center">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" className="stroke-muted" />
                    <circle
                      cx="50" cy="50" r="42" fill="none" strokeWidth="8"
                      strokeDasharray={`${seoScore * 2.64} 264`}
                      strokeLinecap="round"
                      className={seoScore >= 80 ? "stroke-success" : seoScore >= 50 ? "stroke-warning" : "stroke-destructive"}
                    />
                  </svg>
                  <span className={`absolute text-2xl font-bold ${seoColor}`}>{seoScore}</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold">SEO Score: <span className={seoColor}>{seoLabel}</span></h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Оценка на основе объёма, читаемости, плотности ключей, структуры и мета-данных
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Content Metrics */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Контент-метрики
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <MetricRow label="Слова" value={words.toLocaleString()} target="1500–2500" pct={Math.min(100, (words / 2000) * 100)} />
                <MetricRow
                  label="Читаемость (Flesch)"
                  value={`${readability} — ${readInfo.label}`}
                  valueClass={readInfo.color}
                  pct={readability}
                />
                <MetricRow
                  label="Водность"
                  value={`${water}%`}
                  target="< 60%"
                  valueClass={water > 60 ? "text-destructive" : water > 40 ? "text-warning" : "text-success"}
                  pct={water}
                />
                <MetricRow
                  label="Уникальность предложений"
                  value={`${uniqueness}%`}
                  target="> 85%"
                  valueClass={uniqueness >= 85 ? "text-success" : uniqueness >= 70 ? "text-warning" : "text-destructive"}
                  pct={uniqueness}
                />
              </CardContent>
            </Card>

            {/* SEO Metrics */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  SEO-метрики
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {seedKeyword ? (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Маркерный запрос</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{seedKeyword}</Badge>
                    </div>
                    <MetricRow
                      label="Плотность ключа"
                      value={`${density}%`}
                      target="1–3%"
                      valueClass={density >= 0.5 && density <= 3 ? "text-success" : density > 3 ? "text-destructive" : "text-warning"}
                      pct={Math.min(100, density * 20)}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Нет привязанного ключевого слова</p>
                )}

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Структура заголовков</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <HeadingBadge level="H1" count={headings.h1} ideal={1} />
                    <HeadingBadge level="H2" count={headings.h2} ideal={5} />
                    <HeadingBadge level="H3" count={headings.h3} ideal={3} />
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Title</span>
                    <span className={titleLen >= 30 && titleLen <= 60 ? "text-success" : "text-warning"}>
                      {titleLen}/60
                    </span>
                  </div>
                  <Progress value={Math.min(100, (titleLen / 60) * 100)} className="h-1.5" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Meta Description</span>
                    <span className={metaLen >= 120 && metaLen <= 160 ? "text-success" : "text-warning"}>
                      {metaLen}/160
                    </span>
                  </div>
                  <Progress value={Math.min(100, (metaLen / 160) * 100)} className="h-1.5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* LSI Coverage */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-primary" />
                  LSI-покрытие
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {lsiStatus.filter(s => s.found).length}/{lsiKeywords.length} ({lsiCoverage}%)
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lsiStatus.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {lsiStatus.map((item, i) => (
                    <Badge
                      key={i}
                      variant={item.found ? "default" : "outline"}
                      className={`text-xs font-mono ${
                        item.found ? "bg-success/20 text-success border-success/30" : "text-muted-foreground"
                      }`}
                    >
                      {item.found ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Circle className="h-3 w-3 mr-1" />}
                      {item.keyword}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Нет LSI-ключевых слов для этой статьи
                </p>
              )}
            </CardContent>
          </Card>

          {/* SEO Checklist */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                SEO-чеклист
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <CheckItem ok={headings.h1 === 1} text="Один H1 заголовок" />
              <CheckItem ok={headings.h2 >= 3} text="Минимум 3 подзаголовка H2" />
              <CheckItem ok={words >= 1500} text={`Объём >= 1500 слов (${words})`} />
              <CheckItem ok={density >= 0.5 && density <= 3} text={`Плотность ключа 1-3% (${density}%)`} />
              <CheckItem ok={readability >= 50} text={`Читаемость >= 50 (${readability})`} />
              <CheckItem ok={titleLen >= 30 && titleLen <= 60} text={`Title 30-60 символов (${titleLen})`} />
              <CheckItem ok={metaLen >= 120 && metaLen <= 160} text={`Meta Description 120-160 символов (${metaLen})`} />
              <CheckItem ok={lsiCoverage >= 50} text={`LSI-покрытие >= 50% (${lsiCoverage}%)`} />
              <CheckItem ok={uniqueness >= 85} text={`Уникальность >= 85% (${uniqueness}%)`} />
              <CheckItem ok={water <= 60} text={`Водность <= 60% (${water}%)`} />
            </CardContent>
          </Card>

          {/* AI Uniqueness Check */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {t("analytics.uniquenessCheck")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!content || checkUniqueness.isPending}
                  onClick={() => checkUniqueness.mutate(content)}
                >
                  {checkUniqueness.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Bot className="h-3 w-3 mr-1" />
                  )}
                  {checkUniqueness.isPending ? t("analytics.checking") : t("analytics.checkUniqueness")}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {uniquenessResult ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <div className="text-2xl font-bold" style={{
                        color: uniquenessResult.overall_score >= 70
                          ? "hsl(var(--success))"
                          : uniquenessResult.overall_score >= 40
                          ? "hsl(var(--warning))"
                          : "hsl(var(--destructive))"
                      }}>
                        {uniquenessResult.overall_score}%
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{t("analytics.uniqueness")}</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <div className="text-2xl font-bold" style={{
                        color: uniquenessResult.ai_probability <= 30
                          ? "hsl(var(--success))"
                          : uniquenessResult.ai_probability <= 60
                          ? "hsl(var(--warning))"
                          : "hsl(var(--destructive))"
                      }}>
                        {uniquenessResult.ai_probability}%
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">AI Detection</div>
                    </div>
                  </div>

                  {uniquenessResult.cliche_phrases?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Клише и шаблоны:</p>
                      <div className="flex flex-wrap gap-1">
                        {uniquenessResult.cliche_phrases.map((p: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] text-destructive border-destructive/30">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {uniquenessResult.unique_elements?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Уникальные элементы:</p>
                      <div className="flex flex-wrap gap-1">
                        {uniquenessResult.unique_elements.map((p: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] text-success border-success/30">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {uniquenessResult.recommendation && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                      💡 {uniquenessResult.recommendation}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Нажмите «{t("analytics.checkUniqueness")}» для AI-анализа уникальности текста
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Search className="h-14 w-14 opacity-20 mb-4" />
          <p className="text-sm">Выберите статью для SEO-аудита</p>
          <p className="text-xs mt-1">Все метрики рассчитываются автоматически</p>
        </div>
      )}
    </div>
  );
}

// ── sub-components ───────────────────────────────────────
function MetricRow({ label, value, target, pct, valueClass }: {
  label: string; value: string; target?: string; pct: number; valueClass?: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{label}</span>
        <span className={valueClass || "font-mono"}>{value}{target ? ` (цель: ${target})` : ""}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function HeadingBadge({ level, count, ideal }: { level: string; count: number; ideal: number }) {
  const ok = level === "H1" ? count === ideal : count >= ideal;
  return (
    <div className={`text-center rounded-md py-2 ${ok ? "bg-success/10" : "bg-muted/50"}`}>
      <div className="text-[10px] text-muted-foreground">{level}</div>
      <div className={`text-sm font-bold ${ok ? "text-success" : "text-muted-foreground"}`}>{count}</div>
    </div>
  );
}

function CheckItem({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 ${ok ? "bg-success/5" : "bg-destructive/5"}`}>
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
      )}
      <span className={ok ? "text-foreground" : "text-destructive"}>{text}</span>
    </div>
  );
}
