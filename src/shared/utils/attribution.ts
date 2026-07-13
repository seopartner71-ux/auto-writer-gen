/**
 * Attribution capture — snapshots referrer + UTM + landing path on the first
 * page load of a browser session, so we can later attach it to funnel events
 * (registered, registration_completed, first_session_start).
 *
 * Stored in localStorage (first-touch, sticky across sessions until cleared).
 */

const KEY = "attribution_v1";

export type Attribution = {
  referrer: string;
  referrer_host: string;
  landing_path: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  gclid: string;
  yclid: string;
  captured_at: string;
};

function hostOf(url: string): string {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

export function captureAttribution(): void {
  try {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(KEY)) return; // first-touch only
    const p = new URLSearchParams(window.location.search);
    const ref = document.referrer || "";
    const refHost = hostOf(ref);
    const sameOrigin = refHost && refHost === window.location.hostname;
    const attr: Attribution = {
      referrer: sameOrigin ? "" : ref,
      referrer_host: sameOrigin ? "" : refHost,
      landing_path: window.location.pathname + window.location.search,
      utm_source: p.get("utm_source") || "",
      utm_medium: p.get("utm_medium") || "",
      utm_campaign: p.get("utm_campaign") || "",
      utm_term: p.get("utm_term") || "",
      utm_content: p.get("utm_content") || "",
      gclid: p.get("gclid") || "",
      yclid: p.get("yclid") || "",
      captured_at: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(attr));
  } catch {
    /* best-effort */
  }
}

export function getAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}

/** Derive a compact source label for grouping in analytics. */
export function deriveSource(a: Attribution | null): string {
  if (!a) return "direct";
  if (a.utm_source) return a.utm_source.toLowerCase();
  if (a.gclid) return "google_ads";
  if (a.yclid) return "yandex_direct";
  if (a.referrer_host) {
    const h = a.referrer_host.toLowerCase();
    if (h.includes("google.")) return "google";
    if (h.includes("yandex.")) return "yandex";
    if (h.includes("t.me") || h.includes("telegram")) return "telegram";
    if (h.includes("vk.com")) return "vk";
    if (h.includes("youtube.")) return "youtube";
    if (h.includes("bing.")) return "bing";
    if (h.includes("duckduckgo.")) return "duckduckgo";
    return h;
  }
  return "direct";
}