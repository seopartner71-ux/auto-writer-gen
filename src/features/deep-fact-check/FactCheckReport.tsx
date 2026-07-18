import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Lock as LockIcon } from "lucide-react";
import {
  type FactFinding,
  type Severity,
  confidenceOf,
  typeLabelRu,
  severityOrder,
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
  onApplyAllCritical: () => void;
  onRollbackAll: () => void;
  canRollback: boolean;
  applying: string | null;
}

export function FactCheckReport({
  findings,
  onApply,
  onApplyAllCritical,
  onRollbackAll,
  canRollback,
  applying,
}: Props) {
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

  const criticalCount = bySeverity.critical.filter((f) => f.suggested_fix && !f.needs_manual_review).length;

  return (
    <div className="space-y-4 text-sm">
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
                applying={applying === f.quote}
              />
            ))}
          </div>
        </section>
      )}

      {findings.length === 0 && (
        <p className="text-sm text-muted-foreground">Проблем не найдено. Отличная работа.</p>
      )}
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
  applying,
}: {
  finding: FactFinding;
  onApply: (f: FactFinding) => void;
  applying: boolean;
}) {
  const conf = confidenceOf(finding);
  const canApply = !!finding.suggested_fix && !finding.needs_manual_review;
  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass[conf]}`} />
          <span className="text-xs font-medium text-foreground">{typeLabelRu(finding.type)}</span>
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
      <blockquote className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic">
        «{finding.quote}»
      </blockquote>
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
      {finding.suggested_fix && (
        <div className="rounded bg-muted/40 p-2 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Предлагаемая замена
          </div>
          <div className="text-foreground">{finding.suggested_fix}</div>
        </div>
      )}
      {finding.needs_manual_review && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-500">
          <LockIcon className="h-3 w-3" />
          Фрагмент неоднозначен — исправьте вручную.
        </div>
      )}
      {canApply && (
        <div className="pt-1">
          <Button size="sm" variant="secondary" onClick={() => onApply(finding)} disabled={applying}>
            {applying ? "Применяю…" : "Применить"}
          </Button>
        </div>
      )}
    </div>
  );
}