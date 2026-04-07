/**
 * Sanitizes keyword input to prevent regex catastrophic backtracking
 * and edge-function errors from special characters.
 */
export function sanitizeKeyword(raw: string): string {
  return raw
    // Remove characters that break regex or cause hangs
    .replace(/["""«»''`]/g, "")
    .replace(/[:;+=%^~<>{}[\]|\\]/g, " ")
    // Collapse multiple spaces
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Escapes a string for safe use inside a RegExp constructor.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validates that a keyword is safe to use (no mixed scripts that crash regex).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateKeywordInput(raw: string): string | null {
  if (!raw || raw.trim().length < 2) return "too_short";
  if (raw.length > 200) return "too_long";
  return null;
}
