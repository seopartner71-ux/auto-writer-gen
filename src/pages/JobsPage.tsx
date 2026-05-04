import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { BackgroundJob } from "@/features/background-jobs/useBackgroundJobs";

const labelMap: Record<string, string> = {
  humanize: "Humanize Fix",
  benchmark: "Учёт конкурентов",
  optimize: "Оптимизация",
  serp_check: "SERP проверка",
  rewrite: "Переписывание",
};

export default function JobsPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("background_jobs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setJobs((data as BackgroundJob[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!user?.id) return;
    const ch = supabase
      .channel(`jobs_page_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "background_jobs", filter: `user_id=eq.${user.id}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const clearCompleted = async () => {
    if (!user?.id) return;
    await supabase
      .from("background_jobs")
      .delete()
      .eq("user_id", user.id)
      .in("status", ["done", "error"]);
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("background_jobs").delete().eq("id", id);
    load();
  };

  const renderStatus = (j: BackgroundJob) => {
    if (j.status === "running" || j.status === "pending")
      return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />В процессе</Badge>;
    if (j.status === "done")
      return <Badge className="gap-1 bg-green-500/15 text-green-500 hover:bg-green-500/20"><CheckCircle2 className="h-3 w-3" />Готово</Badge>;
    return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Ошибка</Badge>;
  };

  return (
    <div className="container max-w-5xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Фоновые задачи</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Обновить
          </Button>
          <Button variant="outline" size="sm" onClick={clearCompleted}>
            <Trash2 className="h-4 w-4 mr-2" /> Очистить завершённые
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">История ({jobs.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка...
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Задач пока нет</div>
          ) : (
            jobs.map((j) => (
              <div key={j.id} className="border rounded-lg p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{labelMap[j.job_type] || j.job_type}</span>
                    {renderStatus(j)}
                    {j.article_id && (
                      <Link to={`/articles?id=${j.article_id}`} className="text-xs text-primary underline">
                        Открыть статью
                      </Link>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(j.created_at).toLocaleString("ru-RU")}
                    {j.finished_at && ` - завершено ${new Date(j.finished_at).toLocaleTimeString("ru-RU")}`}
                    {j.error && ` - ${j.error}`}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(j.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}