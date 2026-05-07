import { Search, ListOrdered, PenLine, Shield, CheckCircle2, Loader2 } from "lucide-react";

type StageKey = "research" | "outline" | "writing" | "stealth" | "quality";

interface Props {
  /** Current phase from the stream lifecycle. */
  phase: "thinking" | "writing" | null;
  language?: "ru" | "en";
}

const STAGE_LABELS: Record<"ru" | "en", Record<StageKey, string>> = {
  ru: {
    research: "Анализ",
    outline: "План",
    writing: "Написание",
    stealth: "Маскировка",
    quality: "Проверка",
  },
  en: {
    research: "Research",
    outline: "Outline",
    writing: "Writing",
    stealth: "Stealth",
    quality: "Quality",
  },
};

const STAGE_ICONS: Record<StageKey, React.ComponentType<{ className?: string }>> = {
  research: Search,
  outline: ListOrdered,
  writing: PenLine,
  stealth: Shield,
  quality: CheckCircle2,
};

/**
 * Visualises the article-generation pipeline as a 5-stage track.
 * The current stage pulses, completed stages stay green, upcoming stages are muted.
 * Stages are derived from the SSE stream phase:
 *   thinking -> Research + Outline are active (pre-stream prep on the server)
 *   writing  -> Research/Outline done, Writing is active
 *   null     -> not generating
 * Stealth & Quality run after generation as separate user-triggered passes,
 * so they remain "upcoming" during the stream itself.
 */
export function GenerationStageProgress({ phase, language = "ru" }: Props) {
  const stages: StageKey[] = ["research", "outline", "writing", "stealth", "quality"];

  function statusFor(stage: StageKey): "done" | "active" | "upcoming" {
    if (phase === "thinking") {
      if (stage === "research" || stage === "outline") return "active";
      return "upcoming";
    }
    if (phase === "writing") {
      if (stage === "research" || stage === "outline") return "done";
      if (stage === "writing") return "active";
      return "upcoming";
    }
    return "upcoming";
  }

  return (
    <div className="mt-3 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] via-fuchsia-500/[0.04] to-blue-500/[0.06] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="bg-gradient-to-r from-primary via-fuchsia-400 to-blue-400 bg-clip-text text-[10px] font-bold uppercase tracking-[0.14em] text-transparent">
          {language === "ru" ? "Этапы генерации" : "Generation stages"}
        </span>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
        {stages.map((stage, i) => {
          const status = statusFor(stage);
          const Icon = STAGE_ICONS[stage];
          const label = STAGE_LABELS[language][stage];
          const base = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all whitespace-nowrap";
          const cls =
            status === "done"
              ? "border-success/40 bg-success/10 text-success"
              : status === "active"
              ? "border-primary/50 bg-primary/15 text-primary motion-safe:animate-pulse"
              : "border-border/60 bg-muted/20 text-muted-foreground/70";
          return (
            <div key={stage} className="flex items-center gap-1.5 shrink-0">
              <div className={`${base} ${cls}`}>
                {status === "active" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
                <span>{label}</span>
                {status === "done" && <CheckCircle2 className="h-3 w-3 ml-0.5" />}
              </div>
              {i < stages.length - 1 && (
                <div
                  className={`h-px w-3 shrink-0 ${
                    status === "done" ? "bg-success/40" : "bg-border/50"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}