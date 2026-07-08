import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Coins, Sparkles, Info, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

const PLAN_LABEL: Record<string, string> = { free: "NANO", basic: "PRO", pro: "FACTORY" };
const PLAN_RANK: Record<string, number> = { free: 0, basic: 1, pro: 2 };

export function PlanModelCard() {
  const { profile, role } = useAuth();
  const { lang } = useI18n();
  const isAdmin = role === "admin";
  const plan = (profile?.plan ?? "free") as string;
  const credits = profile?.credits_amount ?? 0;

  const [modelKey, setModelKey] = useState<string>(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("writer_model") || "google/gemini-2.5-flash"
      : "google/gemini-2.5-flash"
  );
  useEffect(() => {
    const h = (e: any) => setModelKey(e?.detail || localStorage.getItem("writer_model") || modelKey);
    window.addEventListener("writer-model-changed", h);
    return () => window.removeEventListener("writer-model-changed", h);
  }, [modelKey]);

  const { data: models = [] } = useQuery({
    queryKey: ["ai-models-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_models")
        .select("model_key, display_name, credit_cost, min_plan, tier")
        .eq("is_active", true)
        .order("credit_cost");
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const current = (models as any[]).find((m) => m.model_key === modelKey) || (models as any[])[0];
  if (!current) {
    return (
      <div className="px-4 py-3 border-t border-sidebar-border text-xs text-muted-foreground">
        {lang === "ru" ? "Загрузка..." : "Loading..."}
      </div>
    );
  }

  const cost = Number(current.credit_cost) || 1;
  const userRank = PLAN_RANK[plan] ?? 0;
  const required = PLAN_RANK[current.min_plan] ?? 0;
  const planOk = isAdmin || userRank >= required;
  const articlesLeft = cost > 0 ? Math.floor(credits / cost) : 0;
  const reason = !planOk
    ? lang === "ru"
      ? `Требуется тариф ${PLAN_LABEL[current.min_plan]}+`
      : `Requires ${PLAN_LABEL[current.min_plan]}+`
    : articlesLeft >= 10
    ? lang === "ru"
      ? "Хватит кредитов с запасом"
      : "Plenty of credits"
    : articlesLeft >= 3
    ? lang === "ru"
      ? "Кредитов хватит на несколько статей"
      : "Enough for a few articles"
    : articlesLeft >= 1
    ? lang === "ru"
      ? "Кредитов мало - пора пополнить"
      : "Running low - top up soon"
    : lang === "ru"
    ? "Недостаточно кредитов"
    : "Not enough credits";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="px-4 py-3 border-t border-sidebar-border space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{lang === "ru" ? "Тариф" : "Plan"}</span>
          <Link to="/pricing" className="font-semibold text-primary uppercase hover:underline">
            {isAdmin ? "ADMIN" : PLAN_LABEL[plan] ?? plan.toUpperCase()}
          </Link>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Coins className="h-3 w-3" /> {lang === "ru" ? "Кредиты" : "Credits"}
          </span>
          <span className={`font-bold ${credits > 0 ? "text-success" : "text-destructive"}`}>
            {credits}
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`rounded-md border p-2 cursor-help transition-colors ${planOk ? "border-primary/30 bg-primary/5 hover:bg-primary/10" : "border-destructive/40 bg-destructive/5"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Sparkles className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-[11px] font-medium truncate">
                    {current.display_name || current.model_key.split("/").pop()}
                  </span>
                </div>
                <span className="text-[10px] font-semibold text-primary whitespace-nowrap">
                  {cost} {lang === "ru" ? "кр" : "cr"}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Info className="h-2.5 w-2.5" />
                  {planOk
                    ? lang === "ru"
                      ? `~${articlesLeft} статей`
                      : `~${articlesLeft} articles`
                    : lang === "ru"
                    ? "Модель заблокирована"
                    : "Model locked"}
                </span>
                {isAdmin && (
                  <span className="flex items-center gap-0.5 text-primary">
                    <ShieldCheck className="h-2.5 w-2.5" /> ∞
                  </span>
                )}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs">
            <div className="space-y-1">
              <div className="font-semibold">
                {lang === "ru" ? "Почему эта модель?" : "Why this model?"}
              </div>
              <div>{reason}</div>
              <div className="pt-1 border-t border-border text-[11px] text-muted-foreground">
                {lang === "ru"
                  ? `База: ${cost} кр/статья. Stealth x1.5, длинные тексты x1.5-3.`
                  : `Base: ${cost} cr/article. Stealth x1.5, long texts x1.5-3.`}
              </div>
              <div className="text-[11px]">
                {isAdmin
                  ? lang === "ru"
                    ? "Admin: списания отключены."
                    : "Admin: deductions disabled."
                  : lang === "ru"
                  ? `Баланс: ${credits} кр - хватит на ~${articlesLeft} статей.`
                  : `Balance: ${credits} cr - ~${articlesLeft} articles.`}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
