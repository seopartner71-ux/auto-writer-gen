import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Lock as LockIcon, EyeOff, Eye, Check, Undo2 } from "lucide-react";
import {
  type FactFinding,
  type Severity,
  confidenceOf,
  typeLabelRu,
  severityOrder,
  isInstructionFix,
} from "./utils";

const dotClass: Record<ReturnType<typeof confidenceOf>, string> = {
  green: "bg-emerald-500",
  red: "bg-rose-500",
  orange: "bg-orange-500",
  yellow: "bg-amber-400",
};

const severityLabel: Record<Severity, string> = {
  critical: "Критично",
  major: "Важно",
  minor: "Косметика",
};

interface Props {
  findings: FactFinding[];
  onApply: (finding: FactFinding) => void;
  onUndoOne: (finding: FactFinding) => void;
  appliedQuotes: Set<string>;
  onApplyAllCritical: () => void;
  onApplyBatch: (findings: FactFinding[]) => Promise<void> | void;
  onRollbackAll: () => void;
  canRollback: boolean;
  applying: string | null;
}

export function FactCheckReport({
  findings,
  onApply,
  onUndoOne,
  appliedQuotes,
  onApplyAllCritical,
  onApplyBatch,
  onRollbackAll,
  canRollback,
  applying,
}: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);

  const toggleDismiss = (quote: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      if (next.has(quote)) next.delete(quote);
      else next.add(quote);
      return next;
    });
  };

  const isApplicable = (f: FactFinding) =>
    !!f.suggested_fix &&
    !f.needs_manual_review &&
    f.type !== "client_slot" &&
    !isInstructionFix(f.suggested_fix);

  const { clientSlot, bySeverity } = useMemo(() => {
    const cs: FactFinding[] = [];
    const buckets: Record<Severity, FactFinding[]> = { critical: [], major: [], minor: [] };
    for (const f of findings) {
      if (f.type === "client_slot") {
        cs.push(f);
        continue;
      }
      (buckets[f.severity] ?? buckets.minor).push(f);
    }
    return { clientSlot: cs, bySeverity: buckets };
  }, [findings]);

  const criticalCount = bySeverity.critical.filter(
    (f) => isApplicable(f) && !appliedQuotes.has(f.quote) && !dismissed.has(f.quote),
  ).length;

  const applicableTotal = findings.filter(isApplicable).length;
  const appliedTotal = findings.filter((f) => isApplicable(f) && appliedQuotes.has(f.quote)).length;
  const rejectedTotal = findings.filter(
    (f) => isApplicable(f) && dismissed.has(f.quote) && !appliedQuotes.has(f.quote),
  ).length;

  const pendingApplicable = useMemo(
    () => findings.filter((f) => isApplicable(f) && !appliedQuotes.has(f.quote)),
    [findings, appliedQuotes],
  );

  const openPreview = () => {
    setSelected(new Set(pendingApplicable.map((f) => f.quote)));
    setPreviewOpen(true);
  };

  const toggleSelected = (quote: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(quote)) next.delete(quote);
      else next.add(quote);
      return next;
    });
  };

  const runBatch = async () => {
    const toApply = pendingApplicable.filter((f) => selected.has(f.quote));
    if (toApply.length === 0) return;
    setBatchRunning(true);
    try {
      await onApplyBatch(toApply);
    } finally {
      setBatchRunning(false);
      setPreviewOpen(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {/* Progress summary */}
      <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
        Применимо исправлений:{" "}
        <span className="font-mono font-semibold text-foreground">{applicableTotal}</span>, применено:{" "}
        <span className="font-mono font-semibold text-emerald-500">{appliedTotal}</span>, отклонено:{" "}
        <span className="font-mono font-semibold text-foreground">{rejectedTotal}</span>.
      </div>

      {/* Legend */}
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
        <div className="font-semibold text-foreground">Легенда индикаторов</div>
        <div className="grid grid-cols-2 gap-y-1 gap-x-4">
          <LegendRow color="green" text="Подтверждено источниками" />
          <LegendRow color="red" text="Опровергнуто или выдумано" />
          <LegendRow color="orange" text="Не удалось проверить" />
          <LegendRow color="yellow" text="Требует внимания" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={openPreview}
          disabled={pendingApplicable.length === 0 || applying !== null || batchRunning}
        >
          Применить все ({pendingApplicable.length})
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onApplyAllCritical}
          disabled={criticalCount === 0 || applying !== null}
        >
          Применить все критичные ({criticalCount})
        </Button>
        <Button size="sm" variant="outline" onClick={onRollbackAll} disabled={!canRollback}>
          Откатить все правки
        </Button>
      </div>

      <Separator />

      {(["critical", "major", "minor"] as Severity[])
        .filter((sev) => bySeverity[sev].length > 0)
        .map((sev) => (
          <section key={sev} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">
              {severityLabel[sev]}{" "}
              <span className="text-muted-foreground font-normal">({bySeverity[sev].length})</span>
            </h3>
            <div className="space-y-2">
              {bySeverity[sev]
                .slice()
                .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
                .map((f, i) => (
                  <FindingCard
                    key={`${sev}-${i}`}
                    finding={f}
                    onApply={onApply}
                    onUndo={onUndoOne}
                    onToggleDismiss={toggleDismiss}
                    isApplied={appliedQuotes.has(f.quote)}
                    isDismissed={dismissed.has(f.quote)}
                    applying={applying === f.quote}
                  />
                ))}
            </div>
          </section>
        ))}

      {clientSlot.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Данные клиента</h3>
          <div className="space-y-2">
            {clientSlot.map((f, i) => (
              <FindingCard
                key={`cs-${i}`}
                finding={f}
                onApply={onApply}
                onUndo={onUndoOne}
                onToggleDismiss={toggleDismiss}
                isApplied={appliedQuotes.has(f.quote)}
                isDismissed={dismissed.has(f.quote)}
                applying={applying === f.quote}
              />
            ))}
          </div>
        </section>
      )}

      {findings.length === 0 && (
        <p className="text-sm text-muted-foreground">Проблем не найдено. Отличная работа.</p>
      )}

      <Dialog open={previewOpen} onOpenChange={(o) => !batchRunning && setPreviewOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Предпросмотр замен</DialogTitle>
            <DialogDescription>
              Отметьте исправления, которые нужно применить. По умолчанию выбраны все.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-2">
              {pendingApplicable.map((f, i) => {
                const checked = selected.has(f.quote);
                return (
                  <label
                    key={`prev-${i}`}
                    className="flex items-start gap-2 rounded-md border border-border bg-card p-2 text-xs cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSelected(f.quote)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {typeLabelRu(f.type)}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                          Было
                        </span>
                        <span className="line-through text-rose-500/90 italic break-words">
                          «{f.quote}»
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                          Станет
                        </span>
                        <span className="text-emerald-500 font-medium break-words">
                          «{f.suggested_fix}»
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
              {pendingApplicable.length === 0 && (
                <p className="text-sm text-muted-foreground">Нет применимых исправлений.</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPreviewOpen(false)}
              disabled={batchRunning}
            >
              Отмена
            </Button>
            <Button onClick={runBatch} disabled={batchRunning || selected.size === 0}>
              {batchRunning ? "Применяю…" : `Применить выбранные (${selected.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LegendRow({ color, text }: { color: keyof typeof dotClass; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dotClass[color]}`} />
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}

function FindingCard({
  finding,
  onApply,
  onUndo,
  onToggleDismiss,
  isApplied,
  isDismissed,
  applying,
}: {
  finding: FactFinding;
  onApply: (f: FactFinding) => void;
  onUndo: (f: FactFinding) => void;
  onToggleDismiss: (quote: string) => void;
  isApplied: boolean;
  isDismissed: boolean;
  applying: boolean;
}) {
  const conf = confidenceOf(finding);
  const instructionFix = isInstructionFix(finding.suggested_fix);
  const isApplicable =
    !!finding.suggested_fix &&
    !finding.needs_manual_review &&
    finding.type !== "client_slot" &&
    !instructionFix;

  // State 4: dismissed & collapsed — one-line summary
  if (isApplicable && isDismissed && !isApplied) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            Отклонено
          </Badge>
          <span className="truncate text-muted-foreground italic">«{finding.quote}»</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs gap-1"
          onClick={() => onToggleDismiss(finding.quote)}
        >
          <Eye className="h-3 w-3" />
          Развернуть
        </Button>
      </div>
    );
  }

  const cardClass = isApplied
    ? "rounded-md border border-border border-l-4 border-l-emerald-500 bg-card p-3 space-y-2"
    : "rounded-md border border-border bg-card p-3 space-y-2";

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass[conf]}`} />
          <span className="text-xs font-medium text-foreground">{typeLabelRu(finding.type)}</span>
          {isApplied && (
            <Badge className="text-[10px] h-4 px-1.5 bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/15">
              <Check className="h-2.5 w-2.5 mr-0.5" />
              Исправлено
            </Badge>
          )}
          {finding.duplicated && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              подтверждено двумя проверками
            </Badge>
          )}
          {finding.verification && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
              {finding.verification}
            </Badge>
          )}
        </div>
      </div>
      {!isApplicable || !finding.suggested_fix ? (
        <blockquote className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic">
          «{finding.quote}»
        </blockquote>
      ) : (
        <div className="rounded border border-border/60 bg-muted/20 p-2 text-xs space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
              Было
            </span>
            <span className="line-through text-rose-500/90 italic">«{finding.quote}»</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
              Станет
            </span>
            <span className="text-emerald-500 font-medium">«{finding.suggested_fix}»</span>
          </div>
        </div>
      )}
      {finding.verdict && (
        <p className="text-xs text-foreground">{finding.verdict}</p>
      )}
      {finding.verification_summary && (
        <p className="text-[11px] text-muted-foreground">{finding.verification_summary}</p>
      )}
      {finding.source_url && (
        <a
          href={finding.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Источник <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {/* State 3: informational badge for non-applicable */}
      {!isApplicable && (
        <div className="pt-1">
          <Badge variant="secondary" className="text-[10px] gap-1">
            <LockIcon className="h-3 w-3" />
            {finding.type === "client_slot"
              ? "Требуются данные клиента"
              : instructionFix
                ? "Рекомендация — исправьте вручную"
                : finding.needs_manual_review
                  ? "Фрагмент неоднозначен"
                  : "Проверьте вручную"}
          </Badge>
        </div>
      )}
      {/* Action row for applicable findings */}
      {isApplicable && (
        <div className="flex items-center justify-between gap-2 pt-1">
          {isApplied ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onUndo(finding)}
              disabled={applying}
            >
              <Undo2 className="h-3 w-3" />
              {applying ? "Отменяю…" : "Отменить это исправление"}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => onApply(finding)}
                disabled={applying}
              >
                <Check className="h-3 w-3" />
                {applying ? "Применяю…" : "Применить исправление"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground"
                onClick={() => onToggleDismiss(finding.quote)}
                title="Скрыть находку"
              >
                <EyeOff className="h-3 w-3" />
                Скрыть
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}