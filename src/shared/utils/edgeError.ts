import { translate, type Lang } from "@/shared/hooks/useI18n";

/**
 * Extract a localized error message from an edge-function JSON payload.
 * Edge functions may return `{ error, error_key, error_params }` — this
 * helper prefers the translated key so UI toasts respect the active locale.
 */
export function edgeErrorMessage(
  payload: any,
  lang: Lang,
  fallback = "",
): string {
  if (!payload || typeof payload !== "object") return fallback || String(payload ?? "");
  const key = typeof payload.error_key === "string" ? payload.error_key : null;
  if (key) {
    const translated = translate(key, lang, payload.error_params || undefined);
    if (translated && translated !== key) return translated;
  }
  return typeof payload.error === "string" ? payload.error : fallback;
}