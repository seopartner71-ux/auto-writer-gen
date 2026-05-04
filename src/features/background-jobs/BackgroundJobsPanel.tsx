import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BackgroundJob } from "./useBackgroundJobs";

const labelMap: Record<string, string> = {
  humanize: "Humanize Fix",
  benchmark: "Учёт конкурентов",
  optimize: "Оптимизация",
  serp_check: "SERP проверка",
  rewrite: "Переписывание",
};

export function BackgroundJobsPanel({ userId }: { userId: string | undefined }) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);

  const load = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("background_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8);
    setJobs((data as BackgroundJob[]) || []);
  };

  useEffect(() => {
    if (!userId) return;
    load();
    const ch = supabase
      .channel(`bg_jobs_panel_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "background_jobs", filter: `user_id=eq.${userId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const dismiss = async (id: string) => {
    await supabase.from("background_jobs").delete().eq("id", id);
    load();
  };

  const active = jobs.filter((j) => j.status === "running" || j.status === "pending");
  const recent = jobs.filter((j) => j.status === "done" || j.status === "error").slice(0, 3);
  const visible = [...active, ...recent];

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 space-y-2">
      {visible.map((j) => (
        <div
          key={j.id}
          className="bg-card/95 backdrop-blur border rounded-lg shadow-lg p-3 text-sm flex items-center gap-3"
        >
          {j.status === "running" || j.status === "pending" ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          ) : j.status === "done" ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{labelMap[j.job_type] || j.job_type}</div>
            <div className="text-xs text-muted-foreground truncate">
              {j.status === "running" || j.status === "pending"
                ? "В процессе..."
                : j.status === "done"
                ? "Завершено"
                : j.error || "Ошибка"}
            </div>
          </div>
          {(j.status === "done" || j.status === "error") && (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => dismiss(j.id)}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}