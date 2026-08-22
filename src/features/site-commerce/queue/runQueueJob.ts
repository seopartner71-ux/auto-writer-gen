// P21 - run a Queue Engine job and follow it to completion.
// Used by the Launch pipeline: mass engines (content / seo / media / blog) are
// never called directly any more, the Launch Gate only creates jobs.

import { supabase } from "@/integrations/supabase/client";
import type { GenerationJob, JobType } from "./useGenerationJob";

const TERMINAL = ["completed", "failed", "cancelled"];

export interface QueueRunResult {
  job: GenerationJob | null;
  ok: boolean;
  error?: string;
}

/**
 * Starts (or picks up) a background job and resolves when it leaves the active
 * state. `onProgress` receives 0-100 so the caller can render a pipeline stage.
 */
export async function runQueueJob(
  projectId: string,
  jobType: JobType,
  params: Record<string, unknown> = {},
  onProgress?: (progress: number, job: GenerationJob | null) => void,
  opts: { maxMinutes?: number; shouldStop?: () => boolean } = {},
): Promise<QueueRunResult> {
  const { data, error } = await supabase.functions.invoke("queue-engine", {
    body: { action: "start", project_id: projectId, job_type: jobType, params },
  });
  if (error) return { job: null, ok: false, error: error.message };
  let job = (data as { job?: GenerationJob } | null)?.job || null;
  if (!job) return { job: null, ok: false, error: "job not created" };

  const deadline = Date.now() + (opts.maxMinutes ?? 60) * 60_000;
  while (Date.now() < deadline) {
    if (opts.shouldStop?.()) return { job, ok: false, error: "cancelled" };
    await new Promise((r) => setTimeout(r, 4000));
    const { data: row } = await supabase.from("generation_jobs")
      .select("*").eq("id", job.id).maybeSingle();
    job = (row as unknown as GenerationJob) || job;
    onProgress?.(Math.min(99, Number(job.progress) || 0), job);
    if (TERMINAL.includes(job.status)) {
      onProgress?.(100, job);
      return { job, ok: job.status === "completed", error: job.error_message || undefined };
    }
  }
  return { job, ok: false, error: "timeout" };
}
