import { useMemo, useRef, useState, useCallback } from "react";
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
import { ExternalLink, Lock as LockIcon, EyeOff, Eye, Check, Undo2, FileText, Download, CheckCircle2 } from "lucide-react";
import {
  type FactFinding,
  type Severity,
  confidenceOf,
  typeLabelRu,
  severityOrder,
  isInstructionFix,
} from "./utils";
import {
  type HlKind,
  type IndexedFinding,
  buildExportHtml,
  buildHighlightedHtml,
  classify,
} from "./proofread";

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

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconOf(url: string): string {
  const d = domainOf(url);
  return `https://www.google.com/s2/favicons?domain=${d}&sz=32`;
}

function SourceList({ sources }: { sources?: Array<{ title: string; url: string }> }) {
  if (!sources || sources.length === 0) {
    return <p className="text-[11px] text-muted-foreground italic">Источники не сохранились</p>;
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Источники проверки
      </div>
      <ul className="space-y-1">
        {sources.map((s, i) => {
          const d = domainOf(s.url);
          return (
            <li key={i} className="flex items-center gap-1.5 text-[11px] min-w-0">
              <img
                src={faviconOf(s.url)}
                alt=""
                width={14}
                height={14}
                className="shrink-0 rounded-sm"
                loading="lazy"
              />
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate"
              >
                {s.title || d}
              </a>
              <span className="text-muted-foreground shrink-0">· {d}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BasisLine({ sources }: { sources?: Array<{ title: string; url: string }> }) {
  const first = sources && sources[0];
  if (!first) return null;
  const d = domainOf(first.url);
  return (
    <div className="text-[10px] text-muted-foreground">
      Основание:{" "}
      <a
        href={first.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
      >
        {d}
      </a>
    </div>
  );
}

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
  content: string;
  appliedPatches: Array<{ old_fragment: string; new_fragment: string }>;
  articleTitle?: string;
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
  content,
  appliedPatches,
  articleTitle,
}: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [proofread, setProofread] = useState(false);
  const [verifiedManually, setVerifiedManually] = useState<Set<string>>(new Set());
  const previewRef = useRef<HTMLDivElement | null>(null);

  const appliedNewByQuote = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of appliedPatches) m.set(p.old_fragment, p.new_fragment);
    return m;
  }, [appliedPatches]);

  const indexed = useMemo<IndexedFinding[]>(() => {
    return findings.map((f, i) => {
      const applied = appliedQuotes.has(f.quote);
      const newFrag = appliedNewByQuote.get(f.quote) ?? null;
      const { kind, needle } = classify(f, applied, newFrag);
      return { finding: f, idx: i, kind, needle };
    });
  }, [findings, appliedQuotes, appliedNewByQuote]);

  const yellowFindings = useMemo(
    () => indexed.filter((it) => it.kind === "yellow"),
    [indexed],
  );
  const remainingManual = yellowFindings.filter(
    (it) => !verifiedManually.has(it.finding.quote),
  ).length;

  const highlightedHtml = useMemo(
    () => (proofread ? buildHighlightedHtml(content, indexed) : ""),
    [proofread, content, indexed],
  );

  const scrollToId = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1400);
  }, []);

  const onPreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement).closest("[data-fc-idx]");
      if (!target) return;
      const idx = target.getAttribute("data-fc-idx");
      if (idx !== null) scrollToId(`fc-card-${idx}`);
    },
    [scrollToId],
  );

  const toggleVerifiedManually = (quote: string) => {
    setVerifiedManually((prev) => {
      const next = new Set(prev);
      if (next.has(quote)) next.delete(quote);
      else next.add(quote);
      return next;
    });
  };

  const kindByQuote = useMemo(() => {
    const m = new Map<string, HlKind | null>();
    for (const it of indexed) m.set(it.finding.quote, it.kind);
    return m;
  }, [indexed]);

  const idxByQuote = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of indexed) m.set(it.finding.quote, it.idx);
    return m;
  }, [indexed]);

  const exportDraft = () => {
    const html = buildExportHtml(articleTitle || "", content, indexed);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (articleTitle || "chernovik").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60);
    a.download = `${slug || "chernovik"}-proofread.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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

  const uniqueSourceDomains = useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) {
      for (const s of f.verification_sources ?? []) {
        if (s?.url) set.add(domainOf(s.url));
      }
    }
    return set.size;
  }, [findings]);

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
      {/* Proofread mode toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 text-xs">
        <Button
          size="sm"
          variant={proofread ? "default" : "outline"}
          className="gap-1.5 h-7"
          onClick={() => setProofread((v) => !v)}
        >
          <FileText className="h-3 w-3" />
          {proofread ? "Выйти из вычитки" : "Режим вычитки"}
        </Button>
        {proofread && (
          <>
            <span className="text-muted-foreground">
              Осталось проверить вручную:{" "}
              <span className="font-mono font-semibold text-amber-500">{remainingManual}</span>{" "}
              из{" "}
              <span className="font-mono font-semibold text-foreground">
                {yellowFindings.length}
              </span>{" "}
              мест
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <LegendSwatch className="bg-amber-200" label="проверить" />
              <LegendSwatch className="bg-rose-200" label="опровергнуто" />
              <LegendSwatch className="bg-emerald-200" label="исправлено" />
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 h-7" onClick={exportDraft}>
              <Download className="h-3 w-3" />
              Экспорт для вычитки
            </Button>
          </>
        )}
      </div>

      {proofread && (
        <div className="rounded-md border border-border bg-background p-4">
          <style>{`
            .fc-hl{border-radius:3px; padding:0 2px; cursor:pointer;}
            .fc-hl-yellow{background:rgba(251,191,36,0.35);}
            .fc-hl-red{background:rgba(244,63,94,0.30);}
            .fc-hl-green{background:rgba(16,185,129,0.28);}
          `}</style>
          <div
            ref={previewRef}
            onClick={onPreviewClick}
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </div>
      )}

      {/* Progress summary */}
      <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
        Применимо исправлений:{" "}
        <span className="font-mono font-semibold text-foreground">{applicableTotal}</span>, применено:{" "}
        <span className="font-mono font-semibold text-emerald-500">{appliedTotal}</span>, отклонено:{" "}
        <span className="font-mono font-semibold text-foreground">{rejectedTotal}</span>. Источников
        проверено:{" "}
        <span className="font-mono font-semibold text-foreground">{uniqueSourceDomains}</span>.
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
                    cardId={`fc-card-${idxByQuote.get(f.quote) ?? -1}`}
                    onLocate={() => {
                      const id = idxByQuote.get(f.quote);
                      if (id !== undefined && proofread) scrollToId(`fc-hl-${id}`);
                    }}
                    proofreadOn={proofread}
                    proofreadKind={kindByQuote.get(f.quote) ?? null}
                    manuallyVerified={verifiedManually.has(f.quote)}
                    onToggleManualVerified={() => toggleVerifiedManually(f.quote)}
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
                cardId={`fc-card-${idxByQuote.get(f.quote) ?? -1}`}
                onLocate={() => {
                  const id = idxByQuote.get(f.quote);
                  if (id !== undefined && proofread) scrollToId(`fc-hl-${id}`);
                }}
                proofreadOn={proofread}
                proofreadKind={kindByQuote.get(f.quote) ?? null}
                manuallyVerified={verifiedManually.has(f.quote)}
                onToggleManualVerified={() => toggleVerifiedManually(f.quote)}
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
                      <BasisLine sources={f.verification_sources} />
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

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={`inline-block h-3 w-4 rounded-sm ${className}`} />
      {label}
    </span>
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
  cardId,
  onLocate,
  proofreadOn,
  proofreadKind,
  manuallyVerified,
  onToggleManualVerified,
}: {
  finding: FactFinding;
  onApply: (f: FactFinding) => void;
  onUndo: (f: FactFinding) => void;
  onToggleDismiss: (quote: string) => void;
  isApplied: boolean;
  isDismissed: boolean;
  applying: boolean;
  cardId: string;
  onLocate: () => void;
  proofreadOn: boolean;
  proofreadKind: HlKind | null;
  manuallyVerified: boolean;
  onToggleManualVerified: () => void;
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
      <div id={cardId} className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-1.5 text-xs">
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
    <div
      id={cardId}
      className={`${cardClass} ${proofreadOn ? "cursor-pointer" : ""} transition-shadow`}
      onClick={proofreadOn ? onLocate : undefined}
    >
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
          {manuallyVerified && (
            <Badge className="text-[10px] h-4 px-1.5 bg-primary/15 text-primary border-primary/30 hover:bg-primary/15">
              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
              Проверено вручную
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
          <BasisLine sources={finding.verification_sources} />
        </div>
      )}
      {finding.verdict && (
        <p className="text-xs text-foreground">{finding.verdict}</p>
      )}
      {finding.verification_summary && (
        <p className="text-[11px] text-muted-foreground">{finding.verification_summary}</p>
      )}
      {finding.verification && (
        <SourceList sources={finding.verification_sources} />
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
        <div
          className="flex items-center justify-between gap-2 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
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
      {/* "Проверено" for yellow (manual review) findings */}
      {proofreadKind === "yellow" && !isApplied && (
        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant={manuallyVerified ? "secondary" : "outline"}
            className="gap-1.5 h-7 text-xs"
            onClick={onToggleManualVerified}
          >
            <CheckCircle2 className="h-3 w-3" />
            {manuallyVerified ? "Снять отметку" : "Проверено"}
          </Button>
        </div>
      )}
    </div>
  );
}