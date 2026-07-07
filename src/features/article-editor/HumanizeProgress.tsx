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
  { key: "pass1",    labelRu: "Pass 1 - глубокое переписывание (Sonnet)", labelEn: "Pass 1 - deep rewrite (Sonnet)",    endAt: 0.50 },
  { key: "pass2",    labelRu: "Pass 2 - микро-полировка (Opus)",          labelEn: "Pass 2 - micro polish (Opus)",      endAt: 0.92 },
  { key: "finalize", labelRu: "Finalize - сохраняем результат",           labelEn: "Finalize - saving result",          endAt: 1.00 },
];

export interface HumanizeMetricsSnapshot {
  avgWords?: number;
  shortRatio?: number;
  maxShortRun?: number;
  chainViolations?: number;
  banlistHits?: number;
  repeatedOpeners?: number;
  repeatedNgrams?: number;
  signatures?: {
    headings?: number;
    listItems?: number;
    links?: number;
    numbers?: number;
  };
}

export interface HumanizeMetricsReport {
  pre?: HumanizeMetricsSnapshot;
  postPass1?: HumanizeMetricsSnapshot;
  postPass2?: HumanizeMetricsSnapshot;
  postCleanup?: HumanizeMetricsSnapshot;
  /** Preflight anti-fake replacements (counted once before pass 1). */
  fakesFixed?: number;
}

interface Props {
  startedAt: number;
  /** Estimated total duration in ms. Used to drive the progress bar. */
  estimatedMs?: number;
  /** Override the auto-derived stage (e.g. on completion or error). */
  forcedStage?: HumanizeStage;
  lang?: "ru" | "en";
  /** Pre/post metrics from the edge function; shown on "done". */
  metrics?: HumanizeMetricsReport;
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
  metrics,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (forcedStage === "done" || forcedStage === "error") return;
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [forcedStage]);

  const elapsed = Math.max(0, now - startedAt);
  // Cap the auto-progress at 95% so the bar doesn't claim "done" before
  // the server actually returns - the final 5% is filled on completion.
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

      {forcedStage === "done" && (metrics?.pre || (metrics?.fakesFixed || 0) > 0) && metrics && (
        <MetricsDelta metrics={metrics} lang={lang} />
      )}
    </div>
  );
}

function fmt(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function deltaTone(before: number | undefined, after: number | undefined, lowerIsBetter: boolean): string {
  if (before == null || after == null) return "text-muted-foreground";
  if (before === after) return "text-muted-foreground";
  const better = lowerIsBetter ? after < before : after > before;
  return better ? "text-emerald-500" : "text-amber-500";
}

function MetricsDelta({
  metrics,
  lang,
}: {
  metrics: HumanizeMetricsReport;
  lang: "ru" | "en";
}) {
  const pre = metrics.pre || {};
  const post = metrics.postCleanup || metrics.postPass2 || metrics.postPass1 || {};
  const t = (ru: string, en: string) => (lang === "ru" ? ru : en);

  const rows: Array<{ key: string; label: string; before?: number; after?: number; lowerBetter: boolean; digits?: number; suffix?: string }> = [
    { key: "avg",   label: t("Средняя длина", "Avg length"), before: pre.avgWords,        after: post.avgWords,        lowerBetter: false, digits: 1, suffix: t(" сл.", " w") },
    { key: "short", label: t("Коротких",     "Short %"),     before: pre.shortRatio != null ? Math.round(pre.shortRatio * 100) : undefined, after: post.shortRatio != null ? Math.round(post.shortRatio * 100) : undefined, lowerBetter: true, suffix: "%" },
    { key: "chain", label: t("Цепочки союзов","Chains"),     before: pre.chainViolations, after: post.chainViolations, lowerBetter: true },
    { key: "ban",   label: t("Запрещ. слова", "Banlist"),    before: pre.banlistHits,     after: post.banlistHits,     lowerBetter: true },
    { key: "open",  label: t("Повторы зачинов","Repeated openers"), before: pre.repeatedOpeners, after: post.repeatedOpeners, lowerBetter: true },
    { key: "ngram", label: t("Повторы фраз",  "Repeated phrases"),  before: pre.repeatedNgrams,  after: post.repeatedNgrams,  lowerBetter: true },
  ];

  // Drop rows where both sides are zero - keeps the panel tight.
  const visible = rows.filter((r) => (r.before || 0) + (r.after || 0) > 0);
  const fakes = metrics.fakesFixed || 0;
  if (!visible.length && !fakes) return null;

  return (
    <div className="mt-3 pt-2 border-t border-border space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {t("Качество до → после", "Quality before → after")}
      </div>
      {visible.map((r) => (
        <div key={r.key} className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">{r.label}</span>
          <span className="tabular-nums">
            <span className="text-muted-foreground">{fmt(r.before, r.digits ?? 0)}{r.suffix || ""}</span>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className={cn("font-medium", deltaTone(r.before, r.after, r.lowerBetter))}>
              {fmt(r.after, r.digits ?? 0)}{r.suffix || ""}
            </span>
          </span>
        </div>
      ))}
      {fakes > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">{t("Фейк-нейтрализации", "Fake fixes")}</span>
          <span className="tabular-nums font-medium text-emerald-500">{fakes}</span>
        </div>
      )}
    </div>
  );
}