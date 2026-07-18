import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck, Lock, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { analyzeSanity } from "@/shared/utils/contentSanity";
import { FactCheckReport } from "./FactCheckReport";
import {
  type FactFinding,
  computeFactScore,
  countOccurrences,
  dedupeFindings,
  detectYmyl,
} from "./utils";

interface Props {
  articleId: string | null;
  content: string;
  onContentChanged: (next: string) => void;
}

interface FcRow {
  id: string;
  status: string;
  fact_score: number | null;
  cost_usd: number | null;
  layer1_findings: FactFinding[];
  critic_findings: FactFinding[];
  factcheck_findings: FactFinding[];
}

const PRO_PLANS = new Set(["pro", "factory"]);

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-500";
  if (score >= 30) return "text-amber-500";
  return "text-rose-500";
}

export function DeepFactCheckPanel({ articleId, content, onContentChanged }: Props) {
  const { profile, role } = useAuth();
  const plan = String(profile?.plan ?? "").toLowerCase();
  const hasAccess = role === "admin" || PRO_PLANS.has(plan);

  const [row, setRow] = useState<FcRow | null>(null);
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [hasSnapshot, setHasSnapshot] = useState(false);

  const ymyl = useMemo(() => detectYmyl(content), [content]);

  const loadLatest = useCallback(async (aid: string) => {
    const { data } = await supabase
      .from("fact_checks")
      .select("id, status, fact_score, cost_usd, layer1_findings, critic_findings, factcheck_findings")
      .eq("article_id", aid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      setRow(null);
      setAppliedCount(0);
      setHasSnapshot(false);
      return;
    }
    setRow({
      id: data.id as string,
      status: String(data.status || ""),
      fact_score: data.fact_score,
      cost_usd: data.cost_usd,
      layer1_findings: (data.layer1_findings as unknown as FactFinding[]) ?? [],
      critic_findings: (data.critic_findings as unknown as FactFinding[]) ?? [],
      factcheck_findings: (data.factcheck_findings as unknown as FactFinding[]) ?? [],
    });
    const { count: applied } = await supabase
      .from("fact_check_patches")
      .select("id", { count: "exact", head: true })
      .eq("fact_check_id", data.id as string)
      .eq("applied", true);
    setAppliedCount(applied ?? 0);
    const { data: snap } = await supabase
      .from("fact_check_patches")
      .select("id")
      .eq("fact_check_id", data.id as string)
      .not("snapshot_before", "is", null)
      .limit(1);
    setHasSnapshot((snap ?? []).length > 0);
  }, []);

  useEffect(() => {
    if (!articleId) return;
    void loadLatest(articleId);
  }, [articleId, loadLatest]);

  const dedupedFindings = useMemo<FactFinding[]>(() => {
    if (!row) return [];
    return dedupeFindings(row.layer1_findings, row.critic_findings, row.factcheck_findings);
  }, [row]);

  const clientScore = useMemo(() => {
    if (!row) return null;
    return computeFactScore(dedupedFindings);
  }, [row, dedupedFindings]);

  const totalFindings = dedupedFindings.length;
  const problems = dedupedFindings.filter((f) => f.verification !== "CONFIRMED" && f.type !== "client_slot").length;

  const runDeepCheck = useCallback(async () => {
    if (!articleId) {
      toast.error("Сначала сохраните статью");
      return;
    }
    setLoading(true);
    setVerifyProgress(null);
    try {
      const { data, error } = await supabase.functions.invoke("deep-fact-check", {
        body: { article_id: articleId },
      });
      if (error) throw error;
      const payload = data as {
        fact_check_id: string;
        status: string;
        critic_findings?: FactFinding[];
      };
      const critic = payload.critic_findings ?? [];
      const toVerify = critic.filter((f) => f.search_query && String(f.search_query).trim().length > 0);
      if (payload.status === "awaiting_verification" && toVerify.length > 0) {
        const batches: FactFinding[][] = [];
        for (let i = 0; i < toVerify.length; i += 5) batches.push(toVerify.slice(i, i + 5));
        setVerifyProgress({ done: 0, total: toVerify.length });
        for (let b = 0; b < batches.length; b++) {
          const isLast = b === batches.length - 1;
          const { error: vErr } = await supabase.functions.invoke("fact-verify", {
            body: {
              fact_check_id: payload.fact_check_id,
              findings: batches[b],
              is_last_batch: isLast,
            },
          });
          if (vErr) throw vErr;
          setVerifyProgress({
            done: Math.min(toVerify.length, (b + 1) * 5),
            total: toVerify.length,
          });
        }
      }
      await loadLatest(articleId);
      setOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Проверка не выполнена: ${msg}`);
    } finally {
      setLoading(false);
      setVerifyProgress(null);
    }
  }, [articleId, loadLatest]);

  const handleButtonClick = () => {
    if (!hasAccess) {
      setUpgradeOpen(true);
      return;
    }
    if (row && row.status === "done") {
      setOpen(true);
      return;
    }
    void runDeepCheck();
  };

  const applyFinding = useCallback(
    async (finding: FactFinding) => {
      if (!articleId || !row) return;
      if (!finding.suggested_fix) return;
      const occ = countOccurrences(content, finding.quote);
      if (occ !== 1) {
        toast.error("Фрагмент неоднозначен — исправьте вручную");
        return;
      }
      setApplying(finding.quote);
      const isFirst = !hasSnapshot;
      const snapshotBefore = isFirst ? content : null;
      try {
        const { error: insErr } = await supabase.from("fact_check_patches").insert({
          article_id: articleId,
          fact_check_id: row.id,
          old_fragment: finding.quote,
          new_fragment: finding.suggested_fix,
          snapshot_before: snapshotBefore,
          applied: true,
          applied_at: new Date().toISOString(),
        });
        if (insErr) throw insErr;
        const nextContent = content.replace(finding.quote, finding.suggested_fix);
        const sanity = analyzeSanity(nextContent);
        if (sanity.corrupted && snapshotBefore) {
          onContentChanged(snapshotBefore);
          toast.error("Правка нарушила целостность текста — откат к снапшоту");
        } else if (sanity.corrupted) {
          onContentChanged(content);
          toast.error("Правка нарушила целостность текста — правка отменена");
        } else {
          onContentChanged(nextContent);
          toast.success("Правка применена");
          if (isFirst) setHasSnapshot(true);
          setAppliedCount((n) => n + 1);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Не удалось применить: ${msg}`);
      } finally {
        setApplying(null);
      }
    },
    [articleId, content, hasSnapshot, onContentChanged, row],
  );

  const applyAllCritical = useCallback(async () => {
    const criticals = dedupedFindings.filter(
      (f) => f.severity === "critical" && f.suggested_fix && !f.needs_manual_review,
    );
    for (const f of criticals) {
      // sequential — each apply mutates content
      // eslint-disable-next-line no-await-in-loop
      await applyFinding(f);
    }
  }, [applyFinding, dedupedFindings]);

  const rollbackAll = useCallback(async () => {
    if (!row) return;
    const { data } = await supabase
      .from("fact_check_patches")
      .select("snapshot_before, applied_at")
      .eq("fact_check_id", row.id)
      .not("snapshot_before", "is", null)
      .order("applied_at", { ascending: true })
      .limit(1);
    const snapshot = (data ?? [])[0]?.snapshot_before as string | null | undefined;
    if (!snapshot) {
      toast.error("Снапшот не найден");
      return;
    }
    await supabase
      .from("fact_check_patches")
      .update({ applied: false })
      .eq("fact_check_id", row.id);
    onContentChanged(snapshot);
    setAppliedCount(0);
    toast.success("Все правки откачены");
  }, [onContentChanged, row]);

  const badgeScore = clientScore ?? row?.fact_score ?? null;

  const badge = (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {hasAccess ? (
            <button
              type="button"
              onClick={() => (row ? setOpen(true) : handleButtonClick())}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
            >
              <ShieldCheck className="h-3 w-3" />
              <span className="text-muted-foreground">Fact</span>
              <span className={`font-mono font-semibold ${scoreColor(badgeScore)}`}>
                {badgeScore ?? "—"}
              </span>
            </button>
          ) : (
            <Link
              to="/pricing"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
            >
              <Lock className="h-3 w-3" />
              <span className="text-muted-foreground">Fact Score</span>
            </Link>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {hasAccess ? (
            <>
              Проверено утверждений: {totalFindings}, найдено проблем: {problems}, исправлено: {appliedCount}.
            </>
          ) : (
            <>Fact Score доступен на PRO. Нажмите, чтобы посмотреть тарифы.</>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Глубокая проверка</span>
        {badge}
      </div>

      {ymyl && hasAccess && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-500">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Текст содержит датозависимые нормы. Рекомендуем проверку фактов перед публикацией.
          </span>
        </div>
      )}

      <Button
        size="sm"
        className="w-full h-8 text-xs gap-1.5"
        onClick={handleButtonClick}
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            {verifyProgress
              ? `Проверяем факты: ${verifyProgress.done} из ${verifyProgress.total}…`
              : "Запускаем проверку…"}
          </>
        ) : (
          <>
            <ShieldCheck className="h-3 w-3" />
            Глубокая проверка
          </>
        )}
      </Button>

      {/* Report dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Глубокая проверка</DialogTitle>
            <DialogDescription>
              Fact Score:{" "}
              <span className={`font-mono font-semibold ${scoreColor(badgeScore)}`}>
                {badgeScore ?? "—"}
              </span>
              . Проверено утверждений: {totalFindings}, найдено проблем: {problems}, исправлено: {appliedCount}.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-3">
            <FactCheckReport
              findings={dedupedFindings}
              onApply={applyFinding}
              onApplyAllCritical={applyAllCritical}
              onRollbackAll={rollbackAll}
              canRollback={hasSnapshot && appliedCount > 0}
              applying={applying}
            />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Upgrade dialog for NANO */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Глубокая проверка — PRO
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm text-foreground">
              Глубокая проверка находит устаревшие факты, выдуманные бренды и логические ошибки. Доступно в PRO.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setUpgradeOpen(false)}>
              Позже
            </Button>
            <Button asChild>
              <Link to="/pricing">Перейти к PRO</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}