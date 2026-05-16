import { Coins, Lock } from "lucide-react";
import { useCreditCost, type CostOptions } from "@/shared/hooks/useCreditCost";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

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
            {locked ? `PRO • ${cost.credits} кр` : `${cost.credits} кр`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="text-xs space-y-1">
            <div className="font-semibold">Расчёт списания</div>
            <div>Модель: {b.model} кр × {b.length_x}</div>
            {b.stealth && <div>Stealth Humanize: ×1.5</div>}
            {b.images > 0 && <div>Картинки: +{b.images}</div>}
            {b.research && <div>Deep Research: +1</div>}
            {b.fact_check && <div>Fact-Check: +1</div>}
            <div className="pt-1 border-t border-border font-semibold">
              Итого: {cost.credits} кредитов
            </div>
            {locked && (
              <div className="text-destructive pt-1">
                Требуется тариф PRO или выше
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}