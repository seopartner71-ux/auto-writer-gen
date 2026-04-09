import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { PLAN_LIMITS, DEFAULT_PLAN_CONFIG, Plan, PlanConfig } from "@/shared/api/types";

export function usePlanLimits() {
  const { profile } = useAuth();
  const plan = (profile?.plan ?? "free") as Plan;

  const { data: dbFlags } = useQuery({
    queryKey: ["plan-feature-flags", plan],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("feature_flags, monthly_article_limit")
        .eq("id", plan)
        .single();
      if (error || !data) return null;
      return data;
    },
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  const limits: PlanConfig = useMemo(() => {
    if (dbFlags?.feature_flags && typeof dbFlags.feature_flags === "object") {
      const ff = dbFlags.feature_flags as Record<string, unknown>;
      return {
        ...DEFAULT_PLAN_CONFIG,
        ...ff,
        models: Array.isArray(ff.models) ? ff.models as string[] : DEFAULT_PLAN_CONFIG.models,
      };
    }
    return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  }, [dbFlags, plan]);

  return useMemo(() => ({
    plan,
    limits,
    isPro: plan === "pro",
    isFree: plan === "free",
    isFactory: plan === "pro",
    isBasicOrHigher: plan === "basic" || plan === "pro",
  }), [plan, limits]);
}
