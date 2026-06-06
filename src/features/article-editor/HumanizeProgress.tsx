import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type HumanizeStage = "pass1" | "pass2" | "finalize" | "done" | "error";

interface Step {
  key: Exclude<HumanizeStage, "done" | "error">;
  labelRu: string;
  labelEn: string;
  /** Cumulative progress (0..1) at the end of this step. */
  endAt: number;
}

const STEPS: Step[] = [
  { key: "pass1",    labelRu: "Pass 1 — глубокое переписывание (Sonnet)", labelEn: "Pass 1 - deep rewrite (Sonnet)",    endAt: 0.50 },
  { key: "pass2",    labelRu: "Pass 2 — микро-полировка (Opus)",          labelEn: "Pass 2 - micro polish (Opus)",      endAt: 0.92 },
  { key: "finalize", labelRu: "Finalize — сохраняем результат",           labelEn: "Finalize - saving result",          endAt: 1.00 },
];

interface Props {
  startedAt: number;
  /** Estimated total duration in ms. Used to drive the progress bar. */
  estimatedMs?: number;
  /** Override the auto-derived stage (e.g. on completion or error). */
  forcedStage?: HumanizeStage;
  lang?: "ru" | "en";
}

/**
 * Stepper + progress bar for the humanize-article double pass.
 * Since the edge function is a black-box single request (no streaming
 * intermediates), progress is driven by elapsed time against an
 * estimated total. Steps light up in order; the bar fills smoothly.
 */
export function HumanizeProgress({
  startedAt,
  estimatedMs = 130_000,
  forcedStage,
  lang = "ru",
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (forcedStage === "done" || forcedStage === "error") return;
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [forcedStage]);

  const elapsed = Math.max(0, now - startedAt);
  // Cap the auto-progress at 95% so the bar doesn't claim "done" before
  // the server actually returns — the final 5% is filled on completion.
  const autoPct = Math.min(0.95, elapsed / estimatedMs);
  const pct = forcedStage === "done" ? 1 : forcedStage === "error" ? autoPct : autoPct;

  const currentIdx =
    forcedStage === "done" ? STEPS.length
    : forcedStage === "error" ? STEPS.findIndex((s) => pct < s.endAt)
    : STEPS.findIndex((s) => pct < s.endAt);
  const safeIdx = currentIdx === -1 ? STEPS.length - 1 : currentIdx;

  const title = lang === "ru"
    ? (forcedStage === "done" ? "Гуманизация завершена" :
       forcedStage === "error" ? "Гуманизация не завершилась" :
       "Гуманизируем текст")
    : (forcedStage === "done" ? "Humanize complete" :
       forcedStage === "error" ? "Humanize didn't finish" :
       "Humanizing text");

  const elapsedSec = Math.floor(elapsed / 1000);

  return (
    <div className="w-[340px] rounded-lg border border-border bg-popover p-3 shadow-md">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {forcedStage === "done" ? (
            <Check className="h-4 w-4 text-primary" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          <span>{title}</span>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">{elapsedSec}s</span>
      </div>

      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            forcedStage === "error" ? "bg-amber-500" : "bg-primary",
          )}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>

      <ul className="space-y-1.5">
        {STEPS.map((s, i) => {
          const isDone = i < safeIdx || forcedStage === "done";
          const isActive = i === safeIdx && forcedStage !== "done";
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-2 text-[12px]",
                isDone ? "text-foreground" : isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-semibold",
                  isDone
                    ? "border-primary bg-primary text-primary-foreground"
                    : isActive
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground",
                )}
              >
                {isDone ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              <span>{lang === "ru" ? s.labelRu : s.labelEn}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}