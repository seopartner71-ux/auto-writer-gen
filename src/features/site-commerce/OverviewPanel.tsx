import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, RefreshCw, Layers, FolderTree, Package, FileText, Link2, Repeat } from "lucide-react";

interface Stats {
  silos: number; silosDraft: number; clusters: number; clustersDraft: number;
  products: number; services: number; orphans: number; review: number;
  articles: number; links: number; redirects: number; queued: number;
}

interface QaReport { score: number; critical: number; warnings: number; pages: number; checked_at: string }

export function OverviewPanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [qa, setQa] = useState<QaReport | null>(null);
  const [gate, setGate] = useState(true);
  const [domain, setDomain] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const count = (table: string, build: (q: ReturnType<typeof supabase.from>) => unknown) => build(supabase.from(table as never));
    const [silos, clusters, products, articles, links, redirects, queue, project] = await Promise.all([
      supabase.from("site_silos").select("id, status").eq("project_id", projectId).neq("status", "archived"),
      supabase.from("site_clusters").select("id, status").eq("project_id", projectId).neq("status", "archived"),
      supabase.from("site_products").select("id, kind, site_cluster_id, assignment_status").eq("project_id", projectId).neq("status", "archived").limit(2000),
      supabase.from("articles").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supabase.from("internal_links").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supabase.from("site_redirects").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      supabase.from("site_deploy_queue").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "pending"),
      supabase.from("projects").select("last_qa_report, qa_gate_enabled, custom_domain, domain").eq("id", projectId).maybeSingle(),
    ]);
    void count;
    const prods = (products.data || []) as { kind: string; site_cluster_id: string | null; assignment_status: string | null }[];
    setStats({
      silos: (silos.data || []).length,
      silosDraft: (silos.data || []).filter((s: { status: string }) => s.status === "draft").length,
      clusters: (clusters.data || []).length,
      clustersDraft: (clusters.data || []).filter((c: { status: string }) => c.status === "draft").length,
      products: prods.filter((p) => p.kind !== "service").length,
      services: prods.filter((p) => p.kind === "service").length,
      orphans: prods.filter((p) => !p.site_cluster_id).length,
      review: prods.filter((p) => p.assignment_status === "review").length,
      articles: articles.count || 0,
      links: links.count || 0,
      redirects: redirects.count || 0,
      queued: queue.count || 0,
    });
    const proj = project.data as { last_qa_report: QaReport | null; qa_gate_enabled: boolean; custom_domain: string | null; domain: string | null } | null;
    setQa(proj?.last_qa_report || null);
    setGate(proj?.qa_gate_enabled !== false);
    setDomain(proj?.custom_domain || proj?.domain || "");
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const toggleGate = async (v: boolean) => {
    setGate(v);
    const { error } = await supabase.from("projects").update({ qa_gate_enabled: v } as never).eq("id", projectId);
    if (error) toast.error(error.message);
  };

  if (loading || !stats) return <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const scoreColor = !qa ? "" : qa.score >= 70 ? "text-green-500" : qa.score >= 30 ? "text-yellow-500" : "text-destructive";

  const tiles = [
    { icon: Layers, label: ru ? "Силосы" : "Silos", value: `${stats.silos}`, hint: stats.silosDraft ? `${ru ? "черновиков" : "draft"}: ${stats.silosDraft}` : "" },
    { icon: FolderTree, label: ru ? "Категории" : "Categories", value: `${stats.clusters}`, hint: stats.clustersDraft ? `${ru ? "черновиков" : "draft"}: ${stats.clustersDraft}` : "" },
    { icon: Package, label: ru ? "Товары / услуги" : "Products / services", value: `${stats.products} / ${stats.services}`, hint: stats.orphans ? `${ru ? "без категории" : "orphans"}: ${stats.orphans}` : "" },
    { icon: FileText, label: ru ? "Статьи" : "Articles", value: `${stats.articles}`, hint: "" },
    { icon: Link2, label: ru ? "Внутренние ссылки" : "Internal links", value: `${stats.links}`, hint: "" },
    { icon: Repeat, label: ru ? "Редиректы 301" : "301 redirects", value: `${stats.redirects}`, hint: stats.queued ? `${ru ? "в очереди" : "queued"}: ${stats.queued}` : "" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{domain || (ru ? "домен не задан" : "no domain")}</Badge>
        {qa && <Badge variant="outline" className={scoreColor}>QA: {qa.score}/100</Badge>}
        {qa && <Badge variant="outline" className={qa.critical ? "text-destructive" : "text-green-500"}>
          {ru ? "Критичных" : "Critical"}: {qa.critical}
        </Badge>}
        <Button size="sm" variant="ghost" className="h-8 ml-auto" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />{ru ? "Обновить" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border border-border/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </div>
            <div className="text-xl font-semibold mt-1">{t.value}</div>
            {t.hint && <div className="text-xs text-yellow-500 mt-0.5">{t.hint}</div>}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 rounded border border-border/60 p-3">
        <Switch id="qa-gate" checked={gate} onCheckedChange={toggleGate} />
        <Label htmlFor="qa-gate" className="text-sm">
          {ru
            ? "Блокировать публикацию при критических ошибках QA"
            : "Block publishing when QA finds critical issues"}
        </Label>
      </div>

      {stats.review > 0 && (
        <p className="text-xs text-yellow-500">
          {ru
            ? `Товаров с неуверенной привязкой: ${stats.review}. Проверьте вкладку «Товары и услуги», фильтр «На проверку».`
            : `Products with low-confidence assignment: ${stats.review}. See the Products tab, Review filter.`}
        </p>
      )}
    </div>
  );
}
