import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Trash2, Package, Wand2 } from "lucide-react";

interface ProductLite {
  id: string; name: string; sku: string | null; price: number | null; currency: string | null;
  brand: string | null; site_cluster_id: string | null; url_path: string | null; kind: string; status: string;
  cluster_confidence: number | null; assignment_status: string | null;
}
interface ClusterLite { id: string; name: string; silo_id: string | null }

type Filter = "all" | "orphan" | "review" | "service";

export function ProductsPanel({ projectId, ru, refreshKey }: { projectId: string; ru: boolean; refreshKey: number }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ProductLite[]>([]);
  const [clusters, setClusters] = useState<ClusterLite[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCluster, setBulkCluster] = useState<string>("none");
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("site_products")
        .select("id, name, sku, price, currency, brand, site_cluster_id, url_path, kind, status, cluster_confidence, assignment_status")
        .eq("project_id", projectId).order("position").limit(500),
      supabase.from("site_clusters").select("id, name, silo_id").eq("project_id", projectId).order("position"),
    ]);
    setItems((p || []) as ProductLite[]);
    setClusters((c || []) as ClusterLite[]);
    setSelected(new Set());
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const counts = useMemo(() => ({
    all: items.length,
    orphan: items.filter((i) => !i.site_cluster_id).length,
    review: items.filter((i) => i.assignment_status === "review").length,
    service: items.filter((i) => i.kind === "service").length,
  }), [items]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === "orphan" && i.site_cluster_id) return false;
      if (filter === "review" && i.assignment_status !== "review") return false;
      if (filter === "service" && i.kind !== "service") return false;
      if (s && !(i.name + " " + (i.sku || "")).toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, q, filter]);

  const patch = (ids: string[], values: Partial<ProductLite>) =>
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, ...values } : i)));

  const assign = async (id: string, clusterId: string) => {
    const value = clusterId === "none" ? null : clusterId;
    const siloId = clusters.find((c) => c.id === value)?.silo_id ?? null;
    patch([id], { site_cluster_id: value, assignment_status: value ? "manual" : "unassigned", cluster_confidence: value ? 1 : null });
    const { error } = await supabase.from("site_products")
      .update({ site_cluster_id: value, silo_id: siloId, assignment_status: value ? "manual" : "unassigned", cluster_confidence: value ? 1 : null } as never)
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const setKind = async (id: string, kind: string) => {
    patch([id], { kind });
    const { error } = await supabase.from("site_products").update({ kind } as never).eq("id", id);
    if (error) toast.error(error.message);
  };

  const bulkAssign = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const value = bulkCluster === "none" ? null : bulkCluster;
    const siloId = clusters.find((c) => c.id === value)?.silo_id ?? null;
    patch(ids, { site_cluster_id: value, assignment_status: value ? "manual" : "unassigned", cluster_confidence: value ? 1 : null });
    const { error } = await supabase.from("site_products")
      .update({ site_cluster_id: value, silo_id: siloId, assignment_status: value ? "manual" : "unassigned", cluster_confidence: value ? 1 : null } as never)
      .in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(ru ? `Перенесено: ${ids.length}` : `Moved: ${ids.length}`);
    setSelected(new Set());
  };

  const autoAssign = async () => {
    setAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke("assign-products-to-silo", {
        body: { project_id: projectId, only_unassigned: true },
      });
      if (error) throw error;
      const t = (data as { totals?: { assigned: number; review: number; skipped: number } })?.totals;
      toast.success(ru
        ? `Привязано: ${t?.assigned ?? 0}, на проверку: ${t?.review ?? 0}, пропущено: ${t?.skipped ?? 0}`
        : `Assigned: ${t?.assigned ?? 0}, review: ${t?.review ?? 0}, skipped: ${t?.skipped ?? 0}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auto-assign failed");
    } finally {
      setAssigning(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("site_products").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const confColor = (v: number | null) =>
    v === null ? "" : v >= 0.7 ? "text-green-500" : v >= 0.3 ? "text-yellow-500" : "text-destructive";

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const FILTERS: { key: Filter; ru: string; en: string }[] = [
    { key: "all", ru: "Все", en: "All" },
    { key: "orphan", ru: "Без категории", en: "Orphans" },
    { key: "review", ru: "На проверку", en: "Review" },
    { key: "service", ru: "Услуги", en: "Services" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ru ? "Поиск по товарам" : "Search products"} className="h-8 max-w-xs" />
        {FILTERS.map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "secondary" : "ghost"} className="h-8"
            onClick={() => setFilter(f.key)}>
            {ru ? f.ru : f.en} <span className="ml-1 opacity-60">{counts[f.key]}</span>
          </Button>
        ))}
        <Button size="sm" variant="outline" className="h-8 ml-auto" onClick={autoAssign} disabled={assigning || !clusters.length}>
          {assigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
          {ru ? "Авто-привязка" : "Auto-assign"}
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-2">
          <Badge variant="secondary">{ru ? "Выбрано" : "Selected"}: {selected.size}</Badge>
          <Select value={bulkCluster} onValueChange={setBulkCluster}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{ru ? "Без категории" : "No category"}</SelectItem>
              {clusters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8" onClick={bulkAssign}>{ru ? "Перенести" : "Move"}</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelected(new Set())}>
            {ru ? "Сбросить" : "Clear"}
          </Button>
        </div>
      )}

      {!items.length && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Package className="h-4 w-4" />
          {ru ? "Товаров пока нет - импортируйте фид или таблицу." : "No products yet - import a feed or a table."}
        </p>
      )}

      <div className="max-h-[420px] overflow-auto rounded border border-border/60">
        {filtered.map((p) => (
          <div key={p.id} className="flex items-center gap-2 p-2 border-b border-border/40 last:border-0 text-sm">
            <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
            <div className="min-w-0 flex-1">
              <div className="truncate flex items-center gap-2">
                {p.name}
                {p.assignment_status === "review" && (
                  <Badge variant="outline" className="text-yellow-500 text-[10px]">{ru ? "проверить" : "review"}</Badge>
                )}
                {p.cluster_confidence !== null && (
                  <span className={`text-[10px] ${confColor(p.cluster_confidence)}`}>
                    {Math.round(Number(p.cluster_confidence) * 100)}%
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {[p.sku, p.brand, p.price ? `${p.price} ${p.currency || ""}` : null, p.url_path].filter(Boolean).join(" - ")}
              </div>
            </div>
            <Select value={p.kind === "service" ? "service" : "product"} onValueChange={(v) => setKind(p.id, v)}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="product">{ru ? "Товар" : "Product"}</SelectItem>
                <SelectItem value="service">{ru ? "Услуга" : "Service"}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={p.site_cluster_id || "none"} onValueChange={(v) => assign(p.id, v)}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{ru ? "Без категории" : "No category"}</SelectItem>
                {clusters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(p.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
