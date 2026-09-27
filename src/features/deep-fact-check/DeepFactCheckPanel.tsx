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
import { useI18n } from "@/shared/hooks/useI18n";
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

export interface FcPatch {
  id: string;
  old_fragment: string;
  new_fragment: string;
  applied: boolean;
}

// "basic" is the DB id of the PRO tier (legacy name from subscription_plans).
// "pro" is the DB id of the FACTORY tier. Both are paid.
const PRO_PLANS = new Set(["basic", "pro", "factory", "business", "advanced"]);

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-500";
  if (score >= 30) return "text-amber-500";
  return "text-rose-500";
}

export function DeepFactCheckPanel({ articleId, content, onContentChanged }: Props) {
  const { profile, role } = useAuth();
  const { t } = useI18n();
  const plan = String(profile?.plan ?? "").toLowerCase();
  const hasAccess = role === "admin" || PRO_PLANS.has(plan);

  if (typeof window !== "undefined") {
    // Diagnostic — helps catch future tier-name regressions in the wild.
    console.log("[TIER-CHECK][deep-fact-check]", {
      email: profile?.email,
      rawPlan: profile?.plan,
      normalized: plan,
      role,
      hasAccess,
    });
  }

  const [row, setRow] = useState<FcRow | null>(null);
  const [open, setOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [patches, setPatches] = useState<FcPatch[]>([]);

  const appliedCount = useMemo(() => patches.filter((p) => p.applied).length, [patches]);

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
      setPatches([]);
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
    const { data: patchRows } = await supabase
      .from("fact_check_patches")
      .select("id, old_fragment, new_fragment, applied")
      .eq("fact_check_id", data.id as string)
      .order("applied_at", { ascending: true });
    setPatches((patchRows ?? []) as FcPatch[]);
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
      toast.error(t("dfc.saveFirst"));
      return;
    }
    setLoading(true);
    setVerifyProgress(null);
    const startedAt = new Date(Date.now() - 5000).toISOString();

    // Проверка идёт 60-120 секунд, и соединение до Edge Function иногда рвётся
    // раньше, чем приходит ответ (при этом на сервере результат уже пишется в
    // fact_checks). Поэтому при ошибке сети опрашиваем таблицу до 4 минут.
    const pollResult = async (): Promise<{
      fact_check_id: string;
      status: string;
      critic_findings: FactFinding[];
    } | null> => {
      const deadline = Date.now() + 4 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        const { data } = await supabase
          .from("fact_checks")
          .select("id, status, critic_findings, created_at")
          .eq("article_id", articleId)
          .gte("created_at", startedAt)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data) continue;
        const status = String(data.status || "");
        if (status === "failed") return null;
        if (status === "done" || status === "awaiting_verification") {
          return {
            fact_check_id: data.id as string,
            status,
            critic_findings: (data.critic_findings as unknown as FactFinding[]) ?? [],
          };
        }
      }
      return null;
    };

    try {
      // Клиентский таймаут 150с: если ответ потерян, сервер всё равно пишет
      // результат в fact_checks - забираем его опросом, а не висим вечно.
      let data: any = null;
      let error: any = null;
      try {
        const res = await Promise.race([
          supabase.functions.invoke("deep-fact-check", { body: { article_id: articleId } }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("invoke_timeout")), 150_000)),
        ]);
        data = res.data;
        error = res.error;
      } catch (raceErr) {
        if (raceErr instanceof Error && raceErr.message === "invoke_timeout") {
          const polled = await pollResult();
          if (polled) {
            data = polled;
          } else {
            toast.error(t("dfc.timeout"));
            return;
          }
        } else {
          throw raceErr;
        }
      }
      let payload: {
        fact_check_id: string;
        status: string;
        critic_findings?: FactFinding[];
      } | null = null;
      if (error) {
        // Пытаемся достать тело ответа (429 quota_exceeded, 403 plan_required и т.п.)
        let errBody: any = null;
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") errBody = await ctx.json();
          else if (ctx && typeof ctx.text === "function") {
            const t = await ctx.text();
            try { errBody = JSON.parse(t); } catch { errBody = { error: t }; }
          }
        } catch { /* ignore */ }
        if (errBody?.error === "quota_exceeded") {
          toast.error(t("dfc.quotaExceeded", { used: errBody.used, quota: errBody.quota }));
          return;
        }
        if (errBody?.error === "plan_required") {
          setUpgradeOpen(true);
          return;
        }
        if (errBody?.error && errBody.error !== "context canceled" && !/non-2xx|timeout|wall|546|504|502/i.test(String(errBody.error))) {
          toast.error(t("dfc.failed", { msg: errBody.error }));
          return;
        }
        // Ответ потерян - ждём результат из базы.
        payload = await pollResult();
        if (!payload) throw error;
      } else {
        payload = data as typeof payload;
      }
      if (!payload) throw new Error("empty_response");
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
          // Сбой веб-проверки части фактов не должен ронять весь результат.
          if (vErr) console.warn("[dfc] fact-verify batch failed", vErr);
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
      toast.error(t("dfc.failed", { msg }));
    } finally {
      setLoading(false);
      setVerifyProgress(null);
    }
  }, [articleId, loadLatest, t]);

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
        toast.error(t("dfc.applyAmbiguous"));
        return;
      }
      setApplying(finding.quote);
      const isFirst = !hasSnapshot;
      const snapshotBefore = isFirst ? content : null;
      try {
        const { data: inserted, error: insErr } = await supabase
          .from("fact_check_patches")
          .insert({
            article_id: articleId,
            fact_check_id: row.id,
            old_fragment: finding.quote,
            new_fragment: finding.suggested_fix,
            snapshot_before: snapshotBefore,
            applied: true,
            applied_at: new Date().toISOString(),
          })
          .select("id, old_fragment, new_fragment, applied")
          .single();
        if (insErr) throw insErr;
        const nextContent = content.replace(finding.quote, finding.suggested_fix);
        const sanity = analyzeSanity(nextContent);
        if (sanity.corrupted && snapshotBefore) {
          onContentChanged(snapshotBefore);
          toast.error(t("dfc.applyCorruptedSnapshot"));
        } else if (sanity.corrupted) {
          onContentChanged(content);
          toast.error(t("dfc.applyCorruptedCancel"));
        } else {
          onContentChanged(nextContent);
          toast.success(t("dfc.applied"));
          if (isFirst) setHasSnapshot(true);
          if (inserted) setPatches((prev) => [...prev, inserted as FcPatch]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("dfc.applyFailed", { msg }));
      } finally {
        setApplying(null);
      }
    },
    [articleId, content, hasSnapshot, onContentChanged, row, t],
  );

  const undoOne = useCallback(
    async (finding: FactFinding) => {
      const patch = patches.find(
        (p) => p.applied && p.old_fragment === finding.quote,
      );
      if (!patch) {
        toast.error(t("dfc.patchNotFound"));
        return;
      }
      const occ = countOccurrences(content, patch.new_fragment);
      if (occ !== 1) {
        toast.error(t("dfc.undoAmbiguous"));
        return;
      }
      setApplying(finding.quote);
      try {
        const { error } = await supabase
          .from("fact_check_patches")
          .update({ applied: false })
          .eq("id", patch.id);
        if (error) throw error;
        const nextContent = content.replace(patch.new_fragment, patch.old_fragment);
        const sanity = analyzeSanity(nextContent);
        if (sanity.corrupted) {
          onContentChanged(content);
          toast.error(t("dfc.undoCorrupted"));
          return;
        }
        onContentChanged(nextContent);
        setPatches((prev) =>
          prev.map((p) => (p.id === patch.id ? { ...p, applied: false } : p)),
        );
        toast.success(t("dfc.undone"));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t("dfc.undoFailed", { msg }));
      } finally {
        setApplying(null);
      }
    },
    [content, onContentChanged, patches, t],
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

  const applyBatch = useCallback(
    async (findings: FactFinding[]) => {
      for (const f of findings) {
        // eslint-disable-next-line no-await-in-loop
        await applyFinding(f);
      }
    },
    [applyFinding],
  );

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
      toast.error(t("dfc.snapshotNotFound"));
      return;
    }
    await supabase
      .from("fact_check_patches")
      .update({ applied: false })
      .eq("fact_check_id", row.id);
    onContentChanged(snapshot);
    setPatches((prev) => prev.map((p) => ({ ...p, applied: false })));
    toast.success(t("dfc.rolledBack"));
  }, [onContentChanged, row, t]);

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
              {t("dfc.tooltipStats", { total: totalFindings, problems, applied: appliedCount })}
            </>
          ) : (
            <>{t("dfc.tooltipPro")}</>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{t("dfc.title")}</span>
        {badge}
      </div>

      {ymyl && hasAccess && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-500">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            {t("dfc.ymyl")}
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
              ? t("dfc.verifying", { done: verifyProgress.done, total: verifyProgress.total })
              : t("dfc.starting")}
          </>
        ) : (
          <>
            <ShieldCheck className="h-3 w-3" />
            {t("dfc.title")}
          </>
        )}
      </Button>

      {/* Report dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("dfc.title")}</DialogTitle>
            <DialogDescription>
              Fact Score:{" "}
              <span className={`font-mono font-semibold ${scoreColor(badgeScore)}`}>
                {badgeScore ?? "—"}
              </span>
              . {t("dfc.reportDesc", { total: totalFindings, problems, applied: appliedCount })}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[65vh] pr-3">
            <FactCheckReport
              findings={dedupedFindings}
              onApply={applyFinding}
              onUndoOne={undoOne}
              appliedQuotes={new Set(patches.filter((p) => p.applied).map((p) => p.old_fragment))}
              onApplyAllCritical={applyAllCritical}
              onApplyBatch={applyBatch}
              onRollbackAll={rollbackAll}
              canRollback={hasSnapshot && appliedCount > 0}
              applying={applying}
              content={content}
              appliedPatches={patches
                .filter((p) => p.applied)
                .map((p) => ({ old_fragment: p.old_fragment, new_fragment: p.new_fragment }))}
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
              {t("dfc.upgradeTitle")}
            </DialogTitle>
            <DialogDescription className="pt-2 text-sm text-foreground">
              {t("dfc.upgradeDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setUpgradeOpen(false)}>
              {t("dfc.later")}
            </Button>
            <Button asChild>
              <Link to="/pricing">{t("dfc.goPro")}</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}