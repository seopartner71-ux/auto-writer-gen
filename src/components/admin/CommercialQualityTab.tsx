import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, RefreshCw, Activity, AlertTriangle } from "lucide-react";

type Row = {
  id: string;
  created_at: string;
  cost_usd: number | null;
  model: string | null;
  metadata: Record<string, any> | null;
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function trafficColor(value: number, good: number, warn: number) {
  if (value <= good) return "text-emerald-400";
  if (value <= warn) return "text-amber-400";
  return "text-rose-400";
}

export function CommercialQualityTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["commercial-quality"],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("cost_log")
        .select("id, created_at, cost_usd, model, metadata")
        .gte("created_at", since)
        .eq("operation_type", "article_generation")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as Row[]).filter((r) => r?.metadata?.kind === "commercial_block");
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загружаем метрики...
      </div>
    );
  }

  const rows = data || [];
  const total = rows.length;
  if (total === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          За последние 7 дней нет генераций коммерческих блоков.
        </CardContent>
      </Card>
    );
  }

  const retried = rows.filter((r) => r.metadata?.retried).length;
  const withFactFlags = rows.filter((r) => Number(r.metadata?.fact_check_count) > 0).length;
  const withAntiFake = rows.filter((r) => Number(r.metadata?.anti_fake_count) > 0).length;
  const avgDev = rows.reduce((s, r) => s + Number(r.metadata?.word_deviation || 0), 0) / total;
  const avgDens = rows.reduce((s, r) => s + Number(r.metadata?.keyword_density || 0), 0) / total;
  const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);

  const byBlock: Record<string, { n: number; retried: number; flags: number }> = {};
  for (const r of rows) {
    const k = `${r.metadata?.page_type || "?"}:${r.metadata?.block_type || "?"}`;
    if (!byBlock[k]) byBlock[k] = { n: 0, retried: 0, flags: 0 };
    byBlock[k].n++;
    if (r.metadata?.retried) byBlock[k].retried++;
    if (Number(r.metadata?.fact_check_count) > 0) byBlock[k].flags++;
  }
  const topBlocks = Object.entries(byBlock).sort((a, b) => b[1].n - a[1].n).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Качество коммерческой генерации</h3>
          <p className="text-xs text-muted-foreground">За последние 7 дней - {total} блоков</p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" /> Обновить
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><RefreshCw className="h-3 w-3" /> Re-write rate</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${trafficColor(retried / total, 0.1, 0.25)}`}>{pct(retried / total)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">{retried} из {total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" /> Fact-check flags</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${trafficColor(withFactFlags / total, 0.15, 0.3)}`}>{pct(withFactFlags / total)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">{withFactFlags} с правками</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> Anti-fake catches</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${trafficColor(withAntiFake / total, 0.1, 0.25)}`}>{pct(withAntiFake / total)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">{withAntiFake} перехвачено regex</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Activity className="h-3 w-3" /> Avg word deviation</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${trafficColor(avgDev, 0.2, 0.35)}`}>{pct(avgDev)}</div>
            <p className="text-[10px] text-muted-foreground mt-1">плотность ключа {pct(avgDens)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Топ-10 блоков (за 7 дней)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {topBlocks.map(([key, st]) => (
              <div key={key} className="flex items-center justify-between p-2 rounded-md bg-muted/30 text-xs">
                <div className="font-mono">{key}</div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{st.n}</Badge>
                  <span className={trafficColor(st.retried / st.n, 0.1, 0.25)}>retry {pct(st.retried / st.n)}</span>
                  <span className={trafficColor(st.flags / st.n, 0.15, 0.3)}>flags {pct(st.flags / st.n)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
            Стоимость за 7 дней: <span className="text-foreground font-semibold">${totalCost.toFixed(4)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Последние 20 генераций</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 text-xs">
            {rows.slice(0, 20).map((r) => {
              const md = r.metadata || {};
              const dev = Number(md.word_deviation || 0);
              return (
                <div key={r.id} className="grid grid-cols-12 gap-2 items-center p-1.5 rounded hover:bg-muted/40">
                  <div className="col-span-3 truncate text-muted-foreground">{new Date(r.created_at).toLocaleString("ru-RU")}</div>
                  <div className="col-span-3 font-mono truncate">{md.page_type}:{md.block_type}</div>
                  <div className="col-span-2 truncate text-muted-foreground">{r.model?.split("/").pop()}</div>
                  <div className={`col-span-1 ${trafficColor(dev, 0.2, 0.35)}`}>{pct(dev)}</div>
                  <div className="col-span-1">{md.retried ? <Badge variant="secondary" className="h-4 text-[9px]">retry</Badge> : null}</div>
                  <div className="col-span-1">{Number(md.fact_check_count) > 0 ? <Badge variant="outline" className="h-4 text-[9px] border-amber-500/40 text-amber-300">{md.fact_check_count}</Badge> : null}</div>
                  <div className="col-span-1 text-right text-muted-foreground">${Number(r.cost_usd || 0).toFixed(4)}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}