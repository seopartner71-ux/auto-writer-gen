import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy, RefreshCw, ExternalLink, AlertCircle, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Ranking {
  id: string;
  article_id: string;
  keyword: string;
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  url: string | null;
  checked_at: string;
  articles?: { title: string | null } | null;
}

export function RankingTracker() {
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasGsc, setHasGsc] = useState<boolean | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("has_gsc_key, gsc_site_url")
        .single();
      setHasGsc(!!((profile as any)?.has_gsc_key && (profile as any)?.gsc_site_url));

      const { data } = await supabase
        .from("article_rankings" as any)
        .select("*, articles(title)")
        .order("position", { ascending: true })
        .limit(20);
      setRankings((data as any) || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-rankings");
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Проверено статей: ${(data as any)?.checked || 0}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Ошибка проверки позиций");
    } finally {
      setRefreshing(false);
    }
  };

  const top10 = rankings.filter((r) => r.position && r.position <= 10);
  const totalImpressions = rankings.reduce((s, r) => s + (r.impressions || 0), 0);
  const totalClicks = rankings.reduce((s, r) => s + (r.clicks || 0), 0);

  if (hasGsc === false) {
    return (
      <Card className="p-6 bg-card/40 backdrop-blur-xl border-border/40">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5" />
          <div>
            <h3 className="font-semibold mb-1">Подключите Google Search Console</h3>
            <p className="text-sm text-muted-foreground">
              Чтобы видеть реальные позиции ваших статей в Google и отслеживать рост трафика.
            </p>
          </div>
        </div>
        <Link to="/integrations">
          <Button size="sm">Подключить GSC</Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card/40 backdrop-blur-xl border-border/40">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Позиции в Google</h3>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || loading}>
          <RefreshCw className={`w-3 h-3 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {rankings.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-2xl font-bold text-emerald-400">{top10.length}</div>
            <div className="text-xs text-muted-foreground">в топ-10</div>
          </div>
          <div className="p-3 rounded-lg bg-background/40 border border-border/40">
            <div className="text-2xl font-bold">{totalImpressions.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">показов</div>
          </div>
          <div className="p-3 rounded-lg bg-background/40 border border-border/40">
            <div className="text-2xl font-bold">{totalClicks.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">кликов</div>
          </div>
        </div>
      )}

      {rankings.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Нажмите "Обновить" - получите позиции по ключам ваших статей из GSC за 28 дней.
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-auto">
          {rankings.map((r) => {
            const pos = r.position ? Math.round(r.position) : null;
            const posColor =
              pos && pos <= 3
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : pos && pos <= 10
                ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                : pos && pos <= 30
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "bg-muted/40 text-muted-foreground";
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-background/40 border border-border/40 hover:border-primary/30 transition-colors"
              >
                <Badge variant="outline" className={`min-w-[44px] justify-center ${posColor}`}>
                  #{pos ?? "-"}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.keyword}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.articles?.title || "Без заголовка"}
                  </div>
                </div>
                <div className="text-right text-xs hidden sm:block">
                  <div className="text-muted-foreground">{r.impressions} показов</div>
                  <div className="text-emerald-400">{r.clicks} кликов</div>
                </div>
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    <Button size="icon" variant="ghost" className="h-7 w-7">
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}