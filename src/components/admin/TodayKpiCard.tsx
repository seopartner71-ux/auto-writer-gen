import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Kpi = {
  articles24h: number;
  articles7d: number;
  articles30d: number;
  avgAi: number | null;
  avgTurg: number | null;
  humanizePct: number | null;
  cost24h: number;
  cost7d: number;
  cost30d: number;
  uniqNullPct: number;
};

function colorAi(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v >= 70) return "text-green-500";
  if (v >= 50) return "text-yellow-500";
  return "text-red-500";
}
function colorTurg(v: number | null): string {
  if (v === null) return "text-muted-foreground";
  if (v <= 5) return "text-green-500";
  if (v <= 10) return "text-yellow-500";
  return "text-red-500";
}

export function TodayKpiCard() {
  const [data, setData] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const now = Date.now();
      const d24 = new Date(now - 24 * 3600 * 1000).toISOString();
      const d7 = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
      const d30 = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

      const [{ count: c24 }, { count: c7 }, { count: c30 }] = await Promise.all([
        supabase.from("articles").select("id", { count: "exact", head: true }).gte("created_at", d24).eq("is_ab_test", false),
        supabase.from("articles").select("id", { count: "exact", head: true }).gte("created_at", d7).eq("is_ab_test", false),
        supabase.from("articles").select("id", { count: "exact", head: true }).gte("created_at", d30).eq("is_ab_test", false),
      ]);

      const { data: recent } = await supabase
        .from("articles")
        .select("ai_score,turgenev_score,uniqueness_percent,rewritten")
        .gte("created_at", d7)
        .eq("is_ab_test", false)
        .limit(1000);

      let avgAi: number | null = null, avgTurg: number | null = null, humanizePct: number | null = null, uniqNullPct = 0;
      if (recent && recent.length) {
        const ai = recent.map((r: any) => r.ai_score).filter((v: any) => typeof v === "number");
        const tu = recent.map((r: any) => r.turgenev_score).filter((v: any) => typeof v === "number");
        const rew = recent.filter((r: any) => r.rewritten === true).length;
        const noUniq = recent.filter((r: any) => r.uniqueness_percent == null).length;
        if (ai.length) avgAi = Math.round(ai.reduce((a: number, b: number) => a + b, 0) / ai.length);
        if (tu.length) avgTurg = Math.round(tu.reduce((a: number, b: number) => a + b, 0) / tu.length * 10) / 10;
        humanizePct = Math.round((rew / recent.length) * 100);
        uniqNullPct = Math.round((noUniq / recent.length) * 100);
      }

      const sumCost = async (since: string) => {
        const { data } = await supabase
          .from("cost_log")
          .select("cost_usd")
          .gte("created_at", since)
          .limit(10000);
        return (data || []).reduce((acc: number, r: any) => acc + Number(r.cost_usd || 0), 0);
      };
      const [cost24, cost7, cost30] = await Promise.all([sumCost(d24), sumCost(d7), sumCost(d30)]);

      if (!cancelled) {
        setData({
          articles24h: c24 || 0,
          articles7d: c7 || 0,
          articles30d: c30 || 0,
          avgAi, avgTurg, humanizePct,
          cost24h: Math.round(cost24 * 100) / 100,
          cost7d: Math.round(cost7 * 100) / 100,
          cost30d: Math.round(cost30 * 100) / 100,
          uniqNullPct,
        });
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Сегодня в цифрах</CardTitle>
      </CardHeader>
      <CardContent>
        {loading || !data ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка...
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="Статей 24ч" value={String(data.articles24h)} sub={`${data.articles7d} за 7д · ${data.articles30d} за 30д`} />
            <Kpi label="Средний AI-score (7д)" value={data.avgAi !== null ? String(data.avgAi) : "-"} sub="100 = человек, 0 = AI" cls={colorAi(data.avgAi)} />
            <Kpi label="Средний Турgenev (7д)" value={data.avgTurg !== null ? String(data.avgTurg) : "-"} sub="чем меньше, тем лучше" cls={colorTurg(data.avgTurg)} />
            <Kpi label="Прошли Humanize" value={data.humanizePct !== null ? `${data.humanizePct}%` : "-"} sub="за последние 7 дней" />
            <Kpi label="Себестоимость 24ч" value={`$${data.cost24h.toFixed(2)}`} sub={`$${data.cost7d.toFixed(2)} за 7д · $${data.cost30d.toFixed(2)} за 30д`} />
            <Kpi
              label="Уникальность не записана"
              value={`${data.uniqNullPct}%`}
              sub="должно быть 0"
              cls={data.uniqNullPct > 10 ? "text-red-500" : data.uniqNullPct > 0 ? "text-yellow-500" : "text-green-500"}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold stat-num ${cls || ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}