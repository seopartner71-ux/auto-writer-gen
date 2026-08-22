// P22 - AI Visibility & Performance Center.
// Read-only analytics on top of P1-P21: scores, GEO breakdown, index status,
// timeline, opportunities with one-click fixes, SILO map, release compare, PDF.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Activity, Camera, Download, ExternalLink, FileText, Gauge, Loader2, RefreshCw, Wand2,
} from "lucide-react";
import { runQueueJob } from "../queue/runQueueJob";
import type { JobType } from "../queue/useGenerationJob";
import { SiloMap } from "./SiloMap";
import { AiVisibilityPanel } from "./AiVisibilityPanel";
import { buildPerformancePdf } from "./performanceReport";
import type { Opportunity, PerfOverview, ScoreSnapshot, SiloNode } from "./types";

const tone = (v: number) => (v >= 70 ? "text-green-500" : v >= 30 ? "text-yellow-500" : "text-destructive");

function ScoreCard({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  const numeric = typeof value === "number";
  return (
    <div className="rounded border border-border/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${numeric ? tone(value as number) : ""}`}>
        {value}{suffix}
      </p>
    </div>
  );
}

export function PerformancePanel({
  projectId, ru, onGoToStep,
}: { projectId: string; ru: boolean; onGoToStep?: (step: number) => void }) {
  const [data, setData] = useState<PerfOverview | null>(null);
  const [timeline, setTimeline] = useState<ScoreSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixProgress, setFixProgress] = useState(0);
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const [{ data: over, error }, { data: tl }] = await Promise.all([
      supabase.functions.invoke("performance-center", { body: { action: "overview", project_id: projectId } }),
      supabase.functions.invoke("performance-center", { body: { action: "timeline", project_id: projectId } }),
    ]);
    setLoading(false);
    if (error) { toast.error(await invokeErrorMessage(error)); return; }
    setData(over as PerfOverview);
    const rows = ((tl as { timeline?: ScoreSnapshot[] })?.timeline) || [];
    setTimeline(rows);
    if (rows.length >= 2) {
      setCmpA((a) => a || rows[rows.length - 2].id);
      setCmpB((b) => b || rows[rows.length - 1].id);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const snapshot = async () => {
    setSnapping(true);
    const { data: res, error } = await supabase.functions.invoke("performance-center", {
      body: { action: "snapshot", project_id: projectId },
    });
    setSnapping(false);
    if (error) { toast.error(await invokeErrorMessage(error)); return; }
    setData(res as PerfOverview);
    toast.success(ru ? "Снимок метрик сохранен" : "Score snapshot saved");
    await load();
  };

  const exportPdf = () => {
    if (!data) return;
    const doc = buildPerformancePdf(data, timeline, ru);
    doc.save(`ai-visibility-${(data.site.domain || data.site.name || "site").replace(/[^a-z0-9.-]/gi, "-")}.pdf`);
  };

  const fix = async (op: Opportunity) => {
    if (!op.affected.length && op.engine !== "commercial-engine") {
      onGoToStep?.(op.step);
      toast.info(ru ? "Откройте соответствующий шаг мастера" : "Open the matching wizard step");
      return;
    }
    setFixing(op.key);
    setFixProgress(0);
    try {
      if (op.engine === "commercial-engine") {
        const { error } = await supabase.functions.invoke("commercial-engine", {
          body: { project_id: projectId, mode: "missing", registry_ids: op.affected.slice(0, 50), limit: 50 },
        });
        if (error) throw new Error(await invokeErrorMessage(error));
      } else {
        const jobType: JobType = op.engine === "seo-engine" ? "seo"
          : op.engine === "media-engine" ? "media"
          : op.engine === "blog-engine" ? "blog" : "content";
        const params: Record<string, unknown> = jobType === "seo"
          ? { mode: "missing", registry_ids: op.affected }
          : jobType === "media"
            ? { mode: "generate_missing", entity_ids: op.affected }
            : { mode: "missing" };
        const res = await runQueueJob(projectId, jobType, params, (p) => setFixProgress(p));
        if (!res.ok) throw new Error(res.error || "job failed");
      }
      toast.success(ru ? "Исправление выполнено" : "Fix applied");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fix failed");
    } finally {
      setFixing(null);
      setFixProgress(0);
    }
  };

  const openPage = (n: SiloNode) => {
    const url = data?.site.production_url;
    if (url) window.open(`${url.replace(/\/$/, "")}${n.url_path}`, "_blank");
    else onGoToStep?.(7);
  };

  const compare = useMemo(() => {
    const a = timeline.find((t) => t.id === cmpA) || null;
    const b = timeline.find((t) => t.id === cmpB) || null;
    return { a, b };
  }, [timeline, cmpA, cmpB]);

  if (loading && !data) {
    return <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">{ru ? "Нет данных." : "No data."}</p>;
  }

  const s = data.scores;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />{ru ? "Обновить" : "Refresh"}
        </Button>
        <Button size="sm" variant="outline" onClick={snapshot} disabled={snapping}>
          {snapping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}
          {ru ? "Сохранить снимок" : "Save snapshot"}
        </Button>
        <Button size="sm" variant="outline" onClick={exportPdf}>
          <FileText className="h-4 w-4 mr-2" />{ru ? "PDF-отчет" : "PDF report"}
        </Button>
        {data.site.production_url && (
          <a href={data.site.production_url} target="_blank" rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto">
            {data.site.production_url}<ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <ScoreCard label="SEO Score" value={s.seo} />
        <ScoreCard label="GEO Score" value={s.geo} />
        <ScoreCard label={ru ? "Visual Score" : "Visual Score"} value={s.visual} />
        <ScoreCard label="Media Score" value={s.media} />
        <ScoreCard label={ru ? "Готов к органике" : "Organic ready"} value={data.stats.organic_ready ? (ru ? "ДА" : "YES") : (ru ? "НЕТ" : "NO")} />
        <ScoreCard label={ru ? "Опубликовано URL" : "Published URLs"} value={data.stats.published_urls} />
      </div>

      <Tabs defaultValue="geo">
        <TabsList className="flex-wrap">
          <TabsTrigger value="geo">GEO</TabsTrigger>
          <TabsTrigger value="visibility">AI Visibility</TabsTrigger>
          <TabsTrigger value="index">{ru ? "Индексация" : "Index status"}</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="opportunities">{ru ? "Точки роста" : "Opportunities"}</TabsTrigger>
          <TabsTrigger value="silo">SILO</TabsTrigger>
          <TabsTrigger value="compare">{ru ? "Сравнение релизов" : "Release compare"}</TabsTrigger>
        </TabsList>

        <TabsContent value="geo">
          <Card><CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4" />GEO Score {s.geo}/100
            </CardTitle>
          </CardHeader>
            <CardContent className="space-y-3">
              {data.geo_breakdown.map((g) => (
                <div key={g.key} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{ru ? g.label_ru : g.label_en}</span>
                    <span className="text-muted-foreground">{g.points} / {g.weight}</span>
                  </div>
                  <Progress value={g.value} className="h-1.5" />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="visibility">
          <Card><CardContent className="pt-4">
            <AiVisibilityPanel projectId={projectId} ru={ru}
              defaultEntity={data.site.name} onChecked={load} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="index">
          <Card><CardContent className="pt-4 grid gap-3 grid-cols-2 md:grid-cols-4">
            <ScoreCard label={ru ? "Всего URL" : "Total URLs"} value={data.index_status.total} />
            <ScoreCard label={ru ? "Отправлено" : "Submitted"} value={data.index_status.submitted} />
            <ScoreCard label={ru ? "Проиндексировано" : "Indexed"} value={data.index_status.indexed} />
            <ScoreCard label={ru ? "Ожидают" : "Pending"} value={data.index_status.pending} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card><CardContent className="pt-4">
            {timeline.length ? (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left p-2">{ru ? "Версия" : "Version"}</th>
                      <th className="text-left p-2">SEO</th>
                      <th className="text-left p-2">GEO</th>
                      <th className="text-left p-2">Visual</th>
                      <th className="text-left p-2">Media</th>
                      <th className="text-left p-2">{ru ? "Качество" : "Quality"}</th>
                      <th className="text-left p-2">{ru ? "Страниц" : "Pages"}</th>
                      <th className="text-left p-2">{ru ? "Дата" : "Date"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.slice().reverse().map((t) => (
                      <tr key={t.id} className="border-t border-border/40">
                        <td className="p-2">{t.version || "-"}</td>
                        <td className={`p-2 ${tone(t.seo_score)}`}>{t.seo_score}</td>
                        <td className={`p-2 ${tone(t.geo_score)}`}>{t.geo_score}</td>
                        <td className={`p-2 ${tone(t.visual_score)}`}>{t.visual_score}</td>
                        <td className={`p-2 ${tone(t.media_score)}`}>{t.media_score}</td>
                        <td className={`p-2 ${tone(t.quality_score)}`}>{t.quality_score}</td>
                        <td className="p-2">{t.pages}</td>
                        <td className="p-2 text-muted-foreground">
                          {new Date(t.created_at).toLocaleString(ru ? "ru-RU" : "en-US")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {ru ? "Снимков нет. Нажмите «Сохранить снимок», чтобы начать историю." : "No snapshots yet. Use Save snapshot to start the history."}
              </p>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="opportunities">
          <Card><CardContent className="pt-4 space-y-2">
            {data.opportunities.map((op) => (
              <div key={op.key} className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-2">
                <Badge variant="outline" className="text-[10px] uppercase">{op.group}</Badge>
                <span className="text-xs">{ru ? op.label_ru : op.label_en}</span>
                <Badge variant="outline" className={`text-[10px] ${op.impact === "high" ? "text-destructive" : op.impact === "medium" ? "text-yellow-500" : ""}`}>
                  {op.count}
                </Badge>
                <div className="ml-auto flex items-center gap-2">
                  {fixing === op.key && fixProgress > 0 && (
                    <span className="text-[10px] text-muted-foreground">{fixProgress}%</span>
                  )}
                  <Button size="sm" variant="outline" disabled={!!fixing} onClick={() => fix(op)}>
                    {fixing === op.key ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-2" />}
                    {ru ? "Исправить автоматически" : "Fix automatically"}
                  </Button>
                </div>
              </div>
            ))}
            {!data.opportunities.length && (
              <p className="text-xs text-green-500 flex items-center gap-2">
                <Activity className="h-4 w-4" />{ru ? "Точек роста не найдено - сайт в порядке." : "No growth gaps found - the site is healthy."}
              </p>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="silo">
          <Card><CardContent className="pt-4">
            <SiloMap nodes={data.silo_map} ru={ru} siteUrl={data.site.production_url} onOpenPage={openPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="compare">
          <Card><CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Select value={cmpA} onValueChange={setCmpA}>
                <SelectTrigger className="h-8 w-56"><SelectValue placeholder={ru ? "Снимок A" : "Snapshot A"} /></SelectTrigger>
                <SelectContent>
                  {timeline.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {(t.version || "-")} - {new Date(t.created_at).toLocaleDateString(ru ? "ru-RU" : "en-US")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={cmpB} onValueChange={setCmpB}>
                <SelectTrigger className="h-8 w-56"><SelectValue placeholder={ru ? "Снимок B" : "Snapshot B"} /></SelectTrigger>
                <SelectContent>
                  {timeline.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {(t.version || "-")} - {new Date(t.created_at).toLocaleDateString(ru ? "ru-RU" : "en-US")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {compare.a && compare.b ? (
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">{ru ? "Метрика" : "Metric"}</th>
                    <th className="text-left p-2">{compare.a.version || "A"}</th>
                    <th className="text-left p-2">{compare.b.version || "B"}</th>
                    <th className="text-left p-2">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    [ru ? "Страниц" : "Pages", compare.a.pages, compare.b.pages],
                    ["SEO", compare.a.seo_score, compare.b.seo_score],
                    ["GEO", compare.a.geo_score, compare.b.geo_score],
                    ["Visual", compare.a.visual_score, compare.b.visual_score],
                    ["Media", compare.a.media_score, compare.b.media_score],
                    [ru ? "Коммерция" : "Commercial", compare.a.commercial_score, compare.b.commercial_score],
                    [ru ? "Проиндексировано" : "Indexed", compare.a.indexed_urls, compare.b.indexed_urls],
                  ] as [string, number, number][]).map(([label, a, b]) => (
                    <tr key={label} className="border-t border-border/40">
                      <td className="p-2">{label}</td>
                      <td className="p-2">{a}</td>
                      <td className="p-2">{b}</td>
                      <td className={`p-2 ${b - a > 0 ? "text-green-500" : b - a < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {b - a > 0 ? "+" : ""}{b - a}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted-foreground">
                {ru ? "Нужно минимум два снимка метрик." : "At least two snapshots are required."}
              </p>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Download className="h-3 w-3" />
        {ru
          ? "Performance Center только читает данные реестра, SEO, медиа и релизов - сборка и рендер не меняются."
          : "The Performance Center only reads registry, SEO, media and release data - build and render stay untouched."}
      </p>
    </div>
  );
}
