import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Pause, Play, Square } from "lucide-react";
import type { GenerationJob } from "./useGenerationJob";

function eta(seconds: number | null, ru: boolean): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "-";
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} ${ru ? "сек" : "sec"}`;
  return `~${Math.round(seconds / 60)} ${ru ? "мин" : "min"}`;
}

const LABEL: Record<string, { ru: string; en: string }> = {
  queued: { ru: "В очереди", en: "Queued" },
  running: { ru: "Выполняется", en: "Running" },
  paused: { ru: "Пауза", en: "Paused" },
  completed: { ru: "Завершено", en: "Completed" },
  failed: { ru: "Ошибка", en: "Failed" },
  cancelled: { ru: "Остановлено", en: "Stopped" },
};

interface Props {
  job: GenerationJob | null;
  ru: boolean;
  busy?: boolean;
  title: string;
  /** P21 Smart Resume - job was interrupted and can continue from processed+1 */
  resumable?: boolean;
  /** pages per minute */
  speed?: number;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function QueueJobCard({ job, ru, busy, title, resumable, speed, onPause, onResume, onCancel }: Props) {
  if (!job) return null;
  const active = ["queued", "running", "paused"].includes(job.status);
  const label = LABEL[job.status] || LABEL.queued;
  const tone = job.status === "failed" ? "destructive" : job.status === "completed" ? "default" : "secondary";

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant={tone as "default" | "secondary" | "destructive"}>
          {job.status === "running" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {ru ? label.ru : label.en}
        </Badge>
      </div>

      <Progress value={job.progress || 0} className="h-2" />

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-muted-foreground">{ru ? "Прогресс" : "Progress"}</div>
          <div className="text-sm font-semibold tabular-nums">
            {job.processed} / {job.total || "?"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">{ru ? "Пакет" : "Batch"}</div>
          <div className="text-sm font-semibold tabular-nums">
            {job.current_batch} / {job.total_batches || "?"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">{ru ? "Осталось" : "Remaining"}</div>
          <div className="text-sm font-semibold tabular-nums">
            {active ? eta(job.eta_seconds, ru) : "-"}
          </div>
        </div>
      </div>

      {active && (
        <p className="text-xs text-muted-foreground">
          {ru
            ? "Можно закрыть вкладку - задача продолжит выполняться в фоне."
            : "You can close the tab - the job keeps running in the background."}
        </p>
      )}

      {job.error_message && <p className="text-xs text-destructive">{job.error_message}</p>}

      {active && (
        <div className="flex gap-2">
          {job.status === "paused" ? (
            <Button size="sm" variant="outline" onClick={onResume} disabled={busy}>
              <Play className="h-4 w-4 mr-1" />{ru ? "Продолжить" : "Resume"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
              <Pause className="h-4 w-4 mr-1" />{ru ? "Пауза" : "Pause"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            <Square className="h-4 w-4 mr-1" />{ru ? "Остановить" : "Stop"}
          </Button>
        </div>
      )}

      {!!job.log?.length && (
        <div className="rounded border p-2 font-mono text-[11px] space-y-0.5 max-h-32 overflow-y-auto scrollbar-hide">
          {job.log.slice(-8).map((l, i) => <div key={i} className="text-muted-foreground">{l}</div>)}
        </div>
      )}
    </div>
  );
}
