// Dev-only logger. In production .debug/.info are no-ops to keep prod console clean.
// Use console.warn / console.error directly for real signals - they are kept in prod.
const isDev = import.meta.env.DEV;

export const logger = {
  debug: (...args: unknown[]) => { if (isDev) console.log(...args); },
  info: (...args: unknown[]) => { if (isDev) console.info(...args); },
  warn: (...args: unknown[]) => { console.warn(...args); },
  error: (...args: unknown[]) => { console.error(...args); },
};

/** Safely extract an error message from an unknown thrown value. */
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    return typeof m === "string" ? m : String(m);
  }
  return String(e);
}
