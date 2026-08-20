import { useCallback, useEffect, useState } from "react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Counts {
  hub: number; category: number; product: number; service: number; blog: number;
  withContent: number; total: number;
}

export function StepContent({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [silos, clusters, products, articles] = await Promise.all([
      supabase.from("site_silos").select("id, seo_content").eq("project_id", projectId).neq("status", "archived"),
      supabase.from("site_clusters").select("id, seo_content").eq("project_id", projectId).neq("status", "archived"),
      supabase.from("site_products").select("id, kind, seo_content").eq("project_id", projectId).neq("status", "archived").limit(3000),
      supabase.from("articles").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    ]);
    const s = (silos.data || []) as { seo_content: unknown }[];
    const c = (clusters.data || []) as { seo_content: unknown }[];
    const p = (products.data || []) as { kind: string; seo_content: unknown }[];
    const filled = [...s, ...c, ...p].filter((x) => x.seo_content && Object.keys(x.seo_content as object).length).length;
    setCounts({
      hub: s.length,
      category: c.length,
      product: p.filter((x) => x.kind !== "service").length,
      service: p.filter((x) => x.kind === "service").length,
      blog: articles.count || 0,
      withContent: filled,
      total: s.length + c.length + p.length,
    });
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-commerce-content", {
        body: { project_id: projectId, scope: "all", limit: 40 },
      });
      if (error) throw error;
      const r = data as { generated?: number; pending?: number; coverage?: { covered: number; total: number } };
      toast.success(ru
        ? `Создано страниц: ${r?.generated ?? 0}${r?.pending ? `, осталось: ${r.pending}` : ""}`
        : `Pages generated: ${r?.generated ?? 0}${r?.pending ? `, pending: ${r.pending}` : ""}`);
      await load();
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "Generation failed"));
    } finally {
      setBusy(false);
    }
  };

  const tiles = [
    { label: ru ? "Hub (силосы)" : "Hub pages", value: counts?.hub ?? 0 },
    { label: ru ? "Категории" : "Categories", value: counts?.category ?? 0 },
    { label: ru ? "Товары" : "Products", value: counts?.product ?? 0 },
    { label: ru ? "Услуги" : "Services", value: counts?.service ?? 0 },
    { label: ru ? "Блог" : "Blog", value: counts?.blog ?? 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border border-border/60 p-3">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="text-xl font-semibold mt-1 tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded border border-border/60 p-3 text-sm">
        {ru ? "SEO-контент заполнен" : "SEO content filled"}: {counts?.withContent ?? 0} / {counts?.total ?? 0}
      </div>

      <div className="flex gap-2">
        <Button onClick={generate} disabled={busy || !counts?.total}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {ru ? "Сгенерировать SEO-контент" : "Generate SEO content"}
        </Button>
        <Button variant="ghost" onClick={load} disabled={busy}>
          <RefreshCw className="h-4 w-4 mr-2" />{ru ? "Обновить" : "Refresh"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {ru
          ? "За один запуск обрабатывается до 40 страниц - повторяйте, пока счетчик не закроется."
          : "Each run processes up to 40 pages - repeat until the counter is full."}
      </p>
    </div>
  );
}