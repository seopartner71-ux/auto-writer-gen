import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  heartbeat_at?: string | null;
  created_at: string;
}

const ACTIVE = ["queued", "running", "paused"];
/** No heartbeat for this long means the background loop died (deploy, crash). */
const STALE_MS = 4 * 60 * 1000;

/**
 * P20.1 / P21 Queue Engine client: one job per (project, job_type) runs in the
 * background. The UI starts it, follows the row over realtime and can resume a
 * job that was interrupted (Smart Resume).
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

  // Live progress over realtime - no manual refresh needed.
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`gen-jobs-${projectId}-${jobType}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "generation_jobs", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as unknown as GenerationJob | null;
          if (!row || row.job_type !== jobType) return;
          setJob((prev) => (!prev || prev.id === row.id || row.created_at >= prev.created_at ? row : prev));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [projectId, jobType]);

  // Fallback polling while a job is alive (realtime can drop silently).
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { void fetchJob(); }, 5000);
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

  // Smart Resume: a paused job, or a running job whose worker stopped sending
  // heartbeats, can be picked up exactly where it stopped.
  const resumable = useMemo(() => {
    if (!job) return false;
    if (job.status === "paused") return true;
    if (!["queued", "running"].includes(job.status)) return false;
    const beat = Date.parse(job.heartbeat_at || job.started_at || job.created_at);
    return Number.isFinite(beat) && Date.now() - beat > STALE_MS;
  }, [job]);

  // pages per minute over the whole run
  const speed = useMemo(() => {
    if (!job || !job.started_at || !job.processed) return 0;
    const end = job.finished_at ? Date.parse(job.finished_at) : Date.now();
    const mins = (end - Date.parse(job.started_at)) / 60000;
    return mins > 0.05 ? Math.round((job.processed / mins) * 10) / 10 : 0;
  }, [job]);

  return { job, active, busy, resumable, speed, start, pause, resume, cancel, refresh: fetchJob };
}
