import { useState } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { fetchAndAnalyze, type DeepParseResult, type Entity } from "@/entities/competitor/analysisService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, Search, BarChart3, Globe, Image, Video, Type,
  FileText, ChevronDown, ChevronRight, Zap, ArrowRight, ListTree,
  Copy, RefreshCw, AlertTriangle,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";

interface Props {
  keywordId: string;
  onAddEntity?: (entity: string) => void;
  onAddHeading?: (text: string, level: "h2" | "h3") => void;
  onCopyStructure?: (headings: { level: number; text: string }[]) => void;
}

const entityTypeIcons: Record<string, string> = {
  brand: "🏷️", person: "👤", location: "📍", concept: "💡",
  product: "📦", organization: "🏢", event: "📅", metric: "📊",
  technology: "⚙️", term: "📝",
};

const importanceColor = (imp: number) => {
  if (imp >= 8) return "bg-destructive/15 text-destructive border-destructive/30";
  if (imp >= 5) return "bg-warning/15 text-warning border-warning/30";
  return "bg-muted text-muted-foreground border-border";
};

export function CompetitorBenchmark({ keywordId, onAddEntity, onAddHeading, onCopyStructure }: Props) {
  const { session } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeepParseResult | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [showHeadings, setShowHeadings] = useState(true);
  const [showLsi, setShowLsi] = useState(false);

  const runDeepParse = async (forceRefresh = false) => {
    if (!session?.access_token) {
      toast.error(t("bench.sessionExpired"));
      return;
    }
    setLoading(true);
    try {
      const data = await fetchAndAnalyze(keywordId, session.access_token, forceRefresh);
      setResult(data);
      toast.success(`${t("comp.analyzed")} ${data.benchmark.total_parsed} ${t("bench.competitors")}`);
    } catch (e: any) {
      toast.error(e.message || t("comp.analysisError"));
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            {t("comp.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {t("comp.desc")}
          </p>
          <Button onClick={() => runDeepParse()} disabled={loading} className="gap-2 w-full">
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />{t("comp.analyzing")}</>
            ) : (
              <><Zap className="h-4 w-4" />{t("comp.runParse")}</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { benchmark: bm, entities, must_use_phrases, tfidf_phrases, lsi_success_phrases, best_competitor_headings: bch, per_competitor } = result;

  if (!bm || !bch) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t("comp.noData") || "Нет данных для отображения. Попробуйте повторить анализ."}
          <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => runDeepParse(true)} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t("comp.runParse")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Benchmark Summary ── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            {t("comp.medianTop")}
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {bm.total_parsed} {t("comp.sites")}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">{t("comp.colParam")}</TableHead>
                  <TableHead className="text-[10px] text-right">{t("comp.colMedianTop")}</TableHead>
                  <TableHead className="text-[10px] text-right text-primary">{t("comp.colTarget")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs flex items-center gap-1.5"><Type className="h-3 w-3 text-muted-foreground" />{t("comp.wordsLabel")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{bm.median_word_count.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-right font-mono font-bold text-primary">{bm.target_word_count.toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs flex items-center gap-1.5"><Image className="h-3 w-3 text-muted-foreground" />{t("comp.imagesLabel")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{bm.median_img_count}</TableCell>
                  <TableCell className="text-xs text-right font-mono font-bold text-primary">{bm.target_img_count}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs flex items-center gap-1.5"><FileText className="h-3 w-3 text-muted-foreground" />{t("comp.h2Sections")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{bm.median_h2_count}</TableCell>
                  <TableCell className="text-xs text-right font-mono font-bold text-primary">{bm.target_h2_count}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs flex items-center gap-1.5"><FileText className="h-3 w-3 text-muted-foreground" />{t("comp.h3Sections")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{bm.median_h3_count}</TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">—</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs flex items-center gap-1.5"><Video className="h-3 w-3 text-muted-foreground" />{t("comp.withVideo")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{bm.video_percentage}%</TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{bm.video_percentage > 50 ? t("bench.yes") : t("bench.optional")}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs">{t("comp.paragraphs")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{bm.median_paragraph_count}</TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">—</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs">{t("comp.kwDensity")}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{bm.median_keyword_density}%</TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">{bm.median_keyword_density}%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {bm.failed_urls.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 text-[10px] text-warning">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              <span>
                {t("comp.notLoaded")}: {bm.failed_urls.map((f) => `${new URL(f.url).hostname}(${f.reason})`).join(", ")}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Entity Cloud ── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            {t("comp.entityCloud")}
            <Badge variant="secondary" className="ml-auto text-[10px]">{entities.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {entities
              .sort((a: Entity, b: Entity) => b.importance - a.importance)
              .map((e: Entity, i: number) => (
                <Badge
                  key={i}
                  variant="outline"
                  className={`text-xs cursor-pointer hover:scale-105 transition-transform ${importanceColor(e.importance)}`}
                  onClick={() => onAddEntity?.(e.name)}
                  title={`${entityTypeIcons[e.type] || "❓"} ${e.type} | ${e.importance}/10${e.competitors_using ? ` | ${e.competitors_using}` : ""}`}
                >
                  {entityTypeIcons[e.type] || "❓"} {e.name}
                  {e.importance >= 8 && <span className="ml-1 text-[9px] opacity-60">★</span>}
                </Badge>
              ))}
          </div>

          {must_use_phrases.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("comp.mandatoryPhrases")}</p>
              {must_use_phrases.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0 bg-primary/5">{p.phrase}</Badge>
                  <span className="text-muted-foreground truncate">{p.reason}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── LSI Success Phrases ── */}
      {lsi_success_phrases.length > 0 && (
        <Card className="bg-card border-border">
          <Collapsible open={showLsi} onOpenChange={setShowLsi}>
            <CardHeader className="pb-3">
              <CollapsibleTrigger asChild>
                <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                  <Zap className="h-4 w-4 text-success" />
                  {t("comp.lsiSuccess")}
                  <Badge variant="secondary" className="ml-auto text-[10px]">{lsi_success_phrases.length}</Badge>
                  {showLsi ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </CardTitle>
              </CollapsibleTrigger>
              <p className="text-[10px] text-muted-foreground mt-1">{t("comp.lsiDesc")}</p>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {lsi_success_phrases.map((p, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-mono bg-success/5 text-success border-success/30">
                      {p}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* ── Heading Tree ── */}
      <Card className="bg-card border-border">
        <Collapsible open={showHeadings} onOpenChange={setShowHeadings}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                <ListTree className="h-4 w-4 text-primary" />
                {t("comp.structureMap")}
                {showHeadings ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
              </CardTitle>
            </CollapsibleTrigger>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[10px] text-muted-foreground flex-1">
                #{bch.position} — {bch.title}
              </p>
              {onCopyStructure && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 gap-1"
                  onClick={() => {
                    onCopyStructure(bch.headings);
                    toast.success(t("comp.structureCopied"));
                  }}
                >
                  <Copy className="h-3 w-3" />
                  {t("comp.copyStructure")}
                </Button>
              )}
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-0.5 max-h-[400px] overflow-y-auto">
              {bch.h1 && (
                <div className="flex items-center gap-2 py-1 font-bold text-sm">
                  <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">H1</Badge>
                  <span>{bch.h1}</span>
                </div>
              )}
              {bch.headings.map((h, i) => {
                const indent = `pl-${Math.min((h.level - 1) * 4, 20)}`;
                const weight = h.level <= 2 ? "font-semibold text-sm" : "text-xs text-muted-foreground";
                return (
                  <div key={i} className={`flex items-center gap-2 py-1 group ${indent} ${weight}`}>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 font-mono">
                      H{h.level}
                    </Badge>
                    <span className="truncate flex-1">{h.text}</span>
                    {onAddHeading && (h.level === 2 || h.level === 3) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                        onClick={() => onAddHeading(h.text, h.level === 2 ? "h2" : "h3")}
                        title={t("comp.addToPlan")}
                      >
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ── Per-competitor table ── */}
      <Card className="bg-card border-border">
        <Collapsible open={showTable} onOpenChange={setShowTable}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <CardTitle className="text-sm flex items-center gap-2 cursor-pointer hover:text-primary transition-colors">
                <BarChart3 className="h-4 w-4 text-primary" />
                {t("comp.detailTable")}
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
                      <TableHead className="text-[10px] text-right">{t("comp.wordsLabel")}</TableHead>
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
                        <TableCell className="text-[10px] max-w-[180px] truncate font-mono">
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                            {(() => { try { return new URL(c.url).hostname; } catch { return c.url; } })()}
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
                    <TableRow className="bg-muted/50 font-semibold">
                      <TableCell className="text-[10px]">—</TableCell>
                      <TableCell className="text-[10px]">{t("comp.median")}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_word_count.toLocaleString()}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_img_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_h2_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_h3_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_keyword_density}%</TableCell>
                      <TableCell className="text-[10px] text-center">{bm.video_percentage}%</TableCell>
                    </TableRow>
                    <TableRow className="bg-primary/5 font-bold">
                      <TableCell className="text-[10px]">🎯</TableCell>
                      <TableCell className="text-[10px] text-primary">{t("comp.targetLabel")}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono text-primary">{bm.target_word_count.toLocaleString()}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono text-primary">{bm.target_img_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono text-primary">{bm.target_h2_count}</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">—</TableCell>
                      <TableCell className="text-[10px] text-right font-mono">{bm.median_keyword_density}%</TableCell>
                      <TableCell className="text-[10px] text-center">{bm.video_percentage > 50 ? "✅" : "—"}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Re-run */}
      <Button variant="outline" onClick={() => runDeepParse(true)} disabled={loading} className="gap-2 w-full" size="sm">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {t("comp.rescan")}
      </Button>
    </div>
  );
}
