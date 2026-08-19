import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Trash2, Package } from "lucide-react";

interface ProductLite {
  id: string; name: string; sku: string | null; price: number | null; currency: string | null;
  brand: string | null; site_cluster_id: string | null; url_path: string | null; kind: string; status: string;
}
interface ClusterLite { id: string; name: string }

export function ProductsPanel({ projectId, ru, refreshKey }: { projectId: string; ru: boolean; refreshKey: number }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ProductLite[]>([]);
  const [clusters, setClusters] = useState<ClusterLite[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("site_products")
        .select("id, name, sku, price, currency, brand, site_cluster_id, url_path, kind, status")
        .eq("project_id", projectId).order("position").limit(500),
      supabase.from("site_clusters").select("id, name").eq("project_id", projectId).order("position"),
    ]);
    setItems((p || []) as ProductLite[]);
    setClusters((c || []) as ClusterLite[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => (i.name + " " + (i.sku || "")).toLowerCase().includes(s)) : items;
  }, [items, q]);

  const assign = async (id: string, clusterId: string) => {
    const value = clusterId === "none" ? null : clusterId;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, site_cluster_id: value } : i)));
    const { error } = await supabase.from("site_products").update({ site_cluster_id: value } as any).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("site_products").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ru ? "Поиск по товарам" : "Search products"} className="h-8 max-w-xs" />
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {!items.length && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Package className="h-4 w-4" />
          {ru ? "Товаров пока нет - импортируйте фид или таблицу." : "No products yet - import a feed or a table."}
        </p>
      )}
      <div className="max-h-[420px] overflow-auto rounded border border-border/60">
        {filtered.map((p) => (
          <div key={p.id} className="flex items-center gap-2 p-2 border-b border-border/40 last:border-0 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {[p.sku, p.brand, p.price ? `${p.price} ${p.currency || ""}` : null, p.url_path].filter(Boolean).join(" - ")}
              </div>
            </div>
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