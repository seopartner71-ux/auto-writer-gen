import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Подписка на изменения тарифов (subscription_plans) и ai_models.
 * При любом UPDATE/INSERT/DELETE инвалидирует кэш - UI обновляется без F5.
 */
export function useSubscriptionPlansRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["subscription-plans-landing"] });
      qc.invalidateQueries({ queryKey: ["subscription-plans"] });
      qc.invalidateQueries({ queryKey: ["plan-feature-flags"] });
      qc.invalidateQueries({ queryKey: ["ai-models-active"] });
    };

    // Unique channel id per mount - otherwise multiple consumers (AppLayout +
    // PricingPage + landing) collide on the same channel name and race on
    // removeChannel during unmount.
    const channelId = `subscription-plans-rt-${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscription_plans" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_models" },
        invalidate,
      )
      .subscribe();

    // Также обновляем при возврате на вкладку
    const onFocus = () => invalidate();
    window.addEventListener("focus", onFocus);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
  }, [qc]);
}
