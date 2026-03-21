import { useMemo } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { PLAN_LIMITS, Plan, PlanConfig } from "@/shared/api/types";

export function usePlanLimits() {
  const { profile } = useAuth();
  const plan = (profile?.plan ?? "free") as Plan;
  const limits: PlanConfig = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  return useMemo(() => ({
    plan,
    limits,
    isPro: plan === "pro",
    isFree: plan === "free",
    isBasicOrHigher: plan === "basic" || plan === "pro",
  }), [plan, limits]);
}
