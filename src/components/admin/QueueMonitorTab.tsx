import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  ListOrdered, RefreshCw, Clock, AlertTriangle, CheckCircle2,
  Loader2, RotateCcw, Trash2, Activity
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import { useMemo } from "react";

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  queued: { label: "В очереди", color: "text-yellow-500", icon: Clock },
  processing: { label: "В работе", color: "text-primary", icon: Loader2 },
  retry: { label: "Повтор", color: "text-orange-500", icon: RotateCcw },
  completed: { label: "Готово", color: "text-emerald-500", icon: CheckCircle2 },
  failed: { label: "Ошибка", color: "text-destructive", icon: AlertTriangle },
};

export function QueueMonitorTab() {
  const { data: queueItems = [], refetch, isLoading } = useQuery({
    queryKey: ["admin-queue-items"],
    queryFn: async () => {
      const { data } = await supabase
        .from("generation_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["admin-queue-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, email, full_name");
      return data || [];
    },
  });

  const stats = useMemo(() => {
    const statuses: Record<string, number> = {};
    queueItems.forEach((q: any) => {
      statuses[q.status] = (statuses[q.status] || 0) + 1;
    });

    // Avg processing time for completed items
    const completed = queueItems.filter((q: any) => q.status === "completed" && q.started_at && q.completed_at);
    const avgTime = completed.length > 0
      ? completed.reduce((sum: number, q: any) => {
          return sum + (new Date(q.completed_at).getTime() - new Date(q.started_at).getTime());
        }, 0) / completed.length / 1000
      : 0;

    // Throughput chart: completed per hour (last 24h)
    const now = new Date();
    const hourlyData: { hour: string; count: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now);
      hourStart.setHours(now.getHours() - i, 0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourStart.getHours() + 1);
      const count = completed.filter((q: any) => {
        const d = new Date(q.completed_at);
        return d >= hourStart && d < hourEnd;
      }).length;
      hourlyData.push({ hour: format(hourStart, "HH:mm"), count });
    }

    return {
      queued: statuses["queued"] || 0,
      processing: statuses["processing"] || 0,
      retry: statuses["retry"] || 0,
      completed: statuses["completed"] || 0,
      failed: statuses["failed"] || 0,
      total: queueItems.length,
      avgTime: avgTime.toFixed(1),
      hourlyData,
    };
  }, [queueItems]);

  const handleTrigger = async () => {
    try {
      await supabase.functions.invoke("process-queue", { body: {} });
      toast.success("Очередь запущена");
      refetch();
    } catch {
      toast.error("Ошибка запуска очереди");
    }
  };

  const handleClearCompleted = async () => {
    const completedIds = queueItems.filter((q: any) => q.status === "completed" || q.status === "failed").map((q: any) => q.id);
    if (!completedIds.length) return;
    for (const id of completedIds) {
      await supabase.from("generation_queue").delete().eq("id", id);
    }
    toast.success(`Очищено ${completedIds.length} записей`);
    refetch();
  };

  const getUserEmail = (userId: string) => {
    const p = profiles.find((pr: any) => pr.id === userId);
    return p?.email || userId.slice(0, 8);
  };

  const recentItems = queueItems.slice(0, 20);

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Object.entries(statusConfig).map(([key, cfg]) => {
          const Icon = cfg.icon;
          const value = (stats as any)[key] || 0;
          return (
            <Card key={key} className="bg-card border-border">
              <CardContent className="pt-4 pb-3 text-center">
                <Icon className={`h-5 w-5 mx-auto mb-1 ${cfg.color} ${key === "processing" ? "animate-spin" : ""}`} />
                <p className={`text-2xl font-bold ${cfg.color}`}>{value}</p>
                <p className="text-[11px] text-muted-foreground">{cfg.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Metrics row */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{stats.avgTime}с</p>
            <p className="text-[11px] text-muted-foreground">Среднее время генерации</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-[11px] text-muted-foreground">Всего заданий</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">
              {stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(0) : 0}%
            </p>
            <p className="text-[11px] text-muted-foreground">Успешность</p>
          </CardContent>
        </Card>
      </div>

      {/* Throughput chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Пропускная способность (24ч)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={stats.hourlyData}>
              <defs>
                <linearGradient id="qGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" interval={3} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="count" name="Завершено" stroke="hsl(var(--primary))" fill="url(#qGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Actions + progress */}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleTrigger} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Обработать очередь
        </Button>
        <Button size="sm" variant="outline" onClick={handleClearCompleted}>
          <Trash2 className="h-4 w-4 mr-1.5" />
          Очистить завершённые
        </Button>
        {stats.total > 0 && (
          <div className="flex-1">
            <Progress value={(stats.completed / stats.total) * 100} className="h-2" />
          </div>
        )}
      </div>

      {/* Recent items table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Последние задания</CardTitle>
        </CardHeader>
        <CardContent>
          {recentItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Очередь пуста</p>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto scrollbar-hide">
              {recentItems.map((item: any) => {
                const cfg = statusConfig[item.status] || statusConfig.queued;
                const Icon = cfg.icon;
                return (
                  <div key={item.id} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
                    <Icon className={`h-4 w-4 shrink-0 ${cfg.color} ${item.status === "processing" ? "animate-spin" : ""}`} />
                    <span className="font-mono text-xs truncate max-w-[180px]">{getUserEmail(item.user_id)}</span>
                    <Badge variant="outline" className={`text-[10px] ${cfg.color} shrink-0`}>
                      {cfg.label}
                    </Badge>
                    {item.retry_count > 0 && (
                      <span className="text-[10px] text-orange-500">×{item.retry_count}</span>
                    )}
                    {item.error_message && (
                      <span className="text-[10px] text-destructive truncate max-w-[200px]" title={item.error_message}>
                        {item.error_message.slice(0, 50)}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                      {item.created_at ? format(new Date(item.created_at), "dd.MM HH:mm", { locale: ru }) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
