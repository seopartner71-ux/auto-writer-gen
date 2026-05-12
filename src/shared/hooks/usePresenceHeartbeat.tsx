import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";

/**
 * Periodically updates user_stats.last_activity_at while the tab is visible.
 * Used to power an accurate "online now" indicator.
 */
export function usePresenceHeartbeat(intervalMs = 60_000) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const ping = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        await supabase.from("user_stats").upsert(
          { user_id: user.id, last_activity_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      } catch {
        /* ignore */
      }
    };

    void ping();
    const id = setInterval(ping, intervalMs);
    const onVis = () => { if (document.visibilityState === "visible") void ping(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user?.id, intervalMs]);
}
