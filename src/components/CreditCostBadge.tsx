import { Coins, Lock } from "lucide-react";
import { useCreditCost, type CostOptions } from "@/shared/hooks/useCreditCost";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props extends CostOptions {
  userPlan?: string;
  className?: string;
}

/**
 * Live preview of credit cost for a generation request.
 * Shows breakdown on hover and a lock icon if user's plan is too low.
 */
export function CreditCostBadge({ userPlan = "basic", className, ...opts }: Props) {
  const cost = useCreditCost(opts);
  const { t } = useI18n();
  if (!cost) return null;

  const locked = cost.min_plan === "pro" && userPlan === "basic";
  const b = cost.breakdown;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={locked ? "destructive" : "secondary"}
            className={`gap-1.5 cursor-help ${className ?? ""}`}
          >
            {locked ? <Lock className="h-3 w-3" /> : <Coins className="h-3 w-3" />}
            {locked ? t("cost.badgeProCredits", { n: cost.credits }) : t("cost.badgeCredits", { n: cost.credits })}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="text-xs space-y-1">
            <div className="font-semibold">{t("cost.calcTitle")}</div>
            <div>{t("cost.model")}: {b.model} × {b.length_x}</div>
            {b.stealth && <div>{t("cost.stealth")}</div>}
            {b.images > 0 && <div>{t("cost.images", { n: b.images })}</div>}
            {b.research && <div>{t("cost.research")}</div>}
            {b.fact_check && <div>{t("cost.factCheck")}</div>}
            <div className="pt-1 border-t border-border font-semibold">
              {t("cost.total", { n: cost.credits })}
            </div>
            {locked && (
              <div className="text-destructive pt-1">
                {t("cost.proRequired")}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}