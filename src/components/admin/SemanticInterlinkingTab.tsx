import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Network, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

// Admin tab: shows embedding coverage across all articles + lets you trigger
// a global backfill batch. Used to roll out semantic interlinking on legacy data.
export function SemanticInterlinkingTab() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{ processed: number; failed: number } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["embedding-coverage"],
    queryFn: async () => {
      const { count: totalCount } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .in("status", ["completed", "published"])
        .eq("is_ab_test", false);
      const { count: missingCount } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .in("status", ["completed", "published"])
        .is("embedding", null)
        .eq("is_ab_test", false);
      const total = totalCount ?? 0;
      const missing = missingCount ?? 0;
      return {
        total,
        missing,
        covered: total - missing,
        coverage: total ? Math.round(((total - missing) / total) * 1000) / 10 : 0,
      };
    },
    refetchInterval: 30_000,
  });

  const runBackfill = async () => {
    setRunning(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("generate-embedding", {
        body: { all: true, limit: 100 },
      });
      if (error) throw error;
      setLastResult({ processed: res?.processed ?? 0, failed: res?.failed ?? 0 });
      toast.success(`Обработано: ${res?.processed ?? 0}, ошибок: ${res?.failed ?? 0}`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Ошибка backfill");
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const coverage = data?.coverage ?? 0;
  const coverageColor =
    coverage >= 70 ? "text-emerald-500" : coverage >= 30 ? "text-amber-500" : "text-rose-500";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="h-4 w-4" />
            Семантический интерлинкинг
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Smart Interlinking использует cosine similarity по эмбеддингам (text-embedding-3-small,
            1536 измерений) как основной сигнал релевантности. Если у статьи нет эмбеддинга -
            фолбэк на keyword/topic/entity матчинг.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground mb-1">Всего статей</div>
                <div className="text-2xl font-semibold">{data?.total ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground mb-1">С эмбеддингом</div>
                <div className="text-2xl font-semibold">{data?.covered ?? 0}</div>
              </CardContent>
            </Card>
            <Card className="border-primary/40">
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground mb-1">Покрытие</div>
                <div className={`text-2xl font-semibold ${coverageColor}`}>{coverage}%</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Осталось: {data?.missing ?? 0}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={runBackfill} disabled={running || (data?.missing ?? 0) === 0}>
              {running ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Догенерировать 100 эмбеддингов
            </Button>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
            {lastResult && (
              <Badge variant="outline" className="ml-auto">
                Прошлая сессия: +{lastResult.processed} (ошибок {lastResult.failed})
              </Badge>
            )}
          </div>

          <div className="text-xs text-muted-foreground border-t border-border pt-3">
            <strong>Источник эмбеддингов:</strong> OpenRouter (тот же ключ, что и для генерации статей),
            модель openai/text-embedding-3-small. Стоимость - около $0.02 за 1000 статей.
            При недоступности функция тихо возвращает skipped и интерлинкер откатывается на keyword-матчинг.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}