import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Gauge, RefreshCw, Play } from "lucide-react";

interface RegistryRow {
  entity_type: string;
  page_type: string | null;
  title: string | null;
  url_path: string;
  intent: string | null;
  demand_score: number;
  semantic_score: number;
  product_count: number;
  has_offer: boolean | null;
  decision: string;
  reason: string | null;
  status: string;
  decided_at: string;
}

const DECISION_COLOR: Record<string, string> = {
  approved: "text-green-500",
  candidate: "text-yellow-500",
  review: "text-orange-500",
  rejected: "text-destructive",
  published: "text-green-500",
};

export function PdePanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RegistryRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("page_registry")
      .select("entity_type, page_type, title, url_path, intent, demand_score, semantic_score, product_count, has_offer, decision, reason, status, decided_at")
      .eq("project_id", projectId)
      .order("demand_score", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setRows((data || []) as RegistryRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (dryRun: boolean) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("page-decision-engine", {
        body: { project_id: projectId, dry_run: dryRun },
      });
      if (error) throw error;
      const s = (data as { summary?: { total: number; approved: number; rejected: number } })?.summary;
      toast.success(ru
        ? `Решений: ${s?.total ?? 0}, одобрено ${s?.approved ?? 0}, отклонено ${s?.rejected ?? 0}`
        : `Decisions: ${s?.total ?? 0}, approved ${s?.approved ?? 0}, rejected ${s?.rejected ?? 0}`);
      if (!dryRun) await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDE failed");
    } finally {
      setRunning(false);
    }
  };

  const count = (fn: (r: RegistryRow) => boolean) => rows.filter(fn).length;
  const tiles = [
    { label: ru ? "Всего сущностей" : "Total entities", value: rows.length },
    { label: ru ? "Кандидаты" : "Candidate", value: count((r) => r.decision === "candidate") },
    { label: ru ? "Одобрено" : "Approved", value: count((r) => r.decision === "approved") },
    { label: ru ? "На проверку" : "Review", value: count((r) => r.decision === "review") },
    { label: ru ? "Отклонено" : "Rejected", value: count((r) => r.decision === "rejected") },
    { label: ru ? "Категории" : "Category", value: count((r) => r.page_type === "category") },
    { label: ru ? "Товары" : "Product", value: count((r) => r.page_type === "product") },
    { label: ru ? "Услуги" : "Service", value: count((r) => r.page_type === "service") },
    { label: ru ? "Информационные" : "Informational", value: count((r) => r.page_type === "informational") },
    { label: ru ? "Локальные" : "Local", value: count((r) => r.page_type === "local") },
    { label: "Hub", value: count((r) => r.page_type === "hub") },
    { label: ru ? "Статьи" : "Article", value: count((r) => r.page_type === "article") },
  ];

  const recent = [...rows]
    .sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1))
    .slice(0, 40);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5" />Page Decision Engine
        </Badge>
        <Button size="sm" onClick={() => run(false)} disabled={running} className="ml-auto">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Play className="h-3.5 w-3.5 mr-2" />}
          {ru ? "Пересчитать решения" : "Recompute decisions"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => run(true)} disabled={running}>
          {ru ? "Тест (без записи)" : "Dry run"}
        </Button>
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {loading ? (
        <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {tiles.map((t) => (
              <div key={t.label} className="rounded border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t.label}</div>
                <div className="text-xl font-semibold mt-1">{t.value}</div>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ru
                ? "Реестр пуст. Запустите пересчет решений - сборка коммерческого сайта без реестра завершится ошибкой page_registry_empty."
                : "Registry is empty. Run the engine - a commercial build without it fails with page_registry_empty."}
            </p>
          ) : (
            <div className="rounded border border-border/60 overflow-auto max-h-[520px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-muted-foreground">
                    <th className="text-left p-2">{ru ? "Страница" : "Page"}</th>
                    <th className="text-left p-2">{ru ? "Тип" : "Type"}</th>
                    <th className="text-left p-2">Intent</th>
                    <th className="text-right p-2">Demand</th>
                    <th className="text-right p-2">{ru ? "Товары" : "Products"}</th>
                    <th className="text-left p-2">{ru ? "Предложение" : "Offer"}</th>
                    <th className="text-left p-2">{ru ? "Решение" : "Decision"}</th>
                    <th className="text-left p-2">{ru ? "Причина" : "Reason"}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={`${r.entity_type}-${r.url_path}`} className="border-t border-border/40">
                      <td className="p-2 max-w-[260px]">
                        <div className="truncate">{r.title || r.url_path}</div>
                        <div className="text-muted-foreground truncate">{r.url_path}</div>
                      </td>
                      <td className="p-2">{r.page_type}</td>
                      <td className="p-2">{r.intent}</td>
                      <td className="p-2 text-right">{r.demand_score}</td>
                      <td className="p-2 text-right">{r.product_count}</td>
                      <td className="p-2">{r.has_offer ? (ru ? "есть" : "yes") : "-"}</td>
                      <td className={`p-2 ${DECISION_COLOR[r.status] || ""}`}>{r.status}</td>
                      <td className="p-2 text-muted-foreground">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
