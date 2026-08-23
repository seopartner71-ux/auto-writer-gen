import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Loader2, Filter, Play, RefreshCw, AlertTriangle, Sparkles, ShieldCheck, ChevronRight,
} from "lucide-react";

interface AttrRow {
  id: string;
  cluster_id: string | null;
  attribute: string;
  attribute_slug: string;
  value_type: string;
  values: { value: string; slug: string; count: number }[] | null;
  product_count: number;
  indexable: boolean;
  priority: number;
  reason: string | null;
}

interface PageRow {
  id: string;
  url_path: string;
  title: string;
  h1: string | null;
  cluster_path: string | null;
  product_count: number;
  demand_score: number;
  indexable: boolean;
  canonical: string | null;
  seo_content: unknown;
  status: string;
}

interface QaIssue { code: string; severity: string; url_path?: string; detail?: string }

export function FiltersPanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [clusters, setClusters] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [qa, setQa] = useState<QaIssue[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p, c] = await Promise.all([
        supabase.from("catalog_filters").select("*").eq("project_id", projectId)
          .order("priority", { ascending: false }),
        supabase.from("catalog_filter_pages").select(
          "id, url_path, title, h1, cluster_path, product_count, demand_score, indexable, canonical, seo_content, status")
          .eq("project_id", projectId).order("demand_score", { ascending: false }).limit(500),
        supabase.from("site_clusters").select("id, name").eq("project_id", projectId),
      ]);
      if (a.error) throw a.error;
      setAttrs((a.data || []) as unknown as AttrRow[]);
      setPages((p.data || []) as unknown as PageRow[]);
      const map: Record<string, string> = {};
      for (const row of (c.data || []) as { id: string; name: string }[]) map[row.id] = row.name;
      setClusters(map);
    } catch (e) {
      toast.error(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("filter-engine", {
        body: { action, projectId, ...payload },
      });
      if (error) throw error;
      const res = data as Record<string, unknown>;
      if (res?.error) throw new Error(String(res.error));
      return res;
    } catch (e) {
      toast.error(String((e as Error).message || e));
      return null;
    } finally {
      setBusy(null);
    }
  }, [projectId]);

  const runAnalyze = async () => {
    const r = await call("analyze");
    if (!r) return;
    toast.success(ru
      ? `Найдено атрибутов: ${r.attributes ?? 0}`
      : `Attributes found: ${r.attributes ?? 0}`);
    await load();
  };

  const runBuild = async () => {
    const r = await call("build");
    if (!r) return;
    toast.success(ru
      ? `Посадочные: создано ${r.created ?? 0}, отключено ${r.disabled ?? 0}`
      : `Landings: ${r.created ?? 0} created, ${r.disabled ?? 0} disabled`);
    await load();
  };

  const runContent = async () => {
    const r = await call("content", { limit: 20 });
    if (!r) return;
    toast.success(ru ? `Тексты сгенерированы: ${r.filled ?? 0}` : `Texts generated: ${r.filled ?? 0}`);
    await load();
  };

  const runQa = async () => {
    const r = await call("qa");
    if (!r) return;
    setQa((r.issues || []) as QaIssue[]);
    const blockers = ((r.issues || []) as QaIssue[]).filter((i) => i.severity === "error").length;
    if (blockers) toast.error(ru ? `Блокеров: ${blockers}` : `Blockers: ${blockers}`);
    else toast.success(ru ? "Слой фильтров готов" : "Filter layer is clean");
  };

  const toggleAttr = async (row: AttrRow, next: boolean) => {
    setAttrs((prev) => prev.map((a) => (a.id === row.id ? { ...a, indexable: next } : a)));
    const r = await call("toggle", { filterId: row.id, indexable: next });
    if (!r) { await load(); return; }
    await load();
  };

  const grouped = useMemo(() => {
    const map = new Map<string, AttrRow[]>();
    for (const a of attrs) {
      const key = a.cluster_id || "";
      map.set(key, [...(map.get(key) || []), a]);
    }
    return [...map.entries()];
  }, [attrs]);

  const indexablePages = pages.filter((p) => p.indexable && p.status === "active").length;
  const withContent = pages.filter((p) => p.seo_content).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            {ru ? "Фильтры и посадочные" : "Facets and landings"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={runAnalyze} disabled={!!busy}>
              {busy === "analyze" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              {ru ? "Анализ характеристик" : "Analyze attributes"}
            </Button>
            <Button size="sm" variant="outline" onClick={runBuild} disabled={!!busy || !attrs.length}>
              {busy === "build" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ChevronRight className="h-4 w-4 mr-2" />}
              {ru ? "Построить посадочные" : "Build landings"}
            </Button>
            <Button size="sm" variant="outline" onClick={runContent} disabled={!!busy || !pages.length}>
              {busy === "content" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {ru ? "Тексты и FAQ" : "Texts and FAQ"}
            </Button>
            <Button size="sm" variant="outline" onClick={runQa} disabled={!!busy}>
              {busy === "qa" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              QA
            </Button>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{ru ? "Атрибутов" : "Attributes"}: {attrs.length}</span>
            <span>{ru ? "Посадочных" : "Landings"}: {pages.length}</span>
            <span className="text-emerald-500">{ru ? "В индекс" : "Indexable"}: {indexablePages}</span>
            <span>{ru ? "С текстами" : "With texts"}: {withContent}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            {ru
              ? "Цена, остаток, артикул и сортировки всегда закрыты от индексации и склеиваются каноникалом с категорией."
              : "Price, stock, SKU and sorting are always noindex and canonicalised to the category."}
          </p>
        </CardContent>
      </Card>

      {qa && qa.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              QA ({qa.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs max-h-56 overflow-auto">
            {qa.slice(0, 60).map((i, idx) => (
              <div key={idx} className="flex gap-2">
                <span className={i.severity === "error" ? "text-red-500" : "text-amber-500"}>{i.code}</span>
                <span className="text-muted-foreground truncate">{i.url_path || i.detail || ""}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {grouped.map(([clusterId, list]) => (
        <Card key={clusterId || "root"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {clusters[clusterId] || (ru ? "Весь каталог" : "Whole catalog")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-border/40 pb-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm flex items-center gap-2">
                    {a.attribute}
                    <Badge variant="outline" className="text-[10px]">{a.value_type}</Badge>
                    {!a.indexable && a.reason && (
                      <span className="text-[10px] text-muted-foreground">{a.reason}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(a.values || []).slice(0, 8).map((v) => `${v.value} (${v.count})`).join(" - ")}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{a.product_count}</span>
                <Switch checked={a.indexable} onCheckedChange={(v) => toggleAttr(a, v)} disabled={!!busy} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {pages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{ru ? "Посадочные страницы" : "Landing pages"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 max-h-96 overflow-auto">
            {pages.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs border-b border-border/30 py-1 last:border-0">
                <span className={p.indexable ? "text-emerald-500" : "text-muted-foreground"}>
                  {p.indexable ? "index" : "noindex"}
                </span>
                <span className="truncate flex-1">{p.h1 || p.title}</span>
                <span className="text-muted-foreground truncate max-w-[40%]">{p.url_path}</span>
                <span className="text-muted-foreground shrink-0">{p.product_count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
