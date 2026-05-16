import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Подписка на изменения тарифов (subscription_plans) и ai_models.
 * При любом UPDATE/INSERT/DELETE инвалидирует кэш — UI обновляется без F5.
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

    const channel = supabase
      .channel("subscription-plans-rt")
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
