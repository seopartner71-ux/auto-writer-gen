import { supabase } from "@/integrations/supabase/client";

/**
 * Activation funnel tracking.
 * Writes events to `public.activation_events` for new-user funnel analysis.
 * Best-effort — never throws, never blocks the UI.
 *
 * Funnel events:
 *   Legacy (kept for back-compat):
 *     registered, opened_dashboard, focused_keyword_field, started_typing,
 *     clicked_generate, generation_done, generation_cancelled,
 *     closed_tab_during_generation, opened_article, copied_or_exported
 *   v3 (canonical, per onboarding v3 spec — 17 events):
 *     registration_completed, first_session_start,
 *     onboarding_modal_shown, onboarding_quick_path_clicked,
 *     onboarding_manual_path_clicked, onboarding_skipped,
 *     keyword_entered, generation_started, generation_stage_completed,
 *     generation_failed, generation_completed, article_editor_opened,
 *     article_copied, article_downloaded, stealth_pass_clicked,
 *     tab_closed_during_generation, session_ended
 */

const SESSION_KEY = "activation_session_id";
const LAST_TS_KEY = "activation_last_event_ts";
const DEDUP_PREFIX = "activation_once:";

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "s_nostorage";
  }
}

function readAndBumpLastTs(): number | null {
  try {
    const raw = localStorage.getItem(LAST_TS_KEY);
    const prev = raw ? parseInt(raw, 10) : null;
    localStorage.setItem(LAST_TS_KEY, String(Date.now()));
    return prev && !Number.isNaN(prev) ? prev : null;
  } catch {
    return null;
  }
}

export type ActivationEvent =
  // legacy names (kept firing for back-compat)
  | "registered"
  | "opened_dashboard"
  | "focused_keyword_field"
  | "started_typing"
  | "clicked_generate"
  | "generation_done"
  | "generation_cancelled"
  | "closed_tab_during_generation"
  | "opened_article"
  | "copied_or_exported"
  // v3 canonical
  | "registration_completed"
  | "first_session_start"
  | "onboarding_modal_shown"
  | "onboarding_quick_path_clicked"
  | "onboarding_manual_path_clicked"
  | "onboarding_skipped"
  | "keyword_entered"
  | "generation_started"
  | "generation_stage_completed"
  | "generation_failed"
  | "generation_completed"
  | "article_editor_opened"
  | "article_copied"
  | "article_downloaded"
  | "stealth_pass_clicked"
  | "tab_closed_during_generation"
  | "session_ended";

export async function trackActivation(
  event: ActivationEvent,
  metadata: Record<string, unknown> = {},
  explicitUserId?: string
): Promise<void> {
  try {
    let uid = explicitUserId;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      uid = data.session?.user?.id;
    }
    if (!uid) return;
    const prev = readAndBumpLastTs();
    const timeSincePrev = prev ? Date.now() - prev : null;
    await supabase.from("activation_events").insert({
      user_id: uid,
      event_name: event,
      session_id: getSessionId(),
      time_since_prev_ms: timeSincePrev,
      metadata: metadata as never,
    });
  } catch {
    // best-effort
  }
}

/** Fire an event at most once per user (per browser). Use for milestone events. */
export function trackActivationOnce(event: ActivationEvent, metadata: Record<string, unknown> = {}): void {
  try {
    const key = `${DEDUP_PREFIX}${event}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    void trackActivation(event, metadata);
  } catch {
    void trackActivation(event, metadata);
  }
}

/**
 * Install a beforeunload listener that fires `closed_tab_during_generation`
 * if the user leaves while generation is running. Returns a cleanup fn.
 */
export function armCloseDuringGeneration(getContext: () => Record<string, unknown>): () => void {
  const handler = () => {
    try {
      const uidRaw = localStorage.getItem("sb-user-id-cache");
      // Use sendBeacon for reliability during unload.
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/activation_events`;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      // We can't easily get auth token synchronously; fall back to a fire-and-forget insert
      // using the same session cached in memory via supabase client. sendBeacon needs a body.
      const body = JSON.stringify({
        user_id: uidRaw,
        event_name: "closed_tab_during_generation",
        session_id: getSessionId(),
        metadata: getContext(),
      });
      const blob = new Blob([body], { type: "application/json" });
      // Best-effort: won't include auth headers, RLS will drop it if not authenticated.
      // Also fire via supabase client (may or may not flush before unload).
      navigator.sendBeacon?.(`${url}?apikey=${key}`, blob);
      void trackActivation("closed_tab_during_generation", getContext());
      // v3 canonical alias
      void trackActivation("tab_closed_during_generation", getContext());
    } catch {
      // ignore
    }
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}

/**
 * Global session_ended listener. Fires on beforeunload when NOT during
 * a generation (armCloseDuringGeneration handles that case separately).
 * Install once from AppLayout. Idempotent via a module-level flag.
 */
let sessionEndArmed = false;
export function armSessionEnd(getContext: () => Record<string, unknown> = () => ({})) {
  if (sessionEndArmed) return;
  sessionEndArmed = true;
  const handler = () => {
    try {
      void trackActivation("session_ended", getContext());
    } catch {
      // ignore
    }
  };
  window.addEventListener("beforeunload", handler);
}