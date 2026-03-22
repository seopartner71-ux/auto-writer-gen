import { useState } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { supabase } from "@/shared/api/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, Search, BarChart3, Globe, Image, Video, Type,
  FileText, ChevronDown, ChevronRight, Zap, ArrowRight, ListTree,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";

interface Entity {
  name: string;
  type: string;
  importance: "critical" | "high" | "medium";
  competitors_using?: number;
}

interface MustUsePhrase {
  phrase: string;
  reason: string;
}

interface TfidfPhrase {
  phrase: string;
  total: number;
  docs: number;
  tfidf: number;
  commonality: number;
}

interface Benchmark {
  total_parsed: number;
  failed_urls: string[];
  median_word_count: number;
  median_img_count: number;
  median_h2_count: number;
  median_h3_count: number;
  median_paragraph_count: number;
  median_keyword_density: number;
  video_percentage: number;
}

interface CompetitorRow {
  url: string;
  position: number;
  word_count: number;
  img_count: number;
  h2_count: number;
  h3_count: number;
  video_presence: boolean;
  keyword_density: number;
  title_tag: string;
  meta_description: string;
}

interface BestCompetitorHeadings {
  url: string;
  position: number;
  title: string;
  headings: { level: string; text: string }[];
}

interface DeepParseResult {
  benchmark: Benchmark;
  entities: Entity[];
  must_use_phrases: MustUsePhrase[];
  tfidf_phrases: TfidfPhrase[];
  best_competitor_headings: BestCompetitorHeadings;
  per_competitor: CompetitorRow[];
}

interface Props {
  keywordId: string;
  onAddEntity?: (entity: string) => void;
  onAddHeading?: (text: string, level: "h2" | "h3") => void;
}

export function CompetitorBenchmark({ keywordId, onAddEntity, onAddHeading }: Props) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeepParseResult | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [showHeadings, setShowHeadings] = useState(true);

  const runDeepParse = async () => {
    if (!session?.access_token) {
      toast.error("Сессия истекла");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("deep-parse-competitors", {
        body: { keyword_id: keywordId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setResult(data);
      toast.success(`Проанализировано ${data.benchmark.total_parsed} конкурентов`);
    } catch (e: any) {
      toast.error(e.message || "Ошибка анализа");
    } finally {
      setLoading(false);
    }
  };

  const importanceColors: Record<string, string> = {
    critical: "bg-destructive/15 text-destructive border-destructive/30",
    high: "bg-warning/15 text-warning border-warning/30",
    medium: "bg-muted text-muted-foreground border-border",
  };

  const entityTypeIcons: Record<string, string> = {
    brand: "🏷️", person: "👤", location: "📍", concept: "💡",
    product: "📦", organization: "🏢", event: "📅", metric: "📊",
  };

  const headingIndent: Record<string, string> = {
    h1: "pl-0 font-bold text-sm",
    h2: "pl-4 font-semibold text-sm",
    h3: "pl-8 text-xs text-muted-foreground",
    h4: "pl-12 text-xs text-muted-foreground/70",
    h5: "pl-16 text-xs text-muted-foreground/50",
    h6: "pl-20 text-xs text-muted-foreground/40",
  };

  if (!result) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Глубокий анализ конкурентов
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Парсинг HTML-страниц конкурентов: структура, контент, медиа, SEO-метрики, сущности и TF-IDF.
          </p>
          <Button onClick={runDeepParse} disabled={loading} className="gap-2 w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Анализ страниц...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                Запустить глубокий парсинг
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { benchmark: bm, entities, must_use_phrases, tfidf_phrases, best_competitor_headings, per_competitor } = result;

  return (
    <div className="space-y-4">
      {/* Benchmark Summary */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Медиана ТОПа
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {bm.total_parsed} сайтов
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <Type className="h-4 w-4 mx-auto mb-1 text-primary" />
              <div className="text-lg font-bold">{bm.median_word_count.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">Слов</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <Image className="h-4 w-4 mx-auto mb-1 text-success" />
              <div className="text-lg font-bold">{bm.median_img_count}</div>
              <div className="text-[10px] text-muted-foreground">Картинок</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <FileText className="h-4 w-4 mx-auto mb-1 text-info" />
              <div className="text-lg font-bold">{bm.median_h2_count}</div>
              <div className="text-[10px] text-muted-foreground">H2</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <Video className="h-4 w-4 mx-auto mb-1 text-warning" />
              <div className="text-lg font-bold">{bm.video_percentage}%</div>
              <div className="text-[10px] text-muted-foreground">С видео</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="text-center">
              <div className="text-xs font-medium">{bm.median_h3_count}</div>
              <div className="text-[10px] text-muted-foreground">H3</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-medium">{bm.median_paragraph_count}</div>
              <div className="text-[10px] text-muted-foreground">Абзацев</div>
            </div>
            <div className="text-center">
              <div className="text-xs font-medium">{bm.median_keyword_density}%</div>
              <div className="text-[10px] text-muted-foreground">Плотность KW</div>
            </div>
          </div>

          {bm.failed_urls.length > 0 && (
            <p className="text-[10px] text-destructive mt-2">
              ⚠ Не удалось загрузить: {bm.failed_urls.length} URL
            </p>
          )}
        </CardContent>
      </Card>

      {/* Entity Cloud */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Облако Сущностей (Entities)
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {entities.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {entities.map((e, i) => (
              <Badge
                key={i}
                variant="outline"
                className={`text-xs cursor-pointer hover:opacity-80 transition-opacity ${importanceColors[e.importance]}`}
                onClick={() => onAddEntity?.(e.name)}
                title={`${entityTypeIcons[e.type] || "❓"} ${e.type} | Нажмите для добавления`}
              >
                {entityTypeIcons[e.type] || "❓"} {e.name}
              </Badge>
            ))}
          </div>
          {must_use_phrases.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Обязательные фразы
              </p>
              {must_use_phrases.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                    {p.phrase}
                  </Badge>
                  <span className="text-muted-foreground truncate">{p.reason}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Heading Tree of Best Competitor */}
      <Card className="bg-card border-border">
        <Collapsible open={showHeadings} onOpenChange={setShowHeadings}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                <ListTree className="h-4 w-4 text-primary" />
                Структурная карта лидера
                {showHeadings ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
              </CardTitle>
            </CollapsibleTrigger>
            <p className="text-[10px] text-muted-foreground mt-1">
              #{best_competitor_headings.position} — {best_competitor_headings.title}
            </p>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-0.5 max-h-[400px] overflow-y-auto">
              {best_competitor_headings.headings.map((h, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 py-1 group ${headingIndent[h.level] || "pl-0 text-xs"}`}
                >
                  <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 font-mono">
                    {h.level.toUpperCase()}
                  </Badge>
                  <span className="truncate flex-1">{h.text}</span>
                  {onAddHeading && (h.level === "h2" || h.level === "h3") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                      onClick={() => onAddHeading(h.text, h.level as "h2" | "h3")}
                      title="Добавить в план"
                    >
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Per-competitor table */}
      <Card className="bg-card border-border">
        <Collapsible open={showTable} onOpenChange={setShowTable}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                <BarChart3 className="h-4 w-4 text-primary" />
                Детальная таблица
                {showTable ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
              </CardTitle>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] w-8">#</TableHead>
                      <TableHead className="text-[10px]">URL</TableHead>
                      <TableHead className="text-[10px] text-right">Слов</TableHead>
                      <TableHead className="text-[10px] text-right">Img</TableHead>
                      <TableHead className="text-[10px] text-right">H2</TableHead>
                      <TableHead className="text-[10px] text-right">H3</TableHead>
                      <TableHead className="text-[10px] text-right">KW%</TableHead>
                      <TableHead className="text-[10px] text-center">Video</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {per_competitor.map((c) => (
                      <TableRow key={c.position}>
                        <TableCell className="text-[10px] font-mono">{c.position}</TableCell>
                        <TableCell className="text-[10px] max-w-[200px] truncate font-mono">
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                            {new URL(c.url).hostname}
                          </a>
                        </TableCell>
                        <TableCell className="text-[10px] text-right font-mono">{c.word_count.toLocaleString()}</TableCell>
                        <TableCell className="text-[10px] text-right font-mono">{c.img_count}</TableCell>
                        <TableCell className="text-[10px] text-right font-mono">{c.h2_count}</TableCell>
                        <TableCell className="text-[10px] text-right font-mono">{c.h3_count}</TableCell>
                        <TableCell className="text-[10px] text-right font-mono">{c.keyword_density}%</TableCell>
                        <TableCell className="text-[10px] text-center">{c.video_presence ? "✅" : "—"}</TableCell>
                      </TableRow>
                    ))}
                    {/* Median row */}
                    <TableRow className="bg-primary/5 font-semibold">
                      <TableCell className="text-[10px]">—</TableCell>
                      <TableCell className="text-[10px]">Медиана</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_word_count.toLocaleString()}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_img_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_h2_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_h3_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_keyword_density}%</TableCell>
                      <TableCell className="text-[10px] text-center">{bm.video_percentage}%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Re-run button */}
      <Button variant="outline" onClick={runDeepParse} disabled={loading} className="gap-2 w-full" size="sm">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        Пересканировать
      </Button>
    </div>
  );
}
