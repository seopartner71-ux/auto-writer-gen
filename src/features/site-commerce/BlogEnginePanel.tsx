import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Newspaper, ListPlus, Play, Rocket, RefreshCw, Zap } from "lucide-react";

interface ClusterRow {
  id: string;
  name: string;
  main_entity: string | null;
  commercial_pages_count: number;
  keywords_count: number;
  authority_score: number;
  status: string;
}

interface PlanRow {
  id: string;
  topic_cluster_id: string | null;
  title: string;
  intent: string;
  article_type: string;
  target_keywords: string[] | null;
  linked_pages: string[] | null;
  priority: number;
  status: string;
  url_path: string | null;
  authority_score: number | null;
  quality: { status?: string; issues?: string[]; commercial_links?: number; words?: number } | null;
  error: string | null;
}

interface Summary {
  clusters: number;
  commercial_pages: number;
  topics: number;
  planned: number;
  ready: number;
  published: number;
  failed: number;
  covered_clusters: number;
  authority_score: number;
  article_authority_avg: number;
  internal_links: number;
}

const STATUS_COLOR: Record<string, string> = {
  planned: "text-muted-foreground",
  generating: "text-amber-500",
  ready: "text-sky-500",
  published: "text-emerald-500",
  failed: "text-red-500",
};

const TYPE_LABEL_RU: Record<string, string> = {
  supporting_article: "Поддерживающая",
  expert_article: "Экспертная",
  faq_article: "FAQ",
  comparison_article: "Сравнение",
  guide_article: "Гайд",
  news_article: "Новость",
};

export function BlogEnginePanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("blog-engine", {
      body: { project_id: projectId, ...payload },
    });
    if (error) throw error;
    const d = data as { summary?: Summary; clusters?: ClusterRow[]; plan?: PlanRow[] } & Record<string, unknown>;
    if (d.summary) setSummary(d.summary);
    if (d.clusters) setClusters(d.clusters);
    if (d.plan) setPlan(d.plan);
    return d;
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await call({ action: "analyze" });
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "blog engine failed"));
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const run = useCallback(async (key: string, payload: Record<string, unknown>, done: (d: any) => string) => {
    setRunning(key);
    try {
      const d = await call(payload);
      toast.success(done(d));
      setSelected([]);
      await call({ action: "analyze" });
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "blog engine failed"));
    } finally {
      setRunning(null);
    }
  }, [call]);

  const cards = useMemo(() => ([
    { label: ru ? "Кластеры" : "Clusters", value: summary?.clusters ?? 0, pct: null as number | null },
    {
      label: ru ? "Покрытие тем" : "Topic coverage",
      value: summary?.clusters ? Math.round(((summary.covered_clusters || 0) / summary.clusters) * 100) : 0,
      pct: summary?.clusters ? Math.round(((summary.covered_clusters || 0) / summary.clusters) * 100) : 0,
    },
    { label: "Authority score", value: summary?.authority_score ?? 0, pct: summary?.authority_score ?? 0 },
    { label: ru ? "Авторитет статей" : "Article authority", value: summary?.article_authority_avg ?? 0, pct: summary?.article_authority_avg ?? 0 },
    { label: ru ? "Перелинковка" : "Internal links", value: summary?.internal_links ?? 0, pct: null },
  ]), [summary, ru]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const clusterName = (id: string | null) => clusters.find((c) => c.id === id)?.name || "-";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <Newspaper className="h-3.5 w-3.5" />Topic Authority
        </Badge>
        <span className="text-xs text-muted-foreground">
          {ru ? "Коммерческих страниц" : "Commercial pages"}: {summary?.commercial_pages ?? 0}
        </span>

        <Button size="sm" className="ml-auto" disabled={!!running}
          onClick={() => void run("plan", { action: "build_plan" },
            (d) => ru ? `Кластеров: ${d.clusters_created ?? 0}, тем: ${d.topics_created ?? 0}`
                      : `Clusters: ${d.clusters_created ?? 0}, topics: ${d.topics_created ?? 0}`)}>
          {running === "plan" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <ListPlus className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Создать план" : "Create plan"}
        </Button>

        <Button size="sm" variant="outline" disabled={!!running}
          onClick={() => void run("gen-new", { action: "generate", mode: "new", limit: 3 },
            (d) => ru ? `Сгенерировано: ${d.generated ?? 0}` : `Generated: ${d.generated ?? 0}`)}>
          {running === "gen-new" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Только новые" : "Only new"}
        </Button>

        <Button size="sm" variant="outline" disabled={!!running}
          onClick={() => void run("gen-prio", { action: "generate", mode: "priority", limit: 3 },
            (d) => ru ? `Сгенерировано: ${d.generated ?? 0}` : `Generated: ${d.generated ?? 0}`)}>
          {running === "gen-prio" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Zap className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Только приоритетные" : "Only priority"}
        </Button>

        <Button size="sm" variant="ghost" disabled={!!running || !selected.length}
          onClick={() => void run("gen-sel", { action: "generate", mode: "selected", plan_ids: selected, limit: selected.length },
            (d) => ru ? `Сгенерировано: ${d.generated ?? 0}` : `Generated: ${d.generated ?? 0}`)}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          {ru ? `Генерировать статьи (${selected.length})` : `Generate articles (${selected.length})`}
        </Button>

        <Button size="sm" variant="secondary" disabled={!!running}
          onClick={() => void run("publish", { action: "publish", plan_ids: selected },
            (d) => ru ? `Опубликовано: ${d.published ?? 0}` : `Published: ${d.published ?? 0}`)}>
          {running === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Rocket className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Опубликовать" : "Publish"}
        </Button>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded border border-border/60 p-3 space-y-2">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className={`text-lg font-semibold ${
              c.pct === null ? "" : c.pct >= 70 ? "text-emerald-500" : c.pct >= 30 ? "text-amber-500" : "text-red-500"}`}>
              {c.value}{c.pct === null ? "" : "%"}
            </div>
            {c.pct !== null && <Progress value={c.pct} className="h-1" />}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded border border-border/60">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="p-2 text-left">{ru ? "Кластер" : "Cluster"}</th>
              <th className="p-2 text-left">{ru ? "Коммерческие страницы" : "Commercial pages"}</th>
              <th className="p-2 text-left">{ru ? "Ключи" : "Keywords"}</th>
              <th className="p-2 text-left">Authority</th>
              <th className="p-2 text-left">{ru ? "Статус" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.id} className="border-t border-border/40">
                <td className="p-2">{c.name}</td>
                <td className="p-2">{c.commercial_pages_count}</td>
                <td className="p-2">{c.keywords_count}</td>
                <td className="p-2">{c.authority_score}</td>
                <td className="p-2">{c.status}</td>
              </tr>
            ))}
            {!clusters.length && (
              <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">
                {ru ? "Кластеры еще не построены" : "No topic clusters yet"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {ru ? "Контент-план" : "Content plan"}: {plan.length}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="overflow-x-auto rounded border border-border/60">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="w-8 p-2" />
              <th className="p-2 text-left">{ru ? "Тема" : "Topic"}</th>
              <th className="p-2 text-left">{ru ? "Тип" : "Type"}</th>
              <th className="p-2 text-left">{ru ? "Ключи" : "Keywords"}</th>
              <th className="p-2 text-left">{ru ? "Связанные страницы" : "Linked pages"}</th>
              <th className="p-2 text-left">{ru ? "Приоритет" : "Priority"}</th>
              <th className="p-2 text-left">Authority</th>
              <th className="p-2 text-left">{ru ? "Статус" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((p) => (
              <tr key={p.id} className="border-t border-border/40 align-top">
                <td className="p-2">
                  <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
                </td>
                <td className="p-2 max-w-[320px]">
                  <div>{p.title}</div>
                  <div className="text-muted-foreground">{clusterName(p.topic_cluster_id)}</div>
                  {p.url_path && <div className="font-mono text-muted-foreground">{p.url_path}</div>}
                  {p.error && <div className="text-red-500">{p.error}</div>}
                </td>
                <td className="p-2">{ru ? (TYPE_LABEL_RU[p.article_type] || p.article_type) : p.article_type}</td>
                <td className="p-2">{(p.target_keywords || []).length}</td>
                <td className="p-2">{(p.linked_pages || []).length} / {p.quality?.commercial_links ?? 0}</td>
                <td className="p-2">{p.priority}</td>
                <td className="p-2">
                  {p.authority_score ?? "-"}
                  {p.quality?.status ? <span className="text-muted-foreground"> {p.quality.status}</span> : null}
                </td>
                <td className={`p-2 font-semibold ${STATUS_COLOR[p.status] || ""}`}>{p.status}</td>
              </tr>
            ))}
            {!plan.length && (
              <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">
                {ru ? "Контент-план пуст. Нажмите «Создать план»." : "Content plan is empty."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
