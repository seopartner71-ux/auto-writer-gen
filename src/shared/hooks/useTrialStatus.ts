import { useMemo } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useTrialStatus() {
  const { profile, role } = useAuth();

  const isFreePlan = !profile?.plan || profile.plan === "free" || profile.plan === "basic";
  const isPaidPlan = profile?.plan === "pro";
  const isAdmin = role === "admin";

  // Check if user has created any articles (to detect unused credits)
  const { data: articleCount } = useQuery({
    queryKey: ["user-article-count", profile?.id],
    queryFn: async () => {
      if (!profile?.id) return 0;
      const { count, error } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!profile?.id && isFreePlan && !isAdmin,
    staleTime: 60_000,
  });

  return useMemo(() => {
    if (!profile || isAdmin || isPaidPlan) {
      return { showBanner: false, showPaywall: false, paywallReason: null as string | null, showNudge: false };
    }

    const credits = profile.credits_amount ?? 0;
    const createdAt = profile.created_at ? new Date(profile.created_at) : null;
    const now = new Date();

    // Trial expired? (7 days from registration)
    const trialExpired = createdAt
      ? now.getTime() - createdAt.getTime() > 7 * 24 * 60 * 60 * 1000
      : false;

    // 24h since registration and no articles created
    const is24hOld = createdAt
      ? now.getTime() - createdAt.getTime() > 24 * 60 * 60 * 1000
      : false;
    const showNudge = is24hOld && (articleCount === 0) && credits > 0 && !trialExpired;

    // Show banner when exactly 1 credit left (used 2 of 3)
    const showBanner = credits === 1 && !trialExpired;

    // Show paywall when no credits OR trial expired (for free users)
    const showPaywall = trialExpired || credits <= 0;
    const paywallReason = trialExpired ? "trial_expired" : credits <= 0 ? "no_credits" : null;

    return { showBanner, showPaywall, paywallReason, showNudge };
  }, [profile, isAdmin, isPaidPlan, articleCount]);
}
