import { supabase } from "@/integrations/supabase/client";
import { translate } from "@/shared/hooks/useI18n";

/**
 * Kick off the server-side improve cycle (2-pass humanize + turgenev
 * orchestration). Returns immediately (202). Progress is written to
 * articles.quality_details.cycle_progress and can be observed via realtime
 * or polling. F5-safe: the loop lives on the server, not the browser tab.
 */
export async function startImproveCycle(
  articleId: string,
  priority: "auto" | "ai" | "turgenev" = "auto",
): Promise<{ ok: boolean; status: number; error?: string; cooldown?: boolean; message?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const lang = (typeof window !== "undefined"
    ? (localStorage.getItem("app-lang") as "ru" | "en")
    : "ru") || "ru";
  if (!token) return { ok: false, status: 401, error: translate("auth.sessionExpired", lang) };

  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/improve-article`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ article_id: articleId, cycle: true, priority }),
  });
  const payload = await resp.json().catch(() => null);
  const httpOk = resp.ok || resp.status === 202;
  if (!httpOk) return { ok: false, status: resp.status, error: payload?.error || `HTTP ${resp.status}` };
  if (payload?.cooldown) return { ok: false, status: resp.status, cooldown: true, message: payload?.message };
  return { ok: true, status: resp.status };
}