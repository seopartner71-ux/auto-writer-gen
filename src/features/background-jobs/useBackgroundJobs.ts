import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BackgroundJob {
  id: string;
  user_id: string;
  article_id: string | null;
  job_type: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  result: any;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const labelMap: Record<string, string> = {
  humanize: "Humanize Fix",
  benchmark: "Учёт конкурентов",
  optimize: "Оптимизация",
  serp_check: "SERP проверка",
  rewrite: "Переписывание",
};

export function useBackgroundJobsListener(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`bg_jobs_${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "background_jobs", filter: `user_id=eq.${userId}` },
        (payload) => {
          const job = payload.new as BackgroundJob;
          const label = labelMap[job.job_type] || job.job_type;
          if (job.status === "done") {
            toast.success(`${label} завершено`, { duration: 6000 });
          } else if (job.status === "error") {
            toast.error(`${label}: ошибка - ${job.error || "неизвестная"}`, { duration: 8000 });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);
}

export async function startBackgroundJob(params: {
  userId: string;
  articleId?: string | null;
  jobType: string;
  payload?: any;
}) {
  const { data, error } = await supabase
    .from("background_jobs")
    .insert({
      user_id: params.userId,
      article_id: params.articleId ?? null,
      job_type: params.jobType,
      status: "running",
      progress: 0,
      payload: params.payload ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function finishBackgroundJob(id: string, result: any) {
  await supabase
    .from("background_jobs")
    .update({ status: "done", progress: 100, result, finished_at: new Date().toISOString() })
    .eq("id", id);
}

export async function failBackgroundJob(id: string, error: string) {
  await supabase
    .from("background_jobs")
    .update({ status: "error", error, finished_at: new Date().toISOString() })
    .eq("id", id);
}