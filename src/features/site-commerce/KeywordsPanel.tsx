import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2, ListTree } from "lucide-react";

interface KeywordLite {
  id: string; keyword: string; frequency: number | null; intent: string | null;
  silo_id: string | null; site_cluster_id: string | null; status: string;
}

export function KeywordsPanel({
  projectId, ru, refreshKey, onStructureBuilt,
}: { projectId: string; ru: boolean; refreshKey: number; onStructureBuilt: () => void }) {
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [items, setItems] = useState<KeywordLite[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("site_keywords")
      .select("id, keyword, frequency, intent, silo_id, site_cluster_id, status")
      .eq("project_id", projectId)
      .order("frequency", { ascending: false })
      .limit(500);
    setItems((data || []) as KeywordLite[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.keyword.toLowerCase().includes(s)) : items;
  }, [items, q]);

  const assignedCount = items.filter((i) => i.site_cluster_id).length;

  const build = async () => {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("build-silo-from-semantics", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      const d = data as any;
      toast.success(ru
        ? `Создано: силосов ${d.silos}, категорий ${d.clusters}, ключей размечено ${d.keywords_assigned}`
        : `Created: ${d.silos} silos, ${d.clusters} categories, ${d.keywords_assigned} keywords assigned`);
      await load();
      onStructureBuilt();
    } catch (e: any) {
      toast.error(e?.message || "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  const clearAll = async () => {
    const { error } = await supabase.from("site_keywords").delete().eq("project_id", projectId);
    if (error) { toast.error(error.message); return; }
    setItems([]);
  };

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ru ? "Поиск по ключам" : "Search keywords"} className="h-8 max-w-xs" />
        <Badge variant="secondary">{items.length}</Badge>
        <Badge variant="outline" className="gap-1"><ListTree className="h-3 w-3" />{ru ? "Размечено" : "Assigned"}: {assignedCount}</Badge>
        <Button size="sm" onClick={build} disabled={building || !items.length}>
          {building ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {ru ? "Построить SILO из семантики" : "Build SILO from semantics"}
        </Button>
        {!!items.length && (
          <Button size="sm" variant="ghost" onClick={clearAll}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />{ru ? "Очистить" : "Clear"}
          </Button>
        )}
      </div>
      {!items.length && (
        <p className="text-sm text-muted-foreground">
          {ru ? "Семантики нет - импортируйте список ключей." : "No semantics yet - import a keyword list."}
        </p>
      )}
      <div className="max-h-[420px] overflow-auto rounded border border-border/60">
        {filtered.map((k) => (
          <div key={k.id} className="flex items-center gap-2 p-2 border-b border-border/40 last:border-0 text-sm">
            <span className="min-w-0 flex-1 truncate">{k.keyword}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{k.frequency ?? "-"}</span>
            {k.site_cluster_id
              ? <Badge variant="outline" className="text-[10px] text-green-500">{ru ? "в структуре" : "in tree"}</Badge>
              : <Badge variant="outline" className="text-[10px]">{ru ? "свободен" : "free"}</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
}