import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { toast } from "sonner";

export type JobType = "content" | "seo" | "media" | "blog";

export interface GenerationJob {
  id: string;
  project_id: string;
  job_type: JobType;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  processed: number;
  total: number;
  current_batch: number;
  total_batches: number;
  progress: number;
  eta_seconds: number | null;
  succeeded: number;
  failed: number;
  log: string[] | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

const ACTIVE = ["queued", "running", "paused"];

/**
 * P20.1 Queue Engine client: one job per (project, job_type) runs in background,
 * the UI only starts it and follows the progress row.
 */
export function useGenerationJob(projectId: string, jobType: JobType, onFinish?: () => void) {
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [busy, setBusy] = useState(false);
  const finishedRef = useRef<string | null>(null);

  const fetchJob = useCallback(async () => {
    const { data } = await supabase
      .from("generation_jobs")
      .select("*")
      .eq("project_id", projectId)
      .eq("job_type", jobType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setJob((data as unknown as GenerationJob) || null);
    return (data as unknown as GenerationJob) || null;
  }, [projectId, jobType]);

  useEffect(() => { void fetchJob(); }, [fetchJob]);

  const active = !!job && ACTIVE.includes(job.status);

  // poll while a job is alive
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { void fetchJob(); }, 3000);
    return () => clearInterval(id);
  }, [active, fetchJob]);

  // notify once when a job leaves the active set
  useEffect(() => {
    if (!job || ACTIVE.includes(job.status)) return;
    if (finishedRef.current === job.id) return;
    finishedRef.current = job.id;
    if (job.status === "completed") onFinish?.();
  }, [job, onFinish]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("queue-engine", { body });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error(String((data as { error?: string }).error));
      const next = (data as { job?: GenerationJob })?.job;
      if (next) { finishedRef.current = null; setJob(next); }
      return data as Record<string, unknown>;
    } catch (e) {
      toast.error(await invokeErrorMessage(e));
      return null;
    } finally {
      setBusy(false);
      void fetchJob();
    }
  }, [fetchJob]);

  const start = useCallback((params: Record<string, unknown> = {}, batchSize?: number) =>
    call({ action: "start", project_id: projectId, job_type: jobType, params, batch_size: batchSize }),
    [call, projectId, jobType]);

  const pause = useCallback(() => job && call({ action: "pause", job_id: job.id }), [call, job]);
  const resume = useCallback(() => job && call({ action: "resume", job_id: job.id }), [call, job]);
  const cancel = useCallback(() => job && call({ action: "cancel", job_id: job.id }), [call, job]);

  return { job, active, busy, start, pause, resume, cancel, refresh: fetchJob };
}
