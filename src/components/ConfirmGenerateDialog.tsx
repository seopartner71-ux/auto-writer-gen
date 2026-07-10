import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Coins, AlertTriangle, Sparkles } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credits: number;
  balance: number;
  modelName?: string;
  onConfirm: () => void;
}

/**
 * Confirmation dialog shown before generation when cost exceeds 20 credits
 * or 30% of user's balance. Prevents accidental burn on Opus + Stealth combos.
 */
export function ConfirmGenerateDialog({
  open, onOpenChange, credits, balance, modelName, onConfirm,
}: Props) {
  const { t } = useI18n();
  const pct = balance > 0 ? Math.round((credits / balance) * 100) : 100;
  const danger = pct >= 30;
  const remaining = Math.max(0, balance - credits);
  const barPct = Math.min(100, pct);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md overflow-hidden border-white/[0.08] bg-[#0a0a0a]/95 backdrop-blur-2xl p-0">
        {/* Premium gradient halo */}
        <div className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-gradient-to-b from-primary/20 via-primary/5 to-transparent blur-2xl" />
        <div className="pointer-events-none absolute -right-16 -bottom-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative p-7">
          <AlertDialogHeader className="space-y-4">
            {/* Icon badge */}
            <div className="flex items-center justify-between">
              <div className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border ${
                danger
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-primary/30 bg-primary/10"
              }`}>
                {danger ? (
                  <AlertTriangle className="h-6 w-6 text-amber-400" />
                ) : (
                  <Sparkles className="h-6 w-6 text-primary" />
                )}
                <span className={`absolute inset-0 rounded-2xl ${danger ? "bg-amber-500/5" : "bg-primary/5"} blur-md`} />
              </div>
              {modelName && (
                <span className="text-[10px] font-tech uppercase tracking-[0.15em] text-muted-foreground/70 border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 rounded-full">
                  {modelName}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <AlertDialogTitle className="text-xl font-bold tracking-tight">
                {t("confirmGen.title")}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
                {danger ? t("confirmGen.descHigh") : t("confirmGen.descNormal")}
              </AlertDialogDescription>
            </div>
          </AlertDialogHeader>

          {/* Cost panel */}
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.015] p-5 space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] font-tech uppercase tracking-[0.15em] text-muted-foreground/70 mb-1">
                  {t("confirmGen.toDeduct")}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <Coins className={`h-5 w-5 ${danger ? "text-amber-400" : "text-primary"}`} />
                  <span className="text-3xl font-black tracking-tight tabular-nums">{credits}</span>
                  <span className="text-sm font-tech text-muted-foreground">{t("planCard.creditsShort")}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-tech uppercase tracking-[0.15em] text-muted-foreground/70 mb-1">
                  {t("confirmGen.remaining")}
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {remaining}
                  <span className="text-xs font-tech text-muted-foreground ml-1">/ {balance}</span>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className={`h-full rounded-full transition-all ${
                    danger
                      ? "bg-gradient-to-r from-amber-500 to-amber-400"
                      : "bg-gradient-to-r from-primary to-[#3b82f6]"
                  }`}
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] font-tech">
                <span className="text-muted-foreground/70">
                  {t("confirmGen.pctOfBalance", { n: pct })}
                </span>
                {danger && (
                  <span className="text-amber-400 font-semibold uppercase tracking-wider">
                    {t("confirmGen.highSpend")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <AlertDialogFooter className="mt-6 gap-2 sm:gap-2">
            <AlertDialogCancel className="flex-1 sm:flex-initial border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] mt-0">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              className={`flex-1 font-semibold ${
                danger
                  ? "bg-gradient-to-r from-amber-600 to-amber-500 hover:shadow-[0_0_30px_rgba(245,158,11,0.4)] text-white"
                  : "bg-gradient-to-r from-primary to-[#3b82f6] hover:shadow-[0_0_30px_hsl(var(--primary)/0.4)] text-white"
              }`}
            >
              {t("confirmGen.generateFor", { n: credits })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}